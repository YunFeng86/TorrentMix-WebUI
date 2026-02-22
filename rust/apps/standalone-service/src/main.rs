use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() {
  let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
  fmt().with_env_filter(filter).init();

  if let Err(err) = gateway::serve_from_env().await {
    tracing::error!(error = %err, "standalone-service failed");
    std::process::exit(1);
  }
}

