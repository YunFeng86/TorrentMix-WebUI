import { apiClient } from '@/api/client'
import type { UnifiedTorrent, QBTorrent, QBSyncResponse, TorrentState } from './types'
import type { BaseAdapter } from './interface'

// 状态映射表 - 消除 if-else
const STATE_MAP: Record<string, TorrentState> = {
  downloading: 'downloading',
  uploading: 'seeding',
  pausedDL: 'paused',
  pausedUP: 'paused',
  queuedDL: 'queued',
  queuedUP: 'queued',
  stalledDL: 'downloading',
  stalledUP: 'seeding',
  checkingDL: 'checking',
  checkingUP: 'checking',
  error: 'error',
  metaDL: 'downloading'
}

export class QbitAdapter implements BaseAdapter {
  private rid = 0
  private currentMap = new Map<string, UnifiedTorrent>()

  // 获取种子列表（使用 sync/maindata 增量更新）
  async fetchList(): Promise<Map<string, UnifiedTorrent>> {
    const { data } = await apiClient.get<QBSyncResponse>('/api/v2/sync/maindata', {
      params: { rid: this.rid }
    })

    this.rid = data.rid

    // 全量更新：直接替换
    if (data.full_update) {
      const map = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of Object.entries(data.torrents || {})) {
        map.set(hash, this.normalize(hash, torrent))
      }
      this.currentMap = map
    } else {
      // 增量更新：合并到现有 Map
      for (const [hash, torrent] of Object.entries(data.torrents || {})) {
        const existing = this.currentMap.get(hash)
        this.currentMap.set(hash, this.normalize(hash, torrent, existing))
      }

      // 处理删除的种子
      for (const hash of data.torrents_removed || []) {
        this.currentMap.delete(hash)
      }
    }

    return this.currentMap
  }

  // 暂停种子
  async pause(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/pause', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  // 恢复种子
  async resume(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/resume', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  // 删除种子
  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    await apiClient.post('/api/v2/torrents/delete', null, {
      params: {
        hashes: hashes.join('|') || 'all',
        deleteFiles: deleteFiles.toString()
      }
    })
  }

  // 归一化：qBittorrent → UnifiedTorrent
  private normalize(hash: string, raw: Partial<QBTorrent>, existing?: UnifiedTorrent): UnifiedTorrent {
    return {
      id: hash, // qB sync/maindata: key is hash; value may omit hash
      name: raw.name ?? existing?.name ?? '',
      state: raw.state ? (STATE_MAP[raw.state] || 'error') : (existing?.state ?? 'error'),
      progress: raw.progress ?? existing?.progress ?? 0,
      size: raw.size ?? existing?.size ?? 0,
      dlspeed: raw.dlspeed ?? existing?.dlspeed ?? 0,
      upspeed: raw.upspeed ?? existing?.upspeed ?? 0,
      eta: raw.eta ?? existing?.eta ?? -1,
      ratio: raw.ratio ?? existing?.ratio ?? 0,
      addedTime: raw.added_on ?? existing?.addedTime ?? 0,
      savePath: raw.save_path ?? existing?.savePath ?? ''
    }
  }
}
