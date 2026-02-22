# Rust Workspace

[English](README.md)

所有 Rust 代码集中在此目录，避免散落在仓库各处。

## Crate 说明

| Crate | 描述 |
|-------|------|
| `crates/gateway` | 同源网关 — 代理 `/api/*` 和 `/transmission/*`，以及 Standalone 的服务器管理 API |
| `apps/standalone-service` | **Standalone Service** 部署形态的无头二进制 |
| `apps/desktop` | Tauri 桌面端 — 在 `127.0.0.1:0` 启动 `gateway`，并将 WebView 指向该地址 |

## 构建

从仓库根目录执行：

```bash
# 构建 standalone service 二进制
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service

# 构建桌面端
cargo build --manifest-path rust/Cargo.toml -p torrentmix-desktop
```
