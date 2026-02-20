# Changelog

## Unreleased

### Breaking changes

- Transmission RPC 默认地址调整：生产环境未设置 `VITE_TR_URL` 时，WebUI 将默认请求同源的 `/transmission/rpc`，不再默认指向 `http://localhost:9091/transmission/rpc`。

  Migration（任选其一）:

  1) 推荐：在同域反向代理 `/transmission/rpc` 到 Transmission。

  Nginx 示例：

  ```nginx
  location = /transmission/rpc {
    proxy_pass http://127.0.0.1:9091;
  }
  ```

  Caddy 示例：

  ```caddy
  handle /transmission/rpc* {
    reverse_proxy 127.0.0.1:9091
  }
  ```

  2) 兼容旧行为：构建时显式设置 `VITE_TR_URL`（例如 `http://localhost:9091/transmission/rpc`）。

