# Sidecar Updater

[English](README.md)

轻量级 sidecar 容器，负责将后端的 WebUI 目录与最新发布版本保持同步。定期拉取 `latest.json`，下载 `dist.zip`，校验 SHA-256 后解压到目标目录。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LATEST_URL` | ✅ | — | 指向 `latest.json` 的 URL |
| `TARGET_DIR` | | `/target` | WebUI 解压目标目录 |
| `CHECK_INTERVAL_SEC` | | `3600` | 轮询间隔（秒）；设为 `0` 仅执行一次后退出 |

## 使用

**构建：**

```bash
docker build -t torrentmix-sidecar -f deploy/sidecar/Dockerfile .
```

**运行：**

```bash
docker run --rm \
  -e LATEST_URL="https://your.domain/latest.json" \
  -e CHECK_INTERVAL_SEC=3600 \
  -v /path/to/webui:/target \
  torrentmix-sidecar
```

## 接入后端

将后端指向挂载的共享卷：

- **qBittorrent** — 在设置中启用 *Alternative WebUI* 并将路径指向共享卷（具体方式因发行版而异，Docker 共享卷是最简洁的方案）。
- **Transmission** — 通过 `--web-home`（或对应配置项）指向共享卷。
