# Standalone (Docker + Caddy)

[中文文档](README.zh-CN.md)

The **Standalone** mode serves the WebUI and proxies backend API requests from the same origin using Caddy — no CORS, no cookie credential leakage.

## Build

```bash
docker build -t torrentmix-standalone -f deploy/standalone/Dockerfile .
```

## Run

Configure at least one upstream:

| Variable | Example | Description |
|----------|---------|-------------|
| `QB_UPSTREAM` | `http://qbittorrent:8080` | qBittorrent instance |
| `TR_UPSTREAM` | `http://transmission:9091` | Transmission instance |

```bash
docker run --rm -p 8080:8080 \
  -e QB_UPSTREAM="http://host.docker.internal:8080" \
  torrentmix-standalone
```

Open `http://localhost:8080`.

> **Linux tip:** `host.docker.internal` may not be available on Linux. Use Docker Compose and put both the backend and this container on the same network instead.
