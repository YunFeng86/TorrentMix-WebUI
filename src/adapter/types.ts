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
}

// qBittorrent sync/maindata 响应
export interface QBSyncResponse {
  rid: number;
  full_update: boolean;
  torrents: Record<string, Partial<QBTorrent>>;
  torrents_removed: string[];
  categories: Record<string, unknown>;
  categories_removed: string[];
  tags: string[];
  tags_removed: string[];
  server_state: unknown;
}
