import { apiClient } from '@/api/client'
import type { UnifiedTorrent, QBTorrent, QBSyncResponse, TorrentState } from './types'

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

export class QbitAdapter {
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
        map.set(hash, this.normalize(torrent as QBTorrent))
      }
      this.currentMap = map
    } else {
      // 增量更新：合并到现有 Map
      for (const [hash, torrent] of Object.entries(data.torrents || {})) {
        const existing = this.currentMap.get(hash)
        if (existing) {
          // 合并增量数据到现有数据
          const merged: UnifiedTorrent = {
            ...existing,
            // 只更新 torrent 中存在的字段
            ...(torrent.state !== undefined && { state: STATE_MAP[torrent.state] || 'error' }),
            ...(torrent.progress !== undefined && { progress: torrent.progress }),
            ...(torrent.dlspeed !== undefined && { dlspeed: torrent.dlspeed }),
            ...(torrent.upspeed !== undefined && { upspeed: torrent.upspeed }),
            ...(torrent.eta !== undefined && { eta: torrent.eta }),
            ...(torrent.ratio !== undefined && { ratio: torrent.ratio })
          }
          this.currentMap.set(hash, merged)
        }
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
  private normalize(raw: QBTorrent): UnifiedTorrent {
    return {
      id: raw.hash,
      name: raw.name,
      state: STATE_MAP[raw.state] || 'error',
      progress: raw.progress,  // qB: 0 = 0%, 1 = 100%
      size: raw.size,
      dlspeed: raw.dlspeed,
      upspeed: raw.upspeed,
      eta: raw.eta,
      ratio: raw.ratio,
      addedTime: raw.added_on,
      savePath: raw.save_path
    }
  }
}
