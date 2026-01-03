// 种子状态类型
export type TorrentState =
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'checking'
  | 'error'
  | 'queued'

// 种子状态常量
export const TorrentStateValues = {
  Downloading: 'downloading' as const,
  Seeding: 'seeding' as const,
  Paused: 'paused' as const,
  Checking: 'checking' as const,
  Error: 'error' as const,
  Queued: 'queued' as const
}

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
  numSeeds?: number;   // 已连接的种子数（用于健康度计算）
  numPeers?: number;   // 已连接的 Peer 数（用于健康度计算）
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
  connectionStatus: 'connected' | 'disconnected';
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
}

// qBittorrent sync/maindata 响应
export interface QBSyncResponse {
  rid: number;
  full_update: boolean;
  torrents: Record<string, Partial<QBTorrent>>;
  torrents_removed: string[];
  categories: Record<string, { savePath: string }>;
  categories_removed: string[];
  tags: string[];
  tags_removed: string[];
  server_state: QBServerState;
}

// qBittorrent server_state 结构
export interface QBServerState {
  dl_info_speed: number;
  up_info_speed: number;
  dl_rate_limit: number;
  up_rate_limit: number;
  connection_status: string;
  peers: number;
  free_space_on_disk: number;
  use_alt_speed: boolean;
  alt_dl_limit: number;
  alt_up_limit: number;
}

// ============ 种子详情相关接口 ============

// 统一种子详情接口
export interface UnifiedTorrentDetail {
  // 基本信息
  hash: string
  name: string
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

// qBittorrent 种子属性响应
export interface QBTorrentProperties {
  hash: string
  name: string
  size: number
  completed: number
  uploaded: number
  dl_limit: number
  up_limit: number
  seeding_time: number
  added_on: number
  completion_on: number
  save_path: string
  category: string
  tags: string
  connections_limit: number
  num_complete: number
  num_incomplete: number
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
