# Standalone（Docker + Caddy）

[English](README.md)

**Standalone** 模式通过 Caddy 将 WebUI 静态资源与后端 API 代理统一在同一个源下提供，从根本上规避 CORS 和 Cookie 凭证问题。

## 构建

```bash
docker build -t torrentmix-standalone -f deploy/standalone/Dockerfile .
```

## 运行

至少配置一个上游：

| 变量 | 示例 | 说明 |
|------|------|------|
| `QB_UPSTREAM` | `http://qbittorrent:8080` | qBittorrent 实例地址 |
| `TR_UPSTREAM` | `http://transmission:9091` | Transmission 实例地址 |

```bash
docker run --rm -p 8080:8080 \
  -e QB_UPSTREAM="http://host.docker.internal:8080" \
  torrentmix-standalone
```

访问 `http://localhost:8080`。

> **Linux 提示：** `host.docker.internal` 在 Linux 上可能不可用，建议使用 Docker Compose 把后端与本容器放在同一网络中。
