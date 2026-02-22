<div align="center">

# TorrentMix WebUI

**One frontend. Two backends. Zero compromise.**

[![Build](https://img.shields.io/github/actions/workflow/status/YunFeng86/TorrentMix-WebUI/release.yml?style=flat-square&label=build)](../../actions) [![Release](https://img.shields.io/github/v/release/YunFeng86/TorrentMix-WebUI?style=flat-square)](../../releases/latest) [![License](https://img.shields.io/github/license/YunFeng86/TorrentMix-WebUI?style=flat-square)](LICENSE) [![Vue](https://img.shields.io/badge/Vue-3.5-42b883?style=flat-square&logo=vue.js)](https://vuejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

[Getting Started](#getting-started) · [Deployment](#deployment) · [Local Development](#local-development) · [Contributing](#contributing)

[中文文档](README.zh-CN.md)

</div>

---

A third-party downloader WebUI that works with both **qBittorrent** (WebAPI v2, v3.2.0+) and **Transmission** (RPC, all versions) — from a single codebase.

The core goal is simple: **don't make deployment a pain**. The repo ships four distribution formats so you can pick whatever fits your setup.

## Features

- 🔍 **Auto-detect backend** — Identifies qBittorrent or Transmission on startup, no manual config needed
- 🌉 **Adapter normalization** — UI never touches backend-specific types; all data flows through a unified model
- ⚡ **Virtual scrolling** — Powered by `@tanstack/vue-virtual`, handles thousands of torrents without breaking a sweat
- 🔐 **Secure auth** — qB cookie session; Transmission Basic Auth with automatic 409 Session-Id handshake
- 📱 **Mobile-responsive** — Tailwind breakpoints + touch-friendly layout
- 🚀 **Incremental sync** — Uses qBittorrent `sync/maindata` RID to minimize bandwidth
- 🛡️ **Circuit breaker & backoff** — Exponential retry on failure, auto-resume on reconnect

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Vue 3 · TypeScript · Vite |
| Styling | Tailwind CSS · Shadcn Vue |
| State | Pinia · `shallowRef<Map>` for high-throughput storage |
| Network | Axios · custom interceptors |
| Performance | @tanstack/vue-virtual · Fuse.js |

## Getting Started

> **Quickest path (Portable):** Download `portable.html` from [Releases](../../releases/latest), rename it to `index.html`, drop it into your backend's WebUI directory — done. No build step required.

### Docker (Standalone — most stable)

```bash
docker run -d \
  -p 8888:8888 \
  -e QB_URL=http://your-qbit:8080 \
  yunfeng86/torrentmix-webui
```

See [deploy/standalone-service/README.md](deploy/standalone-service/README.md) for full options.

## Deployment

Pick the distribution format that fits your setup:

| Mode | Best for | Artifact |
|------|----------|----------|
| **A. Loader** | Drop one file in, auto-update from a release host | `loader.html` |
| **B. Standalone** | Dedicated port / Docker, multi-instance, most reliable | Docker image / binary |
| **C. Sidecar** | No extra port; an external process overwrites the WebUI directory | `updater.mjs` |
| **D. Portable** | Air-gapped / LAN — just download one HTML file | `portable.html` |

### A. Loader

Rename `loader.html` to `index.html` and place it in the backend WebUI directory. On load it fetches `latest.json`, then loads the correct JS/CSS bundle via `manifest.json` (SRI-verified). Future upgrades happen automatically — no file replacement needed.

```
# Pin to a specific version (optional)
?ver=0.1.0   or   ?tag=v0.1.0
```

> ⚠️ This mode inherently trusts the remote script host. Only use it with a release source you control.

### B. Standalone

The WebUI static files and reverse-proxy gateway share the same origin, eliminating CORS issues. Supports managing multiple backend instances.

- Docker: [deploy/standalone-service/](deploy/standalone-service/)
- Binary: [rust/apps/standalone-service/](rust/apps/standalone-service/)

### C. Sidecar

Periodically fetches `full-dist.zip` from a release host, verifies SHA-256, and extracts it into the target directory.

```bash
LATEST_URL=https://your-release-host/latest.json \
TARGET_DIR=/path/to/webui \
CHECK_INTERVAL_SEC=3600 \
node deploy/sidecar/updater.mjs
```

### D. Portable

Download `portable.html` from Releases, rename it to `index.html`, place it in the qBittorrent or Transmission WebUI directory, and refresh.

> ⚠️ Opening via `file://` won't work (browser security restrictions). It must be served by the backend or a reverse proxy.

## Local Development

**Requirements:** Node.js 20+, npm 10+

```bash
git clone https://github.com/YunFeng86/TorrentMix-WebUI.git
cd TorrentMix-WebUI
npm install
npm run dev
```

Vite dev proxy is pre-configured in [vite.config.ts](vite.config.ts):

```
qBittorrent   /api/*           → http://localhost:8080
Transmission  /transmission/*  → http://localhost:9091
```

### Scripts

```bash
npm run dev           # Start dev server
npm run build         # Production build (static assets)
npm run build:publish # Multi-artifact build for releases
npm run test          # Run test suite
npm run lint          # ESLint
npm run preview       # Preview production build locally
```

### Release Build

```bash
npm run build:publish
```

Outputs to `artifacts/publish/`:

```
artifacts/publish/
├── latest.json              # Version pointer (latest release)
├── manifest.json            # File hashes + entrypoint
├── loader.html              # Auto-updating loader (stable URL)
├── portable.html            # Offline single-file build (stable URL)
└── releases/
    └── <version>/
        ├── full-dist.zip    # Full bundle with SHA-256 checksum
        └── ...
```

## CI/CD

Powered by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

Push a tag (e.g. `v0.1.0`) to trigger:

1. Run tests & build
2. Generate multi-artifact release directory
3. Create GitHub Release and upload artifacts
4. Sync `latest.json` + `releases/<version>/` to the `gh-pages` branch

## Contributing

PRs and issues are welcome! Before submitting:

1. Read [Claude.md](Claude.md) for architecture conventions (Adapter / Network / State / View layer boundaries)
2. Make sure `npm run lint` and `npm test` pass
3. Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.)
4. Include screenshots or GIFs for UI changes

## License

[MIT](LICENSE)
