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
  protected currentServerState: ServerState | null = null
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

      // ServerState 增量更新（类似种子的处理逻辑）
      if (data.server_state) {
        const rawState = data.server_state

        // 检查哪些字段在原始数据中存在（区分"缺失"和"值为 0"）
        const hasDlRateLimit = 'dl_rate_limit' in rawState
        const hasUpRateLimit = 'up_rate_limit' in rawState
        const hasDlInfoSpeed = 'dl_info_speed' in rawState
        const hasUpInfoSpeed = 'up_info_speed' in rawState
        const hasUseAltSpeed = 'use_alt_speed' in rawState
        const hasAltDlLimit = 'alt_dl_limit' in rawState
        const hasAltUpLimit = 'alt_up_limit' in rawState
        const hasConnectionStatus = 'connection_status' in rawState
        const hasPeers = 'peers' in rawState
        const hasFreeSpace = 'free_space_on_disk' in rawState

        const normalized = this.normalizeServerState(data.server_state)
        if (normalized) {
          // 增量合并：只更新原始数据中存在的字段
          const merged: ServerState = {
            dlInfoSpeed: hasDlInfoSpeed ? normalized.dlInfoSpeed : (this.currentServerState?.dlInfoSpeed ?? 0),
            upInfoSpeed: hasUpInfoSpeed ? normalized.upInfoSpeed : (this.currentServerState?.upInfoSpeed ?? 0),
            dlRateLimit: hasDlRateLimit ? normalized.dlRateLimit : (this.currentServerState?.dlRateLimit ?? 0),
            upRateLimit: hasUpRateLimit ? normalized.upRateLimit : (this.currentServerState?.upRateLimit ?? 0),
            connectionStatus: hasConnectionStatus ? normalized.connectionStatus : (this.currentServerState?.connectionStatus ?? 'disconnected'),
            peers: hasPeers ? normalized.peers : (this.currentServerState?.peers ?? 0),
            freeSpaceOnDisk: hasFreeSpace ? normalized.freeSpaceOnDisk : (this.currentServerState?.freeSpaceOnDisk ?? 0),
            useAltSpeed: hasUseAltSpeed ? normalized.useAltSpeed : (this.currentServerState?.useAltSpeed ?? false),
            altDlLimit: hasAltDlLimit ? normalized.altDlLimit : (this.currentServerState?.altDlLimit ?? 0),
            altUpLimit: hasAltUpLimit ? normalized.altUpLimit : (this.currentServerState?.altUpLimit ?? 0),
            backendName: normalized.backendName ?? this.currentServerState?.backendName,
            backendVersion: normalized.backendVersion ?? this.currentServerState?.backendVersion,
            apiVersion: normalized.apiVersion ?? this.currentServerState?.apiVersion
          }

          // 调试日志：查看限速值变化
          if (this.currentServerState?.dlRateLimit !== merged.dlRateLimit ||
              this.currentServerState?.upRateLimit !== merged.upRateLimit) {
            console.log('[ServerState] Rate limits updated:', {
              old: { dl: this.currentServerState?.dlRateLimit, up: this.currentServerState?.upRateLimit },
              raw: { dl: normalized.dlRateLimit, up: normalized.upRateLimit, hasDl: hasDlRateLimit, hasUp: hasUpRateLimit },
              merged: { dl: merged.dlRateLimit, up: merged.upRateLimit }
            })
          }

          this.currentServerState = merged
        }
      }

      return {
        torrents: this.currentMap,
        categories: new Map(this.currentCategories),
        tags: [...this.currentTags],
        serverState: this.currentServerState ? { ...this.currentServerState } : undefined
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

        // 重置时更新 serverState
        if (data.server_state) {
          const normalized = this.normalizeServerState(data.server_state)
          if (normalized) {
            this.currentServerState = normalized
          }
        }

        return {
          torrents: this.currentMap,
          categories: new Map(this.currentCategories),
          tags: [...this.currentTags],
          serverState: this.currentServerState ? { ...this.currentServerState } : undefined
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
    const peers = Object.values(peersRes.data?.peers || {}) as QBPeer[]

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

      // 实际连接数（从 peers 数组统计）
      // 注意：sync/torrentPeers 返回可能受数量/分页限制，统计值未必等于真实全量连接数
      connections: peers.length,

      // 已连接的 seeds/leechers（从 peers 数组过滤）
      numSeeds: peers.filter((p: QBPeer) => p.progress === 1).length,
      numLeechers: peers.filter((p: QBPeer) => p.progress >= 0 && p.progress < 1).length,

      // Swarm 统计（整个 swarm 的总数）
      totalSeeds: props.num_complete,
      totalLeechers: props.num_incomplete,

      files: (filesRes.data || []).map(f => this.normalizeFile(f)),
      trackers: (trackersRes.data || []).map(t => this.normalizeTracker(t)),
      peers: peers.map(p => this.normalizePeer(p))
    }
  }

  async recheck(hash: string): Promise<void> {
    await this.recheckBatch([hash])
  }

  async recheckBatch(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/recheck', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  async reannounce(hash: string): Promise<void> {
    await this.reannounceBatch([hash])
  }

  async reannounceBatch(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/reannounce', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  async forceStart(hash: string, value: boolean): Promise<void> {
    await this.forceStartBatch([hash], value)
  }

  async forceStartBatch(hashes: string[], value: boolean): Promise<void> {
    await apiClient.post('/api/v2/torrents/setForceStart', null, {
      params: { hashes: hashes.join('|') || 'all', value: value.toString() }
    })
  }

  async setDownloadLimit(hash: string, limit: number): Promise<void> {
    await this.setDownloadLimitBatch([hash], limit)
  }

  async setDownloadLimitBatch(hashes: string[], limit: number): Promise<void> {
    await apiClient.post('/api/v2/torrents/setDownloadLimit', null, {
      params: { hashes: hashes.join('|') || 'all', limit: limit.toString() }
    })
  }

  async setUploadLimit(hash: string, limit: number): Promise<void> {
    await this.setUploadLimitBatch([hash], limit)
  }

  async setUploadLimitBatch(hashes: string[], limit: number): Promise<void> {
    await apiClient.post('/api/v2/torrents/setUploadLimit', null, {
      params: { hashes: hashes.join('|') || 'all', limit: limit.toString() }
    })
  }

  async setLocation(hash: string, location: string): Promise<void> {
    await apiClient.post('/api/v2/torrents/setLocation', null, {
      params: { hashes: hash, location }
    })
  }

  async setCategory(hash: string, category: string): Promise<void> {
    await this.setCategoryBatch([hash], category)
  }

  async setCategoryBatch(hashes: string[], category: string): Promise<void> {
    await apiClient.post('/api/v2/torrents/setCategory', null, {
      params: { hashes: hashes.join('|') || 'all', category: category || '' }
    })
  }

  async setTags(hash: string, tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    await this.setTagsBatch([hash], tags, mode)
  }

  async setTagsBatch(hashes: string[], tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    const safeTags = tags.map(t => t.trim()).filter(Boolean)
    const hashesParam = hashes.join('|') || 'all'

    const tryCall = async (endpoint: string, payloadTags: string[]) => {
      if (payloadTags.length === 0) return
      try {
        await apiClient.post(endpoint, null, {
          params: { hashes: hashesParam, tags: payloadTags.join(',') }
        })
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 404 || status === 405) return
        throw err
      }
    }

    if (mode === 'add') {
      await tryCall('/api/v2/torrents/addTags', safeTags)
      return
    }

    if (mode === 'remove') {
      await tryCall('/api/v2/torrents/removeTags', safeTags)
      return
    }

    // mode === 'set' 需要为每个种子单独处理
    if (hashes.length === 1 && hashes[0]) {
      const hash = hashes[0]
      const current = this.currentMap.get(hash)?.tags ?? []
      const currentSet = new Set(current)
      const desiredSet = new Set(safeTags)

      const toRemove: string[] = []
      for (const t of currentSet) {
        if (!desiredSet.has(t)) toRemove.push(t)
      }

      const toAdd: string[] = []
      for (const t of desiredSet) {
        if (!currentSet.has(t)) toAdd.push(t)
      }

      await tryCall('/api/v2/torrents/removeTags', toRemove)
      await tryCall('/api/v2/torrents/addTags', toAdd)
    } else {
      // 批量 set 模式：直接替换所有标签
      await tryCall('/api/v2/torrents/setTags', safeTags)
    }
  }

  async setFilePriority(hash: string, fileIds: number[], priority: 'high' | 'normal' | 'low' | 'do_not_download'): Promise<void> {
    const priorityMap = { high: 6, normal: 1, low: 1, do_not_download: 0 }
    await apiClient.post('/api/v2/torrents/filePrio', null, {
      params: { hash, id: fileIds.join('|'), priority: priorityMap[priority].toString() }
    })
  }

  // ========== 分类管理 ==========

  async getCategories(): Promise<Map<string, Category>> {
    const res = await apiClient.get<Record<string, Category>>('/api/v2/torrents/categories')
    return new Map(Object.entries(res.data))
  }

  async createCategory(name: string, savePath?: string): Promise<void> {
    const params: Record<string, string> = { name }
    if (savePath) params.savePath = savePath
    await apiClient.post('/api/v2/torrents/createCategory', null, { params })
  }

  async editCategory(name: string, newName?: string, savePath?: string): Promise<void> {
    const params: Record<string, string> = {}
    if (newName) params.name = newName
    if (savePath) params.savePath = savePath
    await apiClient.post('/api/v2/torrents/editCategory', null, {
      params: { category: name, ...params }
    })
  }

  async deleteCategories(...names: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/removeCategories', null, {
      params: { categories: names.join('\n') }
    })
  }

  async setCategorySavePath(category: string, savePath: string): Promise<void> {
    await apiClient.post('/api/v2/torrents/setCategorySavePath', null, {
      params: { category, savePath }
    })
  }

  // ========== 标签管理 ==========

  async getTags(): Promise<string[]> {
    const res = await apiClient.get<string[]>('/api/v2/torrents/tags')
    return res.data
  }

  async createTags(...tags: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/createTags', null, {
      params: { tags: tags.join(',') }
    })
  }

  async deleteTags(...tags: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/deleteTags', null, {
      params: { tags: tags.join(',') }
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
      tags: raw.tags ? raw.tags.split(',').map(t => t.trim()).filter(Boolean) : existing?.tags,
      numSeeds: raw.num_seeds ?? existing?.numSeeds ?? 0,
      numPeers: raw.num_leechs ?? existing?.numPeers ?? 0
    }
  }

  protected normalizeFile(file: QBFile): TorrentFile {
    const index = (typeof file.index === 'number' ? file.index : file.id) ?? 0

    let priority: TorrentFile['priority'] = 'normal'
    // qB file priority values: 0=do not download, 1=normal, 6=high, 7=maximal
    if (file.priority === 0 || file.priority === -2) priority = 'do_not_download'
    else if (file.priority === 6 || file.priority === 7) priority = 'high'

    return { id: index, name: file.name, size: file.size, progress: file.progress, priority }
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
