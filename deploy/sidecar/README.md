# Sidecar Updater

这个 sidecar 容器的职责很单纯：定期读取 `latest.json`，下载 `full-dist.zip`（校验 sha256），然后解压覆盖到挂载的 WebUI 目录。

## 环境变量

- `LATEST_URL`（必填）：指向 `latest.json` 的 URL
- `TARGET_DIR`：安装目录（默认 `/target`）
- `CHECK_INTERVAL_SEC`：检查间隔秒数（默认 `3600`）；设置为 `0` 表示只执行一次

## 运行示例

```bash
docker build -t torrent-webui-sidecar -f deploy/sidecar/Dockerfile .

docker run --rm \
  -e LATEST_URL="https://YOUR.DOMAIN/latest.json" \
  -e CHECK_INTERVAL_SEC=3600 \
  -v /path/to/webui:/target \
  torrent-webui-sidecar
```

## 接入后端

你需要让后端实际去“使用”这份目录：

- **qBittorrent**：启用 Alternative WebUI 并指向该目录（不同发行版配置方式不同，建议走同卷挂载）。
- **Transmission**：使用 `--web-home`（或对应的配置项）指向该目录。

