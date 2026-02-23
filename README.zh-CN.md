<div align="center">

# TorrentMix WebUI

**一套前端，双后端 —— qBittorrent & Transmission 通用**

[![Build](https://img.shields.io/github/actions/workflow/status/YunFeng86/TorrentMix-WebUI/release.yml?style=flat-square&label=构建)](../../actions) [![Release](https://img.shields.io/github/v/release/YunFeng86/TorrentMix-WebUI?style=flat-square)](../../releases/latest) [![License](https://img.shields.io/github/license/YunFeng86/TorrentMix-WebUI?style=flat-square)](LICENSE) [![Vue](https://img.shields.io/badge/Vue-3.5-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

[快速开始](#快速开始) · [部署方案](#部署方案) · [本地开发](#本地开发) · [贡献指南](#贡献指南)

[English](README.md)

</div>

---

一款适配 **qBittorrent**（WebAPI v2，v3.2.0+）与 **Transmission**（RPC，全版本兼容）的第三方下载器 WebUI，同一份代码，两个后端。

仓库同时提供四种分发形态，按需取用。

## 特性

- 🔍 **自动探测后端** — 启动时自动识别 qBittorrent / Transmission，免手动配置
- 🌉 **Adapter 归一化层** — UI 完全不感知后端差异，所有数据流经统一模型
- ⚡ **虚拟滚动列表** — 基于 `@tanstack/vue-virtual`，数千种子流畅渲染
- 🔐 **安全认证** — qB cookie session；Transmission Basic Auth + 409 Session-Id 自动握手
- 📱 **移动端响应式** — Tailwind 断点自适应，触屏友好
- 🚀 **增量同步** — 利用 qBittorrent `sync/maindata` RID 机制减少带宽消耗
- 🛡️ **熔断 & 退避** — 连续失败自动指数退避，网络恢复后自动续传

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Vue 3 · TypeScript · Vite |
| 样式 | Tailwind CSS · Shadcn Vue |
| 状态 | Pinia · `shallowRef<Map>` 高性能存储 |
| 网络 | Axios · 自定义拦截器 |
| 性能 | @tanstack/vue-virtual · Fuse.js |

## 快速开始

> **最快路径（Zip）**：从 [Releases](../../releases/latest) 下载 `dist.zip`，解压到后端 WebUI 目录即可。无需任何构建步骤。

### Docker（Standalone 模式，最稳）

```bash
docker run -d \
  -p 8888:8888 \
  -e QB_URL=http://your-qbit:8080 \
  yunfeng86/torrentmix-webui
```

详见 [deploy/standalone-service/README.md](deploy/standalone-service/README.md)。

## 部署方案

根据你的场景选择合适的分发形态：

| 方案 | 适用场景 | 产物 |
|------|---------|------|
| **A. Loader**（智能引导页）| 只放一个文件，有网络时自动跟随最新版 | `loader.html` |
| **B. Standalone**（独立服务）| 独立端口 / Docker，多实例管理，最稳定 | Docker 镜像 / 二进制 |
| **C. Sidecar**（侧车模式）| 不暴露额外端口，外部程序定期覆盖 WebUI 目录 | `updater.mjs` |
| **D. Dist**（离线压缩包）| 离线 / 内网，下载一个 zip 解压即可 | `dist.zip` |

### A. Loader — 智能引导页

将 `loader.html` 改名为 `index.html` 放入后端 WebUI 目录。页面加载时拉取 `latest.json`，通过 `manifest.json`（含 SRI 校验）加载对应版本资源。后续升级自动完成，无需再次替换文件。

```
# 固定版本（可选）
?ver=0.1.0   或   ?tag=v0.1.0
```

你也可以在 Loader 页面里“固定/解除”版本（存储于 `localStorage`）。管理员也可在同目录放置 `config.json`：

```json
{ "latestUrl": "https://YOUR.DOMAIN/latest.json", "pinnedVersion": "0.1.0" }
```

优先级：URL 参数（`?ver`）> 浏览器固定（`localStorage`）> `config.json`。

> ⚠️ 此方案本质上是信任远端脚本，仅建议用于自己可控的发布源。

### B. Standalone — 独立服务

WebUI 静态文件与反代网关共享同源出口，彻底规避 CORS 问题，同时支持多后端实例管理。

- Docker 部署：[deploy/standalone-service/](deploy/standalone-service/)
- 二进制部署：[rust/apps/standalone-service/](rust/apps/standalone-service/)

### C. Sidecar — 侧车模式

定期从发布源拉取 `dist.zip`，校验 SHA-256 后解压覆盖目标目录。

```bash
LATEST_URL=https://your-release-host/latest.json \
TARGET_DIR=/path/to/webui \
CHECK_INTERVAL_SEC=3600 \
node deploy/sidecar/updater.mjs
```

### D. Dist — 离线压缩包

从 Releases 下载 `dist.zip`，解压到 qBittorrent / Transmission 的 WebUI 目录，刷新即可。

> ⚠️ 不支持 `file://` 直接打开（浏览器安全限制），需由后端或反代作为网页提供。

## 本地开发

**环境要求**：Node.js 20+，npm 10+

```bash
git clone https://github.com/YunFeng86/TorrentMix-WebUI.git
cd TorrentMix-WebUI
npm install
npm run dev
```

Vite 开发代理已预配置（见 [vite.config.ts](vite.config.ts)）：

```
qBittorrent   /api/*           → http://localhost:8080
Transmission  /transmission/*  → http://localhost:9091
```

### 可用命令

```bash
npm run dev           # 启动开发服务器
npm run build         # 生产构建（静态资源）
npm run build:publish # 多产物构建（CI/发版用）
npm run test          # 运行测试套件
npm run lint          # ESLint 检查
npm run preview       # 本地预览生产构建
```

### 多产物构建

```bash
npm run build:publish
```

输出至 `artifacts/publish/`：

```
artifacts/publish/
├── latest.json              # 版本仲裁（最新版本指向）
├── manifest.json            # 文件哈希 + 入口清单
├── loader.html              # 智能引导页（稳定 URL）
└── releases/
    └── <version>/
        ├── dist.zip         # 离线 Payload 包（含 SHA-256 校验）
        └── ...
```

## CI/CD

基于 GitHub Actions（[`.github/workflows/release.yml`](.github/workflows/release.yml)）。

推送 Tag（如 `v0.1.0`）时自动触发：

1. 运行测试 & 构建
2. 生成多产物发布目录
3. 创建 GitHub Release 并上传产物
4. 将 `latest.json` + `releases/<version>/` 同步到 `gh-pages` 分支

## 贡献指南

欢迎 PR 和 Issue！提交前请：

1. 阅读 [Claude.md](Claude.md) 了解架构约定（Adapter / Network / State / View 四层边界）
2. 确保 `npm run lint` 和 `npm test` 均通过
3. Commit 信息遵循 [Conventional Commits](https://www.conventionalcommits.org/) 格式（如 `feat:`、`fix:`）
4. UI 变更请附截图或 GIF

## 许可证

[MIT](LICENSE)
