// 种子状态类型
export type TorrentState =
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'checking'
  | 'error'
  | 'queued'

// 统一种子接口
export interface UnifiedTorrent {
  id: string;          // qB: hash
  name: string;
  state: TorrentState;
  progress: number;    // 0.0 - 1.0
  size: number;        // bytes
  dlspeed: number;     // bytes/s
  upspeed: number;     // bytes/s
  eta: number;         // seconds, -1 = infinity
  ratio: number;
  addedTime: number;   // unix timestamp
  savePath: string;
  // 扩展字段
  category?: string;
  tags?: string[];
  // 做种/下载者统计
  // - connected*: 当前已连接的做种/下载者（类似 qB WebUI 的 Seeds/Peers 左侧数字）
  // - total*: Swarm 总做种/总下载者（类似 qB WebUI 的括号数字）
  // - numSeeds/numPeers: 为兼容旧 UI 的“最佳可用值”（优先 total，其次 connected）
  connectedSeeds?: number;
  connectedPeers?: number;
  totalSeeds?: number;
  totalPeers?: number;
  numSeeds?: number;
  numPeers?: number;
}

// 分类接口
export interface Category {
  name: string;
  savePath: string;
}

// 服务器状态接口（阶段 5 使用，预留）
export interface ServerState {
  dlInfoSpeed: number;
  upInfoSpeed: number;
  dlRateLimit: number;
  upRateLimit: number;
  connectionStatus: 'connected' | 'firewalled' | 'disconnected';
  peers: number;
  freeSpaceOnDisk: number;
  useAltSpeed: boolean;
  altDlLimit: number;
  altUpLimit: number;
  // 后端版本信息
  backendName?: string;   // 如 'qBittorrent', 'Transmission'
  backendVersion?: string; // 如 'v5.0.4', '4.0.6'
  apiVersion?: string;    // WebAPI 版本，如 '2.11.2'
}

// qBittorrent 原始响应类型
export interface QBTorrent {
  hash: string;
  name: string;
  state: string;
  progress: number;    // 0.0 - 1.0 (percentage/100)
  size: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  ratio: number;
  added_on: number;
  save_path: string;
  category?: string;
  tags?: string;
  num_seeds?: number;
  num_leechs?: number;
  // 一些 qB 版本/接口会返回 Swarm 统计（总做种/总下载）
  num_complete?: number;
  num_incomplete?: number;
}

// qBittorrent sync/maindata 响应
export interface QBSyncResponse {
  rid: number;
  full_update?: boolean;
  torrents?: Record<string, Partial<QBTorrent>>;
  torrents_removed?: string[];
  categories?: Record<string, { name?: string; savePath: string }>;
  categories_removed?: string[];
  tags?: string[];
  tags_removed?: string[];
  server_state?: QBServerState;
}

// qBittorrent server_state 结构
export interface QBServerState {
  // NOTE: /sync/maindata 的 server_state 往往是“增量字段”，很多字段可能缺失。
  // 因此这里全部定义为可选，调用方需用 `'key' in raw` 区分“缺失”与“值为 0”。
  dl_info_speed?: number;
  dl_info_data?: number;
  up_info_speed?: number;
  up_info_data?: number;
  dl_rate_limit?: number;
  up_rate_limit?: number;
  dht_nodes?: number;
  connection_status?: string;
  peers?: number;
  free_space_on_disk?: number;
  queueing?: boolean;
  refresh_interval?: number;
  // 文档字段（transferInfo/server_state）：是否启用备用限速
  use_alt_speed_limits?: boolean;
  // 兼容：部分实现可能使用非文档字段名
  use_alt_speed?: boolean;
  // 兼容：部分实现可能附带备用限速值（通常在 preferences 里）
  alt_dl_limit?: number;
  alt_up_limit?: number;
}

// ============ 种子详情相关接口 ============

