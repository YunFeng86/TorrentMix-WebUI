# Adapter Notes (qBittorrent)

这份文档是“本仓库实现视角”的补充说明：同样面对 qBittorrent WebUI API，不同客户端最容易踩坑的点不在“有哪些字段”，而在“哪些字段会缺失/增量下发/用异常值表达未知”。本仓库的 Adapter 层做了增量合并与数据清洗，目标是消除 UI 闪烁、降低反代/权限差异带来的崩溃概率，并让降级行为可被 UI 感知。

相关实现位置：
- `src/adapter/qbit/base.ts`
- `src/adapter/types.ts`
- `src/components/BackendSettingsDialog.vue`

## 数据流（高层）

```mermaid
flowchart TD
  UI["UI (Vue)"] -->|轮询| Ctx["useTorrentContext.refreshList()"]
  Ctx -->|fetchList()| Qbit["QbitAdapter.fetchList()"]
  Qbit -->|"GET /api/v2/sync/maindata?rid=..."| API["qBittorrent WebUI API"]
  API --> Qbit
  Qbit -->|"normalize + 增量合并"| Stores["torrentStore + backendStore"]
  Stores --> UI

  UI -->|打开详情| Detail["adapter.fetchDetail(hash)"]
  Detail -->|"GET /torrents/info + /torrents/properties\n+ /torrents/files + /torrents/trackers\n+ /sync/torrentPeers"| API

  UI -->|打开设置| Settings["adapter.getTransferSettings() / setTransferSettings()"]
  Settings -->|"GET /sync/maindata + /transfer/speedLimitsMode + /app/preferences"| API
```

## 关键策略

### 1) `/sync/maindata` 是 diff 语义（不是全量快照）

- `torrents` / `categories` / `tags` / `server_state` 都可能“缺字段”（未下发 ≠ 值为 0）。
- 增量合并必须用 `'key' in raw` 来区分“缺失”与“显式为 0”。
- `full_update` 通常意味着快照，但一些后端实现会在 `full_update` 时省略 `categories/tags` 字段；本仓库在这种情况下不清空缓存，避免 UI 闪白。

### 2) `server_state` 增量合并（The “Flicker” Fix）

- 只更新这次响应里真的出现的字段：缺失字段继续沿用上次缓存值。
- `normalizeServerState()` 加了轻量 runtime guard（`safeNum/safeBool`），防止后端意外返回 `"1024"` 导致前端计算出现字符串拼接这类“幽灵 Bug”。

### 3) Swarm 统计的 `-1` 代表 unknown

- `num_complete/num_incomplete == -1` 在语义上是“未知”，不是“负数计数”；应归一化为 `undefined`。
- UI 侧兼容字段 `numSeeds/numPeers` 用作“最佳可用值”：优先 `total*`，其次 `connected*`，避免旧 UI 只读 `num*` 时失真。

### 4) 传输设置读取的降级模式（`TransferSettings.partial`）

常见坑：反代/权限策略会单独拦截某些端点（返回 403/404/405），导致客户端“读不到备用限速值/状态”。

- 备用限速开关：优先 `GET /transfer/speedLimitsMode`，失败时回退 `server_state.use_alt_speed_limits` / `server_state.use_alt_speed`。
- 备用限速值：来自 `GET /app/preferences`（`alt_dl_limit/alt_up_limit`，单位 KiB/s）。
- 若上述端点部分失败，返回 `TransferSettings.partial = true`，UI 可明确提示“当前显示值可能是 fallback，占位 0 不代表真实配置”。

### 5) 详情页数据源与降级（`UnifiedTorrentDetail.partial`）

- 主数据源：`GET /torrents/info`（详情页需要的核心字段更集中）。
- 补充数据源：`GET /torrents/properties`（连接数、总上传/下载、部分 swarm 统计等）。
- `files/trackers/peers` 分别由各自端点返回。
- 当 `/torrents/info` 因 404/405/500 不可用时，降级为 `properties + 本地列表缓存（currentMap）` 组装“最小可用详情”，并标记 `UnifiedTorrentDetail.partial = true`，避免详情页直接报错退出。

