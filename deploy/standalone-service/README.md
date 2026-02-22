# Standalone Service

[中文文档](README.zh-CN.md)

The **Standalone Service** turns the WebUI into a self-contained same-origin gateway — static assets and backend API are served from a single process and port. No CORS, no cookie issues.

**What it does:**

- Serves WebUI static assets
- Reverse-proxies `/api/*` (qBittorrent) and `/transmission/*` (Transmission) to configured backend instances
- Provides a server-switcher panel with pre-configured credentials and latency display
- Supports in-browser server configuration that writes back to the config file

## Configuration

The service reads from the path in `STANDALONE_CONFIG` (default: `/config/standalone.json`).

See [`config.example.json`](config.example.json) for a full example.

| Field | Description |
|-------|-------------|
| `defaultServerId` | Server to connect on startup (defaults to the first entry if omitted) |
| `servers[].id` | Unique identifier |
| `servers[].name` | Display name |
| `servers[].type` | `qbit` or `trans` |
| `servers[].baseUrl` | Backend base URL (e.g. `http://qb:8080`) |
| `servers[].username` / `.password` | Pre-configured credentials for seamless auth |

## Docker

**Build:**

```bash
docker build -t torrentmix-standalone-service -f deploy/standalone-service/Dockerfile .
```

**Run** (mount your config file):

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/deploy/standalone-service/config.example.json:/config/standalone.json:ro" \
  torrentmix-standalone-service
```

Open `http://localhost:8080`.

> **In-browser config:** click **Switch Server → Manage Servers** in the top-right corner. Changes are written back to `STANDALONE_CONFIG` and the page reloads. Passwords are never echoed — leave blank to keep the existing value.

## Binary (Local Build)

```bash
# Option 1: native Rust toolchain (recommended)
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service

# macOS / Linux
STANDALONE_CONFIG=deploy/standalone-service/config.example.json \
LISTEN_ADDR=:8080 \
./rust/target/release/standalone-service

# Windows (PowerShell)
$env:STANDALONE_CONFIG = 'deploy/standalone-service/config.example.json'
$env:LISTEN_ADDR = ':8080'
.\rust\target\release\standalone-service.exe

# Option 2: build inside Docker (no local Rust required)
docker run --rm -v "$PWD:/work" -w /work rust:1.78-alpine \
  sh -lc "apk add --no-cache musl-dev && cargo build --manifest-path rust/Cargo.toml --release -p standalone-service"
```


