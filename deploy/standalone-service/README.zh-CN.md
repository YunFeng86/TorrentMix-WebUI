# Standalone Service

[English](README.md)

**Standalone Service** 将 WebUI 包装成一个同源网关服务 —— 静态资源托管与后端 API 代理从同一进程、同一端口提供，彻底规避 CORS 与 Cookie 问题。

**功能：**

- 托管 WebUI 静态资源
- 将 `/api/*`（qBittorrent）和 `/transmission/*`（Transmission）反向代理到配置的后端实例
- 提供服务器切换面板（支持预置凭证、延迟显示）
- 支持在浏览器内编辑服务器配置并写回配置文件

## 配置

服务读取 `STANDALONE_CONFIG` 环境变量指向的配置文件（默认：`/config/standalone.json`）。

完整示例见 [`config.example.json`](config.example.json)。

| 字段 | 说明 |
|------|------|
| `defaultServerId` | 启动时默认连接的服务器 ID（省略时取第一个） |
| `servers[].id` | 唯一标识符 |
| `servers[].name` | 展示名称 |
| `servers[].type` | `qbit` 或 `trans` |
| `servers[].baseUrl` | 后端基础 URL（如 `http://qb:8080`） |
| `servers[].username` / `.password` | 预置凭证，实现无感认证 |

## Docker

**构建：**

```bash
docker build -t torrentmix-standalone-service -f deploy/standalone-service/Dockerfile .
```

**运行**（挂载配置文件）：

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/deploy/standalone-service/config.example.json:/config/standalone.json:ro" \
  torrentmix-standalone-service
```

访问 `http://localhost:8080`。

> **在浏览器内编辑配置：** 点击右上角 **切换服务器 → 管理服务器**。保存后配置写回 `STANDALONE_CONFIG`，页面自动重新探测后端。密码不会回显，留空表示保持原值不变。

## 二进制（本地构建）

```bash
# 方式 1：本机 Rust 工具链（推荐）
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service

# macOS / Linux
STANDALONE_CONFIG=deploy/standalone-service/config.example.json \
LISTEN_ADDR=:8080 \
./rust/target/release/standalone-service

# Windows（PowerShell）
$env:STANDALONE_CONFIG = 'deploy/standalone-service/config.example.json'
$env:LISTEN_ADDR = ':8080'
.\rust\target\release\standalone-service.exe

# 方式 2：在 Docker 内构建（无需本地 Rust 环境）
docker run --rm -v "$PWD:/work" -w /work rust:1.78-alpine \
  sh -lc "apk add --no-cache musl-dev && cargo build --manifest-path rust/Cargo.toml --release -p standalone-service"
```


