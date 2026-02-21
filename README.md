# Torrent WebUI（qBittorrent / Transmission）

一个第三方下载器 WebUI：同一套前端代码，适配 qBittorrent（WebAPI v2, v3.2.0+）与 Transmission（RPC，全版本尽量兼容）。

核心目标就一个：**部署方式别折腾用户**。所以仓库同时支持 4 种分发形态（见下文 A/B/C/D）。

## 功能概览

- 自动探测后端类型与版本（qB / Transmission）
- Adapter 层归一化数据模型（UI 不关心后端差异）
- 种子列表：支持虚拟滚动（大列表性能）
- 登录/连接：qB cookie session、Transmission Basic Auth + 409 Session-Id 自动握手

## 本地开发

```bash
npm install
npm run dev
```

开发环境默认走 Vite 代理（见 `vite.config.ts`）：

- qBittorrent: `/api/*` → `http://localhost:8080`
- Transmission: `/transmission/*` → `http://localhost:9091`

## 构建

```bash
npm run build
```

说明：

- 生产构建使用相对 `base`（`./`），因此可部署在子路径（例如 `/transmission/web/`）而不需要重构静态资源路径。
- 推荐生产环境走“同源反代”，避免 CORS 与 cookie 凭证风险（详见 `.env.example` 注释）。

## 分发形态（A/B/C/D）

### A. 智能引导页（Loader）

适用：你想把一个 `index.html` 丢进后端 WebUI 目录里，并且希望“有网就跟随最新版本”。

产物：`loader.html`

- Loader 会去拉取 `latest.json`，再按 `manifest.json` 加载对应版本的 JS/CSS（可带 SRI）。
- 安全提醒：这条路本质是“信任远端脚本”，建议只用于你自己可控的发布源；别把下载器控制权交给不可审计的 CDN。

### B. 独立服务（Standalone）

适用：你希望一个独立端口，WebUI 静态文件与后端 API 由同一个反代出口提供（最稳）。

目录：`deploy/standalone/`

- `deploy/standalone/Dockerfile`：构建静态资源并用 Caddy 提供服务
- `deploy/standalone/Caddyfile`：同源反代

运行时需要配置上游（至少一个）：

- `QB_UPSTREAM`：例如 `http://qbittorrent:8080`
- `TR_UPSTREAM`：例如 `http://transmission:9091`

### C. 侧车模式（Sidecar）

适用：不想暴露额外端口，只想“外部程序定期覆盖后端 WebUI 目录”。

目录：`deploy/sidecar/`

- `deploy/sidecar/updater.mjs`：定期读取 `latest.json`，下载 `full-dist.zip` 校验 sha256 后解压覆盖到 `TARGET_DIR`
- 环境变量：
  - `LATEST_URL`：你的 `latest.json` 地址
  - `TARGET_DIR`：挂载的 WebUI 目录（默认 `/target`）
  - `CHECK_INTERVAL_SEC`：检查间隔（默认 3600）

### D. 离线单文件（Portable）

适用：安全/内网环境，只想下载 1 个 HTML 文件。

产物：`portable.html`

- 把它改名为 `index.html` 放入后端 WebUI 目录即可使用（同源请求后端 API）。
- 注意：**直接双击 file:// 打开**通常无法访问后端（浏览器安全限制），正确方式是让它被后端/反代“作为网页”提供。

## 多产物构建（给 CI / 发版用）

```bash
npm run build:publish
```

输出目录：`artifacts/publish/`

- `latest.json`：版本仲裁（最新版本指向）
- `manifest.json`：最新版本的清单（文件哈希 + 入口）
- `loader.html` / `portable.html`：稳定 URL 版本（始终指向最新）
- `releases/<version>/...`：带版本号的完整发布目录（含 `full-dist.zip`）

## CI/CD（GitHub Actions）

工作流：`.github/workflows/release.yml`

- 推送 tag（例如 `v0.1.0`）时：
  - 跑测试/构建
  - 生成多产物发布目录
  - 创建 GitHub Release 并上传产物
  - 同步 `latest.json` + `releases/` 到 `gh-pages` 分支（用于 Pages / CDN 拉取）
