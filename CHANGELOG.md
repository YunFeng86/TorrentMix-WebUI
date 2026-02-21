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

- CSP 默认收紧：生产构建的 `index.html` 将 `connect-src` 限制为 `'self'`，跨域直连后端（例如 `ui.example.com` → `qb.example.com`）会被浏览器直接拦截。

  Migration（任选其一）:

  1) 推荐：同源反向代理（例如通过 Nginx/Caddy 把 `/api/*` 与 `/transmission/*` 反代到后端），让 WebUI 与后端 API 走同一个 Origin。

  2) 如必须跨域：自行修改 `index.html` 的 CSP `connect-src` 放通目标 Origin（并同时确保后端 CORS/凭证策略安全）。