// 统一种子详情接口
export interface UnifiedTorrentDetail {
  // 基本信息
  hash: string
  name: string
  /**
   * 是否为“部分读取成功”的结果（某些端点被 404/403/反代拦截等场景）。
   * 用于 UI 提示：当前展示值可能是 fallback/default，并不代表后端真实数据。
   */
  partial?: boolean
  size: number
  completed: number      // 已下载字节数
  uploaded: number       // 已上传字节数
  dlLimit: number        // 下载限速 (-1 无限制)
  upLimit: number        // 上传限速 (-1 无限制)
  seedingTime: number    // 做种时长(秒)
  addedTime: number
  completionOn: number   // 完成时间戳 (0 未完成)
  savePath: string
  category: string
  tags: string[]

  // 连接信息（实际连接数）
  connections: number
  numSeeds: number        // 已连接的种子数
  numLeechers: number     // 已连接的下载者数

  // Swarm 统计（整个 swarn 的总数）
  totalSeeds?: number     // Swarm 中的总种子数
  totalLeechers?: number  // Swarm 中的总下载者数

  // 详情数据
  files: TorrentFile[]
  trackers: Tracker[]
  peers: Peer[]

  // ========== 高级能力（按后端支持情况） ==========
  autoManagement?: boolean
  sequentialDownload?: boolean
  firstLastPiecePriority?: boolean
  superSeeding?: boolean
  bandwidthPriority?: 'low' | 'normal' | 'high'
}

// 文件信息
export interface TorrentFile {
  id: number
  name: string
  size: number
  progress: number
  priority: 'high' | 'normal' | 'low' | 'do_not_download'
}

// Tracker 信息
export interface Tracker {
  url: string
  status: 'working' | 'updating' | 'not_working' | 'disabled'
  msg: string
  peers: number
  tier: number
}

// Peer 信息
export interface Peer {
  ip: string
  port: number
  client: string
  progress: number
  dlSpeed: number
  upSpeed: number
  downloaded: number
  uploaded: number
}

// qBittorrent /torrents/info 响应（只列出详情页用到的字段）
export interface QBTorrentInfo {
  hash: string
  name: string
  size?: number
  total_size?: number
  progress?: number
  completed?: number
  uploaded?: number
  dl_limit?: number
  up_limit?: number
  seeding_time?: number
  added_on?: number
  completion_on?: number
  save_path?: string
  category?: string
  tags?: string
  num_seeds?: number
  num_leechs?: number
  num_complete?: number
  num_incomplete?: number
  auto_tmm?: boolean
  seq_dl?: boolean
  f_l_piece_prio?: boolean
  super_seeding?: boolean
}

// qBittorrent /torrents/properties（Get torrent generic properties）响应
export interface QBTorrentGenericProperties {
  save_path: string
  creation_date: number
  piece_size: number
  comment: string
  total_wasted: number
  total_uploaded: number
  total_uploaded_session: number
  total_downloaded: number
  total_downloaded_session: number
  up_limit: number
  dl_limit: number
  time_elapsed: number
  seeding_time: number
  nb_connections: number
  nb_connections_limit: number
  share_ratio: number
  addition_date: number
  completion_date: number
  created_by: string
  dl_speed_avg: number
  dl_speed: number
  eta: number
  last_seen: number
  peers: number
  peers_total: number
  pieces_have: number
  pieces_num: number
  reannounce: number
  seeds: number
  seeds_total: number
  total_size: number
  up_speed_avg: number
  up_speed: number
  isPrivate: boolean
}

// qBittorrent 文件信息
export interface QBFile {
  // qB WebUI API uses `index` as the stable file id (since WebAPI 2.8.2).
  // Some older responses may omit `index`; keep `id` as a fallback.
  index?: number
  id?: number
  name: string
  size: number
  progress: number
  priority: number
}

// qBittorrent Tracker 信息
export interface QBTracker {
  url: string
  status: number
  msg: string
  num_peers: number
  tier: number
}

// qBittorrent Peer 信息
export interface QBPeer {
  ip: string
  port: number
  client: string
  progress: number
  dl_speed: number
  up_speed: number
  downloaded: number
  uploaded: number
}
