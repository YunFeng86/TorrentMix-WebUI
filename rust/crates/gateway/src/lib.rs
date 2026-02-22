use std::{
  collections::HashMap,
  net::{IpAddr, Ipv4Addr, SocketAddr},
  path::{Path, PathBuf},
  sync::Arc,
  time::Duration,
};

use anyhow::{anyhow, Context, Result};
use axum::{
  body::Body,
  extract::State,
  http::{
    header::{self, HeaderName},
    HeaderMap, HeaderValue, Method, Request, StatusCode, Uri,
  },
  response::{IntoResponse, Response},
  routing::{any, get, post},
  Json, Router,
};
use axum_extra::extract::cookie::CookieJar;
use bytes::Bytes;
use futures_util::{StreamExt, TryStreamExt};
use reqwest::redirect::Policy;
use tokio::{
  net::TcpStream,
  sync::{Mutex, RwLock},
  time::{timeout_at, Instant},
};
use tower_http::services::{ServeDir, ServeFile};
use url::Url;

const COOKIE_SELECTED_SERVER: &str = "tm_server_id";
const MAX_BODY_BYTES: usize = 64 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum BackendType {
  Qbit,
  Trans,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerConfig {
  #[serde(default)]
  id: String,
  #[serde(default)]
  name: String,
  #[serde(rename = "type")]
  kind: BackendType,
  #[serde(default)]
  base_url: String,
  #[serde(default)]
  username: String,
  #[serde(default)]
  password: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
  #[serde(default)]
  default_server_id: String,
  servers: Vec<ServerConfig>,
}

#[derive(Debug, Clone)]
struct ServerEntry {
  cfg: ServerConfig,
  base: Url,
  origin: String,
}

#[derive(Debug)]
struct Catalog {
  default_id: String,
  servers: HashMap<String, ServerEntry>,
  order: Vec<String>,
}

impl Catalog {
  fn load(path: &Path) -> Result<Self> {
    let raw = std::fs::read(path).with_context(|| format!("read config: {}", path.display()))?;
    let mut cfg: ConfigFile =
      serde_json::from_slice(&raw).context("parse config")?;

    if cfg.servers.is_empty() {
      return Err(anyhow!("config.servers is empty"));
    }

    cfg.default_server_id = cfg.default_server_id.trim().to_string();

    let mut servers = HashMap::with_capacity(cfg.servers.len());
    let mut order = Vec::with_capacity(cfg.servers.len());

    for mut s in cfg.servers.drain(..) {
      s.id = s.id.trim().to_string();
      s.name = s.name.trim().to_string();
      s.base_url = s.base_url.trim().to_string();
      s.username = s.username.trim().to_string();
      s.password = s.password.trim().to_string();

      if s.id.is_empty() {
        return Err(anyhow!("server.id is required"));
      }
      if s.name.is_empty() {
        s.name = s.id.clone();
      }
      if s.base_url.is_empty() {
        return Err(anyhow!("server {:?}: baseUrl is required", s.id));
      }
      if servers.contains_key(&s.id) {
        return Err(anyhow!("duplicate server id: {:?}", s.id));
      }

      let base = Url::parse(&s.base_url)
        .with_context(|| format!("server {:?}: invalid baseUrl {:?}", s.id, s.base_url))?;
      if base.scheme().is_empty() || base.host_str().is_none() {
        return Err(anyhow!("server {:?}: invalid baseUrl {:?}", s.id, s.base_url));
      }

      let host = base.host_str().unwrap();
      let host_for_origin = format_host_only(host);
      let origin = if let Some(port) = base.port() {
        format!("{}://{}:{}", base.scheme(), host_for_origin, port)
      } else {
        format!("{}://{}", base.scheme(), host_for_origin)
      };
      let entry = ServerEntry { cfg: s, base, origin };
      order.push(entry.cfg.id.clone());
      servers.insert(entry.cfg.id.clone(), entry);
    }

    let default_id = if cfg.default_server_id.is_empty() {
      order[0].clone()
    } else if servers.contains_key(&cfg.default_server_id) {
      cfg.default_server_id
    } else {
      return Err(anyhow!(
        "defaultServerId {:?} not found in servers",
        cfg.default_server_id
      ));
    };

    Ok(Self { default_id, servers, order })
  }

  fn selected_id<'a>(&'a self, jar: &'a CookieJar) -> &'a str {
    if let Some(cookie) = jar.get(COOKIE_SELECTED_SERVER) {
      let id = cookie.value().trim();
      if !id.is_empty() && self.servers.contains_key(id) {
        return id;
      }
    }
    &self.default_id
  }

  fn pick<'a>(&'a self, jar: &'a CookieJar) -> &'a ServerEntry {
    let id = self.selected_id(jar);
    self.servers.get(id).expect("catalog validated")
  }
}

#[derive(Clone)]
struct AppState {
  catalog: Arc<RwLock<Catalog>>,
  qbit: Arc<QbitSessions>,
  client: reqwest::Client,
  config_path: Arc<PathBuf>,
}

struct QbitSession {
  cookie: Option<String>,
}

struct QbitSessions {
  sessions: Mutex<HashMap<String, Arc<Mutex<QbitSession>>>>,
  client: reqwest::Client,
}

impl QbitSessions {
  fn new() -> Result<Self> {
    let client = reqwest::Client::builder()
      .timeout(Duration::from_secs(12))
      .redirect(Policy::none())
      .build()
      .context("build qB http client")?;

    Ok(Self {
      sessions: Mutex::new(HashMap::new()),
      client,
    })
  }

  async fn session(&self, id: &str) -> Arc<Mutex<QbitSession>> {
    let mut map = self.sessions.lock().await;
    map
      .entry(id.to_string())
      .or_insert_with(|| Arc::new(Mutex::new(QbitSession { cookie: None })))
      .clone()
  }

  async fn clear(&self) {
    self.sessions.lock().await.clear();
  }

  async fn ensure_cookie(&self, entry: &ServerEntry, force: bool) -> Result<String> {
    if entry.cfg.username.is_empty() && entry.cfg.password.is_empty() {
      return Err(anyhow!(
        "qBittorrent server requires username/password in config"
      ));
    }

    let session = self.session(&entry.cfg.id).await;
    let mut guard = session.lock().await;

    if let Some(cookie) = guard.cookie.clone() {
      if !force {
        return Ok(cookie);
      }
    }

    let login_url = join_url(&entry.base, "/api/v2/auth/login")?;
    let origin = entry.origin.clone();
    let referer = format!("{}/", origin);

    let resp = self
      .client
      .post(login_url)
      .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
      .header("Origin", &origin)
      .header("Referer", &referer)
      .form(&[
        ("username", entry.cfg.username.clone()),
        ("password", entry.cfg.password.clone()),
      ])
      .send()
      .await
      .context("qB login request failed")?;

    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp
      .bytes()
      .await
      .unwrap_or_else(|_| Bytes::from_static(b""));

    if status != StatusCode::OK {
      let text = String::from_utf8_lossy(&body).trim().to_string();
      return Err(anyhow!("qB login failed: status={} body={:?}", status, text));
    }
    if !String::from_utf8_lossy(&body).contains("Ok") {
      let text = String::from_utf8_lossy(&body).trim().to_string();
      return Err(anyhow!("qB login failed: body={:?}", text));
    }

    let cookies = extract_set_cookie_pairs(&headers);
    if cookies.is_empty() {
      return Err(anyhow!("qB login did not set cookies"));
    }

    let cookie = cookies.join("; ");
    guard.cookie = Some(cookie.clone());
    Ok(cookie)
  }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerPublic {
  id: String,
  name: String,
  #[serde(rename = "type")]
  kind: BackendType,
  base_url: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  latency_ms: Option<u64>,
  reachable: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
  schema: u32,
  selected_id: String,
  servers: Vec<ServerPublic>,
}

#[derive(Debug, serde::Deserialize)]
struct SelectRequest {
  id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigServerPublic {
  id: String,
  name: String,
  #[serde(rename = "type")]
  kind: BackendType,
  base_url: String,
  username: String,
  has_password: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigResponse {
  schema: u32,
  default_server_id: String,
  servers: Vec<ConfigServerPublic>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigUpdateRequest {
  #[serde(default)]
  default_server_id: String,
  servers: Vec<ConfigUpdateServer>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigUpdateServer {
  id: String,
  #[serde(default)]
  name: String,
  #[serde(rename = "type")]
  kind: BackendType,
  base_url: String,
  #[serde(default)]
  username: String,
  password: Option<String>,
}

pub async fn serve_from_env() -> Result<()> {
  let listen = env_or_default("LISTEN_ADDR", ":8080");
  let static_dir = env_or_default("STATIC_DIR", "./dist");
  let config_path = env_or_default("STANDALONE_CONFIG", "/config/standalone.json");

  serve(&listen, PathBuf::from(static_dir), PathBuf::from(config_path)).await
}

fn env_or_default(key: &str, default: &str) -> String {
  let Ok(v) = std::env::var(key) else {
    return default.to_string();
  };
  let v = v.trim();
  if v.is_empty() {
    return default.to_string();
  }
  v.to_string()
}

pub async fn serve(listen: &str, static_dir: PathBuf, config_path: PathBuf) -> Result<()> {
  let addr = normalize_listen_addr(listen)?;

  let config_path = Arc::new(config_path);

  let catalog = Catalog::load(&config_path)?;
  let catalog = Arc::new(RwLock::new(catalog));

  let qbit = Arc::new(QbitSessions::new()?);
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(60))
    .redirect(Policy::none())
    .build()
    .context("build proxy http client")?;

  let state = AppState {
    catalog,
    qbit,
    client,
    config_path,
  };

  let index_path = static_dir.join("index.html");
  let static_service = ServeDir::new(static_dir).fallback(ServeFile::new(index_path));

  let app = Router::new()
    .route("/__standalone__/status", get(handle_status))
    .route("/__standalone__/select", post(handle_select))
    .route("/__standalone__/config", get(handle_config_get).post(handle_config_update))
    .route("/api/*path", any(handle_proxy))
    .route("/transmission/*path", any(handle_proxy))
    .fallback_service(static_service)
    .with_state(state);

  tracing::info!(listen = %addr, "standalone-service listening");
  axum::serve(tokio::net::TcpListener::bind(addr).await?, app.into_make_service())
    .await
    .context("http server error")
}

pub async fn spawn_with_listener(
  listener: tokio::net::TcpListener,
  static_dir: PathBuf,
  config_path: PathBuf,
) -> Result<SocketAddr> {
  let addr = listener.local_addr().context("listener local_addr")?;

  let config_path = Arc::new(config_path);

  let catalog = Catalog::load(&config_path)?;
  let catalog = Arc::new(RwLock::new(catalog));

  let qbit = Arc::new(QbitSessions::new()?);
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(60))
    .redirect(Policy::none())
    .build()
    .context("build proxy http client")?;

  let state = AppState {
    catalog,
    qbit,
    client,
    config_path,
  };

  let index_path = static_dir.join("index.html");
  let static_service = ServeDir::new(static_dir).fallback(ServeFile::new(index_path));

  let app = Router::new()
    .route("/__standalone__/status", get(handle_status))
    .route("/__standalone__/select", post(handle_select))
    .route("/__standalone__/config", get(handle_config_get).post(handle_config_update))
    .route("/api/*path", any(handle_proxy))
    .route("/transmission/*path", any(handle_proxy))
    .fallback_service(static_service)
    .with_state(state);

  tokio::spawn(async move {
    if let Err(err) = axum::serve(listener, app.into_make_service()).await {
      tracing::error!(error = %err, "http server error");
    }
  });

  Ok(addr)
}

fn normalize_listen_addr(raw: &str) -> Result<SocketAddr> {
  let raw = raw.trim();
  if raw.is_empty() {
    return Err(anyhow!("LISTEN_ADDR is empty"));
  }

  if raw.starts_with(':') {
    let port: u16 = raw[1..]
      .parse()
      .with_context(|| format!("invalid port in LISTEN_ADDR {:?}", raw))?;
    return Ok(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port));
  }

  raw
    .parse::<SocketAddr>()
    .with_context(|| format!("invalid LISTEN_ADDR {:?}", raw))
}

async fn handle_status(
  State(state): State<AppState>,
  jar: CookieJar,
) -> impl IntoResponse {
  let (selected, items) = {
    let catalog = state.catalog.read().await;
    let selected = catalog.selected_id(&jar).to_string();
    let mut items = Vec::with_capacity(catalog.order.len());
    for id in catalog.order.iter() {
      let entry = catalog.servers.get(id).expect("catalog validated");
      items.push((
        entry.cfg.id.clone(),
        entry.cfg.name.clone(),
        entry.cfg.kind,
        entry.cfg.base_url.clone(),
        entry.base.clone(),
      ));
    }
    (selected, items)
  };
  let deadline = Instant::now() + Duration::from_millis(1200);

  let mut tasks = Vec::with_capacity(items.len());
  for (id, _name, _kind, _base_url, base) in items.iter() {
    let id = id.clone();
    let base = base.clone();
    tasks.push(async move {
      let (latency_ms, reachable) = measure_tcp_dial_latency(deadline, &base).await;
      (id, latency_ms, reachable)
    });
  }

  let results = futures_util::future::join_all(tasks).await;
  let mut lat_map: HashMap<String, (Option<u64>, bool)> = HashMap::with_capacity(results.len());
  for (id, latency_ms, reachable) in results {
    lat_map.insert(id, (latency_ms, reachable));
  }

  let mut servers = Vec::with_capacity(items.len());
  for (id, name, kind, base_url, _base) in items {
    let (latency_ms, reachable) = lat_map
      .get(&id)
      .cloned()
      .unwrap_or((None, false));
    servers.push(ServerPublic {
      id,
      name,
      kind,
      base_url,
      latency_ms,
      reachable,
    });
  }

  let out = StatusResponse {
    schema: 1,
    selected_id: selected,
    servers,
  };

  (
    [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
    Json(out),
  )
}

async fn handle_select(
  State(state): State<AppState>,
  req: Request<Body>,
) -> Response {
  if req.method() != Method::POST {
    return (StatusCode::METHOD_NOT_ALLOWED, "method not allowed").into_response();
  }

  let body = match read_body_bytes(req.into_body(), 1024).await {
    Ok(v) => v,
    Err(_) => {
      return (StatusCode::BAD_REQUEST, "invalid json body").into_response();
    }
  };

  let parsed: SelectRequest = match serde_json::from_slice(&body) {
    Ok(v) => v,
    Err(_) => {
      return (StatusCode::BAD_REQUEST, "invalid json body").into_response();
    }
  };

  let id = parsed.id.trim().to_string();
  if id.is_empty() {
    return (StatusCode::BAD_REQUEST, "id is required").into_response();
  }
  {
    let catalog = state.catalog.read().await;
    if !catalog.servers.contains_key(&id) {
      return (StatusCode::BAD_REQUEST, "unknown server id").into_response();
    }
  }

  let cookie = format!(
    "{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000",
    name = COOKIE_SELECTED_SERVER,
    value = id
  );
  let mut headers = HeaderMap::new();
  if let Ok(v) = header::HeaderValue::from_str(&cookie) {
    headers.insert(header::SET_COOKIE, v);
  }

  let out = serde_json::json!({ "ok": true, "id": id });
  (headers, Json(out)).into_response()
}

async fn handle_proxy(
  State(state): State<AppState>,
  jar: CookieJar,
  req: Request<Body>,
) -> Response {
  let entry = {
    let catalog = state.catalog.read().await;
    catalog.pick(&jar).clone()
  };

  let method = req.method().clone();
  let uri = req.uri().clone();
  let headers = req.headers().clone();

  let body = match read_body_bytes(req.into_body(), MAX_BODY_BYTES).await {
    Ok(v) => v,
    Err(ReadBodyError::TooLarge) => {
      return (StatusCode::PAYLOAD_TOO_LARGE, "request entity too large").into_response();
    }
    Err(_) => {
      return (StatusCode::BAD_REQUEST, "read body failed").into_response();
    }
  };

  let mut cookie: Option<String> = None;
  if entry.cfg.kind == BackendType::Qbit {
    if let Ok(v) = state.qbit.ensure_cookie(&entry, false).await {
      cookie = Some(v);
    }
  }

  let mut resp = match forward_once(
    &state,
    &entry,
    &method,
    &uri,
    &headers,
    body.clone(),
    cookie.as_deref(),
  )
  .await
  {
    Ok(v) => v,
    Err(err) => {
      return (StatusCode::BAD_GATEWAY, err.to_string()).into_response();
    }
  };

  if entry.cfg.kind == BackendType::Qbit && resp.status() == StatusCode::FORBIDDEN {
    if let Ok(v) = state.qbit.ensure_cookie(&entry, true).await {
      cookie = Some(v);
    }
    resp = match forward_once(
      &state,
      &entry,
      &method,
      &uri,
      &headers,
      body,
      cookie.as_deref(),
    )
    .await
    {
      Ok(v) => v,
      Err(err) => {
        return (StatusCode::BAD_GATEWAY, err.to_string()).into_response();
      }
    };
  }

  let status = resp.status();
  let mut out_headers = sanitize_response_headers(resp.headers().clone());

  let stream = resp
    .bytes_stream()
    .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err));
  let body = Body::from_stream(stream);

  let mut out = Response::new(body);
  *out.status_mut() = status;
  *out.headers_mut() = std::mem::take(&mut out_headers);
  out
}

async fn handle_config_get(State(state): State<AppState>) -> impl IntoResponse {
  let (default_server_id, servers) = {
    let catalog = state.catalog.read().await;
    let default_server_id = catalog.default_id.clone();
    let mut servers = Vec::with_capacity(catalog.order.len());
    for id in catalog.order.iter() {
      let entry = catalog.servers.get(id).expect("catalog validated");
      servers.push(ConfigServerPublic {
        id: entry.cfg.id.clone(),
        name: entry.cfg.name.clone(),
        kind: entry.cfg.kind,
        base_url: entry.cfg.base_url.clone(),
        username: entry.cfg.username.clone(),
        has_password: !entry.cfg.password.is_empty(),
      });
    }
    (default_server_id, servers)
  };

  let out = ConfigResponse {
    schema: 1,
    default_server_id,
    servers,
  };

  (
    [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
    Json(out),
  )
}

async fn handle_config_update(
  State(state): State<AppState>,
  req: Request<Body>,
) -> Response {
  if req.method() != Method::POST {
    return (StatusCode::METHOD_NOT_ALLOWED, "method not allowed").into_response();
  }

  let body = match read_body_bytes(req.into_body(), 64 * 1024).await {
    Ok(v) => v,
    Err(ReadBodyError::TooLarge) => {
      return (StatusCode::PAYLOAD_TOO_LARGE, "request entity too large").into_response();
    }
    Err(_) => {
      return (StatusCode::BAD_REQUEST, "read body failed").into_response();
    }
  };

  let parsed: ConfigUpdateRequest = match serde_json::from_slice(&body) {
    Ok(v) => v,
    Err(_) => {
      return (StatusCode::BAD_REQUEST, "invalid json body").into_response();
    }
  };

  let existing_passwords = {
    let catalog = state.catalog.read().await;
    catalog
      .servers
      .iter()
      .map(|(id, entry)| (id.clone(), entry.cfg.password.clone()))
      .collect::<HashMap<String, String>>()
  };

  let mut servers = Vec::with_capacity(parsed.servers.len());
  let mut seen_ids = HashMap::<String, ()>::with_capacity(parsed.servers.len());

  for s in parsed.servers {
    let id = s.id.trim().to_string();
    if id.is_empty() {
      return (StatusCode::BAD_REQUEST, "server.id is required").into_response();
    }
    if seen_ids.insert(id.clone(), ()).is_some() {
      return (StatusCode::BAD_REQUEST, "duplicate server id").into_response();
    }

    let mut name = s.name.trim().to_string();
    if name.is_empty() {
      name = id.clone();
    }
    let base_url = s.base_url.trim().to_string();
    if base_url.is_empty() {
      return (StatusCode::BAD_REQUEST, "server.baseUrl is required").into_response();
    }

    if let Ok(base) = Url::parse(&base_url) {
      if base.scheme().is_empty() || base.host_str().is_none() {
        return (StatusCode::BAD_REQUEST, "server.baseUrl is invalid").into_response();
      }
    } else {
      return (StatusCode::BAD_REQUEST, "server.baseUrl is invalid").into_response();
    }

    let username = s.username.trim().to_string();
    let password = s
      .password
      .map(|v| v.trim().to_string())
      .unwrap_or_else(|| existing_passwords.get(&id).cloned().unwrap_or_default());

    if s.kind == BackendType::Qbit && username.is_empty() && password.is_empty() {
      return (StatusCode::BAD_REQUEST, "qBittorrent server requires username/password").into_response();
    }

    servers.push(ServerConfig {
      id,
      name,
      kind: s.kind,
      base_url,
      username,
      password,
    });
  }

  if servers.is_empty() {
    return (StatusCode::BAD_REQUEST, "servers is empty").into_response();
  }

  let mut default_server_id = parsed.default_server_id.trim().to_string();
  if default_server_id.is_empty() {
    default_server_id = servers[0].id.clone();
  } else if !servers.iter().any(|s| s.id == default_server_id) {
    return (StatusCode::BAD_REQUEST, "defaultServerId not found in servers").into_response();
  }

  let config = ConfigFile {
    default_server_id,
    servers,
  };

  let raw = match serde_json::to_vec_pretty(&config) {
    Ok(v) => v,
    Err(_) => {
      return (StatusCode::INTERNAL_SERVER_ERROR, "serialize config failed").into_response();
    }
  };

  if let Some(parent) = state.config_path.parent() {
    if let Err(err) = tokio::fs::create_dir_all(parent).await {
      tracing::error!(error = %err, "create config dir failed");
    }
  }

  let tmp = state.config_path.with_extension("tmp");
  if let Err(err) = tokio::fs::write(&tmp, &raw).await {
    tracing::error!(error = %err, "write config tmp failed");
    return (StatusCode::INTERNAL_SERVER_ERROR, "write config failed").into_response();
  }

  if let Err(err) = tokio::fs::rename(&tmp, &*state.config_path).await {
    let _ = tokio::fs::remove_file(&*state.config_path).await;
    if let Err(err2) = tokio::fs::rename(&tmp, &*state.config_path).await {
      tracing::error!(error = %err, error2 = %err2, "rename config failed");
      return (StatusCode::INTERNAL_SERVER_ERROR, "write config failed").into_response();
    }
  }

  let new_catalog = match Catalog::load(&state.config_path) {
    Ok(v) => v,
    Err(err) => {
      tracing::error!(error = %err, "reload catalog failed");
      return (StatusCode::BAD_REQUEST, "config is invalid").into_response();
    }
  };

  {
    let mut catalog = state.catalog.write().await;
    *catalog = new_catalog;
  }
  state.qbit.clear().await;

  Json(serde_json::json!({ "ok": true })).into_response()
}

async fn forward_once(
  state: &AppState,
  entry: &ServerEntry,
  method: &Method,
  uri: &Uri,
  headers: &HeaderMap,
  body: Vec<u8>,
  qbit_cookie: Option<&str>,
) -> Result<reqwest::Response> {
  let target = build_target_url(&entry.base, uri)?;
  let mut out_headers = sanitize_request_headers(headers.clone());

  if entry.cfg.kind == BackendType::Qbit {
    out_headers.insert("origin", header::HeaderValue::from_str(&entry.origin)?);
    out_headers.insert(
      "referer",
      header::HeaderValue::from_str(&format!("{}/", entry.origin))?,
    );
    if let Some(v) = qbit_cookie {
      out_headers.insert("cookie", header::HeaderValue::from_str(v)?);
    }
  }

  let mut builder = state
    .client
    .request(method.clone(), target)
    .headers(out_headers)
    .body(body);

  if entry.cfg.kind == BackendType::Trans
    && (!entry.cfg.username.is_empty() || !entry.cfg.password.is_empty())
  {
    builder = builder.basic_auth(entry.cfg.username.clone(), Some(entry.cfg.password.clone()));
  }

  builder.send().await.context("upstream request failed")
}

fn build_target_url(base: &Url, uri: &Uri) -> Result<Url> {
  let mut target = base.clone();
  let base_path = target.path();
  let base_path = if base_path == "/" { "" } else { base_path };
  let joined = join_path(base_path, uri.path());

  target.set_path(&joined);
  target.set_query(uri.query());
  Ok(target)
}

fn join_path(a: &str, b: &str) -> String {
  let aslash = a.ends_with('/');
  let bslash = b.starts_with('/');

  match (aslash, bslash) {
    (true, true) => format!("{}{}", a, b.trim_start_matches('/')),
    (false, false) => {
      if a.is_empty() {
        format!("/{}", b)
      } else {
        format!("{}/{}", a, b)
      }
    }
    _ => format!("{a}{b}"),
  }
}

fn join_url(base: &Url, suffix: &str) -> Result<Url> {
  let mut out = base.clone();
  let base_path = out.path();
  let base_path = if base_path == "/" { "" } else { base_path };
  out.set_path(&join_path(base_path, suffix));
  Ok(out)
}

async fn measure_tcp_dial_latency(deadline: Instant, base: &Url) -> (Option<u64>, bool) {
  let Some(host) = base.host_str() else {
    return (None, false);
  };

  let port = base.port_or_known_default().unwrap_or(80);
  let addr = format_host_port(host, port);

  let start = Instant::now();
  let fut = TcpStream::connect(addr);
  match timeout_at(deadline, fut).await {
    Ok(Ok(stream)) => {
      drop(stream);
      let ms = start.elapsed().as_millis() as u64;
      (Some(ms), true)
    }
    _ => (None, false),
  }
}

fn format_host_port(host: &str, port: u16) -> String {
  if host.contains(':') && !host.starts_with('[') {
    format!("[{host}]:{port}")
  } else {
    format!("{host}:{port}")
  }
}

fn format_host_only(host: &str) -> String {
  if host.contains(':') && !host.starts_with('[') {
    format!("[{host}]")
  } else {
    host.to_string()
  }
}

fn extract_set_cookie_pairs(headers: &HeaderMap) -> Vec<String> {
  let mut out = Vec::new();
  for value in headers.get_all(header::SET_COOKIE).iter() {
    let Ok(raw) = value.to_str() else {
      continue;
    };
    let Some(first) = raw.split(';').next() else {
      continue;
    };
    let pair = first.trim();
    if pair.is_empty() {
      continue;
    }
    let mut parts = pair.splitn(2, '=');
    let name = parts.next().unwrap_or("").trim();
    let value = parts.next().unwrap_or("").trim();
    if name.is_empty() {
      continue;
    }
    out.push(format!("{name}={value}"));
  }
  out
}

fn sanitize_request_headers(mut headers: HeaderMap) -> HeaderMap {
  remove_hop_headers(&mut headers);
  headers.remove(header::COOKIE);
  headers.remove(header::AUTHORIZATION);
  headers.remove(header::HOST);
  headers
}

fn sanitize_response_headers(mut headers: HeaderMap) -> HeaderMap {
  remove_hop_headers(&mut headers);
  headers.remove(header::SET_COOKIE);
  headers
}

fn remove_hop_headers(headers: &mut HeaderMap) {
  let conn = headers
    .get(header::CONNECTION)
    .and_then(|v| v.to_str().ok())
    .map(|v| v.to_string());
  if let Some(conn) = conn {
    for token in conn.split(',') {
      let name = token.trim().to_ascii_lowercase();
      if let Ok(name) = HeaderName::from_bytes(name.as_bytes()) {
        headers.remove(name);
      }
    }
  }

  for name in [
    "connection",
    "proxy-connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ] {
    headers.remove(name);
  }
}

#[derive(Debug)]
enum ReadBodyError {
  TooLarge,
  Other,
}

async fn read_body_bytes(body: Body, limit: usize) -> std::result::Result<Vec<u8>, ReadBodyError> {
  let mut out = Vec::new();
  let mut stream = body.into_data_stream();

  while let Some(next) = stream.next().await {
    let chunk = match next {
      Ok(v) => v,
      Err(_) => return Err(ReadBodyError::Other),
    };

    if out.len().saturating_add(chunk.len()) > limit {
      return Err(ReadBodyError::TooLarge);
    }

    out.extend_from_slice(&chunk);
  }

  Ok(out)
}
