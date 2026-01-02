import { apiClient, silentApiClient } from '@/api/client'
import type { UnifiedTorrent, QBTorrent, QBSyncResponse, TorrentState, Category, ServerState } from './types'
import type { BaseAdapter, AddTorrentParams, FetchListResult } from './interface'

// 状态映射表 - qBittorrent 完整状态映射
// 参考: https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(TorrentsManagement)
const STATE_MAP: Record<string, TorrentState> = {
  // 下载相关 - 映射为 downloading
  downloading: 'downloading',
  stalledDL: 'downloading',      // 无活跃连接的下载
  metaDL: 'downloading',         // 下载元数据
  forcedDL: 'downloading',       // 强制下载

  // 上传相关 - 映射为 seeding
  uploading: 'seeding',
  stalledUP: 'seeding',          // 无活跃连接的上传
  forcedUP: 'seeding',           // 强制上传

  // 暂停
  pausedDL: 'paused',
  pausedUP: 'paused',

  // 队列
  queuedDL: 'queued',
  queuedUP: 'queued',
  queuedForChecking: 'queued',

  // 检查
  checkingDL: 'checking',
  checkingUP: 'checking',
  checkingResumeData: 'checking',

  // 其他
  error: 'error',
  missingFiles: 'error',         // 文件缺失（确实是错误）
  moving: 'checking'             // 移动文件中（不算错误，展示为检查中）
}

export class QbitAdapter implements BaseAdapter {
  private rid = 0
  private currentMap = new Map<string, UnifiedTorrent>()
  private currentCategories = new Map<string, Category>()
  private currentTags: string[] = []
  private consecutiveErrors = 0  // 连续错误计数，用于检测 RID 失效

  // 获取种子列表（使用 sync/maindata 增量更新）
  async fetchList(): Promise<FetchListResult> {
    try {
      const { data } = await apiClient.get<QBSyncResponse>('/api/v2/sync/maindata', {
        params: { rid: this.rid }
      })

      // 成功时重置错误计数
      this.consecutiveErrors = 0
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

      // 更新分类（增量）
      for (const [name, cat] of Object.entries(data.categories || {})) {
        this.currentCategories.set(name, { name, savePath: cat.savePath })
      }
      for (const name of data.categories_removed || []) {
        this.currentCategories.delete(name)
      }

      // 更新标签（增量）
      const tagSet = new Set(this.currentTags)
      for (const tag of data.tags || []) {
        tagSet.add(tag)
      }
      for (const tag of data.tags_removed || []) {
        tagSet.delete(tag)
      }
      this.currentTags = Array.from(tagSet)

      // 构造返回结果
      return {
        torrents: this.currentMap,
        categories: new Map(this.currentCategories),
        tags: [...this.currentTags],
        serverState: this.normalizeServerState(data.server_state)
      }
    } catch (error) {
      this.consecutiveErrors++

      // RID 失效检测：连续 2 次错误时重置 RID 并重试一次
      // (qB 重启或 RID 超时后，返回 400 Bad Request 或其他错误)
      if (this.consecutiveErrors >= 2) {
        console.warn('[QbitAdapter] RID 可能失效，重置并全量刷新')
        this.rid = 0
        this.consecutiveErrors = 0

        // 重试一次（避免无限递归）
        try {
          const { data } = await apiClient.get<QBSyncResponse>('/api/v2/sync/maindata', {
            params: { rid: 0 }
          })
          this.rid = data.rid

          const map = new Map<string, UnifiedTorrent>()
          for (const [hash, torrent] of Object.entries(data.torrents || {})) {
            map.set(hash, this.normalize(hash, torrent))
          }
          this.currentMap = map

          // 重新提取分类和标签
          const categories = new Map<string, Category>()
          for (const [name, cat] of Object.entries(data.categories || {})) {
            categories.set(name, { name, savePath: cat.savePath })
          }
          this.currentCategories = categories

          const tags = data.tags || []
          this.currentTags = tags

          return {
            torrents: this.currentMap,
            categories,
            tags,
            serverState: this.normalizeServerState(data.server_state)
          }
        } catch (retryError) {
          console.error('[QbitAdapter] RID 重置后重试失败', retryError)
          throw retryError
        }
      }

      throw error
    }
  }

