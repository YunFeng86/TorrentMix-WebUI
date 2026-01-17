import { apiClient, silentApiClient, getQbitBaseUrl } from '@/api/client'
import axios from 'axios'
import type {
  UnifiedTorrent, QBTorrent, QBSyncResponse, TorrentState, Category, ServerState,
  UnifiedTorrentDetail, TorrentFile, Tracker, Peer,
  QBTorrentProperties, QBFile, QBTracker, QBPeer
} from '../types'
import type { BaseAdapter, AddTorrentParams, FetchListResult, TransferSettings, BackendPreferences, BackendCapabilities } from '../interface'

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

  // ========== 全局/备用限速设置 ==========

  async getTransferSettings(): Promise<TransferSettings> {
    const res = await apiClient.get<QBSyncResponse>('/api/v2/sync/maindata', { params: { rid: 0 } })
    const state = res.data.server_state
    return {
      downloadLimit: (state.dl_rate_limit as number) ?? 0,
      uploadLimit: (state.up_rate_limit as number) ?? 0,
      altEnabled: (state.use_alt_speed as boolean) ?? false,
      altDownloadLimit: (state.alt_dl_limit as number) ?? 0,
      altUploadLimit: (state.alt_up_limit as number) ?? 0
    }
  }

  async setTransferSettings(patch: Partial<TransferSettings>): Promise<void> {
    if (typeof patch.downloadLimit === 'number') {
      await apiClient.post('/api/v2/transfer/setDownloadLimit', null, { params: { limit: patch.downloadLimit } })
    }
    if (typeof patch.uploadLimit === 'number') {
      await apiClient.post('/api/v2/transfer/setUploadLimit', null, { params: { limit: patch.uploadLimit } })
    }
    if (typeof patch.altEnabled === 'boolean') {
      await apiClient.post('/api/v2/transfer/setSpeedLimitsMode', null, { params: { mode: patch.altEnabled ? 1 : 0 } })
    }
    if (typeof patch.altDownloadLimit === 'number' || typeof patch.altUploadLimit === 'number') {
      const current = await this.getTransferSettings()
      const downloadLimit = typeof patch.altDownloadLimit === 'number' ? patch.altDownloadLimit : current.altDownloadLimit
      const uploadLimit = typeof patch.altUploadLimit === 'number' ? patch.altUploadLimit : current.altUploadLimit
      await apiClient.post('/api/v2/transfer/setAlternativeSpeedLimits', null, { params: { downloadLimit, uploadLimit } })
    }
  }

  async getPreferences(): Promise<BackendPreferences> {
    const { data } = await apiClient.get<Record<string, unknown>>('/api/v2/app/preferences')
    const pick = <T>(...keys: string[]): T | undefined => {
      for (const key of keys) {
        const val = data[key]
        if (val !== undefined) return val as T
      }
      return undefined
    }

    return {
      // 连接
      maxConnections: pick<number>('max_connec', 'connection_limit'),
      maxConnectionsPerTorrent: pick<number>('max_connec_per_torrent', 'max_connections_per_torrent'),

      // 队列
      queueDownloadEnabled: pick<boolean>('queueing_enabled'),
      queueDownloadMax: pick<number>('max_active_downloads'),
      queueSeedEnabled: pick<boolean>('queueing_enabled'),
      queueSeedMax: pick<number>('max_active_uploads'),

      // 端口
      listenPort: pick<number>('listen_port'),
      randomPort: pick<boolean>('random_port'),
      upnpEnabled: pick<boolean>('upnp', 'upnp_enabled'),

      // 协议
      dhtEnabled: pick<boolean>('dht'),
      pexEnabled: pick<boolean>('pex'),
      lsdEnabled: pick<boolean>('lsd'),
      encryption: this.mapEncryptionMode(pick<number>('encryption') ?? 0),

      // Phase 1: 做种限制
      shareRatioLimit: pick<number>('max_ratio', 'share_ratio_limit'),
      shareRatioLimited: pick<boolean>('max_ratio_enabled', 'share_ratio_limit_enabled'),
      seedingTimeLimit: pick<number>('max_seeding_time', 'max_seeding_time_minutes'),
      seedingTimeLimited: pick<boolean>('max_seeding_time_enabled'),

      // Phase 1: 下载路径
      savePath: pick<string>('save_path'),
      incompleteDirEnabled: pick<boolean>('temp_path_enabled'),
      incompleteDir: pick<string>('temp_path', 'incomplete_dir'),
      incompleteFilesSuffix: pick<boolean>('incomplete_files_ext'),
      createSubfolderEnabled: pick<boolean>('create_subfolder_enabled', 'subcategory_enabled')
    }
  }

  async setPreferences(patch: Partial<BackendPreferences>): Promise<void> {
    const qbPrefs: Record<string, unknown> = {}

    // 字段映射（归一化字段 → qB API 字段）
    if (patch.maxConnections !== undefined) {
      qbPrefs.max_connec = patch.maxConnections
    }
    if (patch.maxConnectionsPerTorrent !== undefined) {
      qbPrefs.max_connec_per_torrent = patch.maxConnectionsPerTorrent
    }
    // qB 的 queueing_enabled 是全局开关（同时影响下载/做种队列）
    const queueingEnabled =
      patch.queueDownloadEnabled !== undefined ? patch.queueDownloadEnabled
        : patch.queueSeedEnabled !== undefined ? patch.queueSeedEnabled
          : undefined
    if (queueingEnabled !== undefined) qbPrefs.queueing_enabled = queueingEnabled
    if (patch.queueDownloadMax !== undefined) qbPrefs.max_active_downloads = patch.queueDownloadMax
    if (patch.queueSeedMax !== undefined) qbPrefs.max_active_uploads = patch.queueSeedMax
    if (patch.listenPort !== undefined) qbPrefs.listen_port = patch.listenPort
    if (patch.randomPort !== undefined) qbPrefs.random_port = patch.randomPort
    if (patch.upnpEnabled !== undefined) {
      qbPrefs.upnp = patch.upnpEnabled
    }
    if (patch.dhtEnabled !== undefined) qbPrefs.dht = patch.dhtEnabled
    if (patch.pexEnabled !== undefined) qbPrefs.pex = patch.pexEnabled
    if (patch.lsdEnabled !== undefined) qbPrefs.lsd = patch.lsdEnabled
    if (patch.encryption !== undefined) qbPrefs.encryption = this.unmapEncryptionMode(patch.encryption)

    // Phase 1: 做种限制
    if (patch.shareRatioLimit !== undefined) {
      qbPrefs.max_ratio = patch.shareRatioLimit
    }
    if (patch.shareRatioLimited !== undefined) {
      qbPrefs.max_ratio_enabled = patch.shareRatioLimited
    }
    if (patch.seedingTimeLimit !== undefined) {
      qbPrefs.max_seeding_time = patch.seedingTimeLimit
    }
    if (patch.seedingTimeLimited !== undefined) qbPrefs.max_seeding_time_enabled = patch.seedingTimeLimited

    // Phase 1: 下载路径
    if (patch.savePath !== undefined) qbPrefs.save_path = patch.savePath
    if (patch.incompleteDirEnabled !== undefined) qbPrefs.temp_path_enabled = patch.incompleteDirEnabled
    if (patch.incompleteDir !== undefined) {
      qbPrefs.temp_path = patch.incompleteDir
    }
    if (patch.incompleteFilesSuffix !== undefined) qbPrefs.incomplete_files_ext = patch.incompleteFilesSuffix
    if (patch.createSubfolderEnabled !== undefined) qbPrefs.create_subfolder_enabled = patch.createSubfolderEnabled

    if (Object.keys(qbPrefs).length === 0) return

    // 调用 qB API：setPreferences 需要 json 参数（JSON 字符串）
    const params = new URLSearchParams()
    params.append('json', JSON.stringify(qbPrefs))

    await apiClient.post('/api/v2/app/setPreferences', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  getCapabilities(): BackendCapabilities {
    return {
      // 队列相关
      hasSeparateSeedQueue: false, // qB 的队列是全局的（queueing_enabled 同时控制下载/做种）
      hasStalledQueue: false,

      // 协议相关
      hasLSD: true,                 // 支持 LSD（本地服务发现）
      hasEncryption: true,          // 支持加密模式
      encryptionModes: ['prefer', 'require', 'disable'],

      // 做种限制
      hasSeedingRatioLimit: true,   // 支持 max_ratio
      hasSeedingTimeLimit: true,    // 支持 max_seeding_time
      seedingTimeLimitMode: 'duration',

      // 路径相关
      hasDefaultSavePath: true,     // 支持 save_path
      hasIncompleteDir: true,       // 支持 temp_path
      hasCreateSubfolder: true,     // 支持 create_subfolder_enabled
      hasIncompleteFilesSuffix: true, // 支持 incomplete_files_ext

      // 高级功能
      hasProxy: true,               // 支持代理设置
      hasScheduler: true,           // 支持调度器
      hasIPFilter: true,            // 支持 IP 过滤
      hasScripts: false,            // 不支持脚本系统
      hasBlocklist: false,          // 不支持屏蔽列表 URL
      hasTrashTorrentFiles: false,
    }
  }

  private mapEncryptionMode(mode: number): BackendPreferences['encryption'] {
    const mapping: Record<number, BackendPreferences['encryption']> = {
      0: 'prefer',
      1: 'require',
      2: 'disable'
    }
    return mapping[mode] ?? 'prefer'
  }

  private unmapEncryptionMode(mode: BackendPreferences['encryption']): number {
    if (!mode) return 0
    const mapping: Record<string, number> = {
      'tolerate': 0,
      'prefer': 0,
      'require': 1,
      'disable': 2
    }
    return mapping[mode] ?? 0
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

    const rawAny = raw as Record<string, unknown>

    // 注意：sync/maindata 增量更新时，字段可能缺失；区分“字段缺失”和“值为 0”。
    const hasConnectedSeeds = 'num_seeds' in rawAny
    const hasConnectedPeers = 'num_leechs' in rawAny
    const hasTotalSeeds = 'num_complete' in rawAny
    const hasTotalPeers = 'num_incomplete' in rawAny

    const connectedSeeds = hasConnectedSeeds ? ((rawAny.num_seeds as number | undefined) ?? 0) : existing?.connectedSeeds
    const connectedPeers = hasConnectedPeers ? ((rawAny.num_leechs as number | undefined) ?? 0) : existing?.connectedPeers
    const totalSeeds = hasTotalSeeds ? ((rawAny.num_complete as number | undefined) ?? 0) : existing?.totalSeeds
    const totalPeers = hasTotalPeers ? ((rawAny.num_incomplete as number | undefined) ?? 0) : existing?.totalPeers

    const bestSeeds = totalSeeds ?? connectedSeeds
    const bestPeers = totalPeers ?? connectedPeers

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
      connectedSeeds,
      connectedPeers,
      totalSeeds,
      totalPeers,
      numSeeds: bestSeeds,
      numPeers: bestPeers
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
