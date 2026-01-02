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
}

// qBittorrent 原始响应类型
export interface QBTorrent {
  hash: string;
  name: string;
  state: string;
  progress: number;    // 0 - 1000000
  size: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  ratio: number;
  added_on: number;
  save_path: string;
  category?: string;
  tags?: string;
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
