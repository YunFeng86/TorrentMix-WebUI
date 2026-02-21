# Standalone（Docker + Caddy）

这一形态的核心是“同源反代”：WebUI 静态资源与后端 API 从同一个 Origin 提供，从根上规避 CORS/cookie 凭证坑。

## 构建

```bash
docker build -t torrent-webui-standalone -f deploy/standalone/Dockerfile .
```

## 运行

至少配置一个上游：

- `QB_UPSTREAM`：qBittorrent（例如 `http://qbittorrent:8080`）
- `TR_UPSTREAM`：Transmission（例如 `http://transmission:9091`）

```bash
docker run --rm -p 8080:8080 \
  -e QB_UPSTREAM="http://host.docker.internal:8080" \
  torrent-webui-standalone
```

打开：`http://localhost:8080`

> 提示：Linux 下未必支持 `host.docker.internal`，建议用 Docker Compose 把后端和 WebUI 放在同一个 network。

