import { apiClient, silentApiClient, getQbitBaseUrl } from '@/api/client'
import axios from 'axios'
import type {
  UnifiedTorrent, QBTorrent, QBSyncResponse, TorrentState, Category, ServerState,
  UnifiedTorrentDetail, TorrentFile, Tracker, Peer,
  QBTorrentProperties, QBFile, QBTracker, QBPeer
} from '../types'
import type { BaseAdapter, AddTorrentParams, FetchListResult } from '../interface'

const STATE_MAP: Record<string, TorrentState> = {
  downloading: 'downloading',
  stalledDL: 'downloading',
  metaDL: 'downloading',
  forcedDL: 'downloading',
  uploading: 'seeding',
  stalledUP: 'seeding',
  forcedUP: 'seeding',
  pausedDL: 'paused',
  pausedUP: 'paused',
  stoppedDL: 'paused',
  stoppedUP: 'paused',
  queuedDL: 'queued',
  queuedUP: 'queued',
  queuedForChecking: 'queued',
  checkingDL: 'checking',
  checkingUP: 'checking',
  checkingResumeData: 'checking',
  error: 'error',
  missingFiles: 'error',
  moving: 'checking'
}

export abstract class QbitBaseAdapter implements BaseAdapter {
  protected rid = 0
  protected currentMap = new Map<string, UnifiedTorrent>()
  protected currentCategories = new Map<string, Category>()
  protected currentTags: string[] = []
  protected consecutiveErrors = 0

  async fetchList(): Promise<FetchListResult> {
    try {
      const { data } = await apiClient.get<QBSyncResponse>('/api/v2/sync/maindata', {
        params: { rid: this.rid }
      })

      this.consecutiveErrors = 0
      this.rid = data.rid

      if (data.full_update) {
        const map = new Map<string, UnifiedTorrent>()
        for (const [hash, torrent] of Object.entries(data.torrents || {})) {
          map.set(hash, this.normalize(hash, torrent))
        }
        this.currentMap = map
      } else {
        for (const [hash, torrent] of Object.entries(data.torrents || {})) {
          const existing = this.currentMap.get(hash)
          this.currentMap.set(hash, this.normalize(hash, torrent, existing))
        }
        for (const hash of data.torrents_removed || []) {
          this.currentMap.delete(hash)
        }
      }

      for (const [name, cat] of Object.entries(data.categories || {})) {
        this.currentCategories.set(name, { name, savePath: cat.savePath })
      }
      for (const name of data.categories_removed || []) {
        this.currentCategories.delete(name)
      }

      const tagSet = new Set(this.currentTags)
      for (const tag of data.tags || []) tagSet.add(tag)
      for (const tag of data.tags_removed || []) tagSet.delete(tag)
      this.currentTags = Array.from(tagSet)

      return {
        torrents: this.currentMap,
        categories: new Map(this.currentCategories),
        tags: [...this.currentTags],
        serverState: this.normalizeServerState(data.server_state)
      }
    } catch (error) {
      this.consecutiveErrors++
      if (this.consecutiveErrors >= 2) {
        this.rid = 0
        this.consecutiveErrors = 0
        const { data } = await apiClient.get<QBSyncResponse>('/api/v2/sync/maindata', { params: { rid: 0 } })
        this.rid = data.rid
        const map = new Map<string, UnifiedTorrent>()
        for (const [hash, torrent] of Object.entries(data.torrents || {})) {
          map.set(hash, this.normalize(hash, torrent))
        }
        this.currentMap = map
        return {
          torrents: this.currentMap,
          categories: new Map(this.currentCategories),
          tags: [...this.currentTags],
          serverState: this.normalizeServerState(data.server_state)
        }
      }
      throw error
    }
  }