  // 归一化服务器状态
  private normalizeServerState(raw: unknown): ServerState | undefined {
    if (!raw || typeof raw !== 'object') return undefined

    const state = raw as Record<string, unknown>
    return {
      dlInfoSpeed: (state.dl_info_speed as number) ?? 0,
      upInfoSpeed: (state.up_info_speed as number) ?? 0,
      dlRateLimit: (state.dl_rate_limit as number) ?? 0,
      upRateLimit: (state.up_rate_limit as number) ?? 0,
      connectionStatus: (state.connection_status as string) === 'connected' ? 'connected' : 'disconnected',
      peers: (state.peers as number) ?? 0,
      freeSpaceOnDisk: (state.free_space_on_disk as number) ?? 0,
      useAltSpeed: (state.use_alt_speed as boolean) ?? false,
      altDlLimit: (state.alt_dl_limit as number) ?? 0,
      altUpLimit: (state.alt_up_limit as number) ?? 0
    }
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

  // 添加种子
  async addTorrent(params: AddTorrentParams): Promise<void> {
    const formData = new FormData()

    // 处理 URLs（magnet 链接或 HTTP 链接）
    if (params.urls?.trim()) {
      formData.append('urls', params.urls.trim())
    }

    // 处理 .torrent 文件
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        formData.append('torrents', file)
      }
    }

    // 可选参数
    if (params.savepath) {
      formData.append('savepath', params.savepath)
    }
    if (params.category) {
      formData.append('category', params.category)
    }
    if (params.tags && params.tags.length > 0) {
      formData.append('tags', params.tags.join(','))
    }
    if (params.paused) {
      formData.append('paused', 'true')
    }
    if (params.skip_checking) {
      formData.append('skip_checking', 'true')
    }

    await apiClient.post('/api/v2/torrents/add', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  }

  // 登录认证
  async login(username: string, password: string): Promise<void> {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)

    const response = await apiClient.post('/api/v2/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    if (response.data !== 'Ok.') {
      throw new Error(response.data === 'Fails.'
        ? '用户名或密码错误'
        : `登录失败: ${response.data}`)
    }
  }

  // 登出
  async logout(): Promise<void> {
    await apiClient.post('/api/v2/auth/logout').catch(() => {})
  }

  // 静默验证 session
  async checkSession(): Promise<boolean> {
    try {
      await silentApiClient.get('/api/v2/app/version')
      return true
    } catch {
      return false
    }
  }

  // 归一化：qBittorrent → UnifiedTorrent
  private normalize(hash: string, raw: Partial<QBTorrent>, existing?: UnifiedTorrent): UnifiedTorrent {
    const rawState = raw.state

    // 状态映射：未知状态记录警告
    let normalizedState: TorrentState
    if (rawState) {
      normalizedState = STATE_MAP[rawState] ?? 'error'
      if (!STATE_MAP[rawState]) {
        console.warn(`[QbitAdapter] Unknown qB state: "${rawState}", treating as error. Hash: ${hash.slice(0, 8)}...`)
      }
    } else {
      normalizedState = existing?.state ?? 'error'
    }

    return {
      id: hash,
      name: raw.name ?? existing?.name ?? '',
      state: normalizedState,
      progress: raw.progress ?? existing?.progress ?? 0,
      size: raw.size ?? existing?.size ?? 0,
      dlspeed: raw.dlspeed ?? existing?.dlspeed ?? 0,
      upspeed: raw.upspeed ?? existing?.upspeed ?? 0,
      eta: raw.eta ?? existing?.eta ?? -1,
      ratio: raw.ratio ?? existing?.ratio ?? 0,
      addedTime: raw.added_on ?? existing?.addedTime ?? 0,
      savePath: raw.save_path ?? existing?.savePath ?? '',
      // 分类和标签（qB 的 tags 是逗号分隔的字符串，需要转数组）
      category: raw.category || existing?.category,
      tags: raw.tags ? raw.tags.split(',').map(t => t.trim()).filter(Boolean) : existing?.tags
    }
  }
}