  abstract pause(hashes: string[]): Promise<void>
  abstract resume(hashes: string[]): Promise<void>

  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    await apiClient.post('/api/v2/torrents/delete', null, {
      params: { hashes: hashes.join('|') || 'all', deleteFiles: deleteFiles.toString() }
    })
  }

  async addTorrent(params: AddTorrentParams): Promise<void> {
    const formData = new FormData()
    if (params.urls?.trim()) formData.append('urls', params.urls.trim())
    if (params.files) for (const file of params.files) formData.append('torrents', file)
    if (params.savepath) formData.append('savepath', params.savepath)
    if (params.category) formData.append('category', params.category)
    if (params.tags?.length) formData.append('tags', params.tags.join(','))
    if (params.paused) formData.append('paused', 'true')
    if (params.skip_checking) formData.append('skip_checking', 'true')
    await apiClient.post('/api/v2/torrents/add', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  }

  async login(username: string, password: string): Promise<void> {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)

    // 创建专门的登录客户端，避免使用 apiClient 的拦截器（会转换 403 为 AuthError）
    // 同时需要 withCredentials: true 来接收 session cookie
    const loginClient = axios.create({
      baseURL: getQbitBaseUrl(),
      timeout: 10000,
      withCredentials: true
    })

    const response = await loginClient.post('/api/v2/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: (status) => status < 500  // 只接受 2xx-4xx，让业务代码处理
    })

    if (response.status !== 200) {
      // 403 = 登录失败（用户名或密码错误）
      // 其他 = 网络错误或服务器错误
      throw new Error(response.status === 403 ? '用户名或密码错误' : `登录失败: HTTP ${response.status}`)
    }

    if (response.data !== 'Ok.') {
      throw new Error(response.data === 'Fails.' ? '用户名或密码错误' : `登录失败: ${response.data}`)
    }
  }

  async logout(): Promise<void> {
    await apiClient.post('/api/v2/auth/logout').catch(() => {})
  }

  async checkSession(): Promise<boolean> {
    try {
      await silentApiClient.get('/api/v2/app/version')
      return true
    } catch {
      return false
    }
  }

  async fetchDetail(hash: string): Promise<UnifiedTorrentDetail> {
    const [propsRes, filesRes, trackersRes, peersRes] = await Promise.all([
      apiClient.get<QBTorrentProperties>('/api/v2/torrents/properties', { params: { hash } }),
      apiClient.get<QBFile[]>('/api/v2/torrents/files', { params: { hash } }),
      apiClient.get<QBTracker[]>('/api/v2/torrents/trackers', { params: { hash } }),
      apiClient.get<{ peers: Record<string, QBPeer> }>('/api/v2/sync/torrentPeers', { params: { hash } })
        .catch(() => ({ data: { peers: {} } }))
    ])

    const props = propsRes.data
    return {
      hash: props.hash,
      name: props.name,
      size: props.size,
      completed: props.completed,
      uploaded: props.uploaded,
      dlLimit: props.dl_limit,
      upLimit: props.up_limit,
      seedingTime: props.seeding_time,
      addedTime: props.added_on,
      completionOn: props.completion_on,
      savePath: props.save_path,
      category: props.category,
      tags: props.tags ? props.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      connections: props.connections_limit,
      numSeeds: props.num_complete,
      numLeechers: props.num_incomplete,
      files: (filesRes.data || []).map(f => this.normalizeFile(f)),
      trackers: (trackersRes.data || []).map(t => this.normalizeTracker(t)),
      peers: Object.values(peersRes.data?.peers || {}).map(p => this.normalizePeer(p as QBPeer))
    }
  }

  async recheck(hash: string): Promise<void> {
    await apiClient.post('/api/v2/torrents/recheck', null, { params: { hashes: hash } })
  }

  async reannounce(hash: string): Promise<void> {
    await apiClient.post('/api/v2/torrents/reannounce', null, { params: { hashes: hash } })
  }

  async forceStart(hash: string, value: boolean): Promise<void> {
    await apiClient.post('/api/v2/torrents/setForceStart', null, {
      params: { hashes: hash, value: value.toString() }
    })
  }

  async setDownloadLimit(hash: string, limit: number): Promise<void> {
    await apiClient.post('/api/v2/torrents/setDlLimit', null, {
      params: { hashes: hash, limit: limit.toString() }
    })
  }

  async setUploadLimit(hash: string, limit: number): Promise<void> {
    await apiClient.post('/api/v2/torrents/setUpLimit', null, {
      params: { hashes: hash, limit: limit.toString() }
    })
  }

  async setLocation(hash: string, location: string): Promise<void> {
    await apiClient.post('/api/v2/torrents/setLocation', null, {
      params: { hashes: hash, location }
    })
  }

  async setCategory(hash: string, category: string): Promise<void> {
    await apiClient.post('/api/v2/torrents/setCategory', null, {
      params: { hashes: hash, category: category || '' }
    })
  }

  async setTags(hash: string, tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    await apiClient.post('/api/v2/torrents/setTags', null, {
      params: { hashes: hash, tags: tags.join(','), operation: mode }
    })
  }

  async setFilePriority(hash: string, fileIds: number[], priority: 'high' | 'normal' | 'low' | 'do_not_download'): Promise<void> {
    const priorityMap = { high: 1, normal: 0, low: -1, do_not_download: -2 }
    await apiClient.post('/api/v2/torrents/filePrio', null, {
      params: { hash, id: fileIds.join(','), priority: priorityMap[priority].toString() }
    })
  }

  protected normalizeServerState(raw: unknown): ServerState | undefined {
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

  protected normalize(hash: string, raw: Partial<QBTorrent>, existing?: UnifiedTorrent): UnifiedTorrent {
    const rawState = raw.state
    let normalizedState: TorrentState = existing?.state ?? 'error'
    if (rawState) {
      normalizedState = STATE_MAP[rawState] ?? 'error'
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
      category: raw.category || existing?.category,
      tags: raw.tags ? raw.tags.split(',').map(t => t.trim()).filter(Boolean) : existing?.tags
    }
  }

  protected normalizeFile(file: QBFile): TorrentFile {
    let priority: TorrentFile['priority'] = 'normal'
    if (file.priority === 1) priority = 'high'
    else if (file.priority === -1) priority = 'low'
    else if (file.priority === -2) priority = 'do_not_download'
    return { id: file.id, name: file.name, size: file.size, progress: file.progress, priority }
  }

  protected normalizeTracker(tracker: QBTracker): Tracker {
    let status: Tracker['status'] = 'not_working'
    if (tracker.status === 0) status = 'disabled'
    else if (tracker.status === 2) status = 'working'
    else if (tracker.status === 3) status = 'updating'
    return { url: tracker.url, status, msg: tracker.msg, peers: tracker.num_peers, tier: tracker.tier }
  }

  protected normalizePeer(peer: QBPeer): Peer {
    return {
      ip: peer.ip,
      port: peer.port,
      client: peer.client,
      progress: peer.progress,
      dlSpeed: peer.dl_speed,
      upSpeed: peer.up_speed,
      downloaded: peer.downloaded,
      uploaded: peer.uploaded
    }
  }
}
