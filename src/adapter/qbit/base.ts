import { apiClient, silentApiClient, getQbitBaseUrl, AuthError } from '@/api/client'
import { warnOnce } from '@/utils/logger'
import axios from 'axios'
import type {
  UnifiedTorrent, QBTorrent, QBSyncResponse, TorrentState, Category, ServerState,
  UnifiedTorrentDetail, TorrentFile, Tracker, Peer,
  QBTorrentInfo, QBTorrentGenericProperties, QBFile, QBTracker, QBPeer
} from '../types'
import type {
  BaseAdapter,
  AddTorrentParams,
  FetchListResult,
  TransferSettings,
  BackendPreferences,
  BackendCapabilities,
  AppLogEntry,
  PeerLogEntry,
  RssItems,
  RssRuleDefinition,
  SearchJobStatus,
  SearchResults,
  SearchPlugin,
} from '../interface'

const IS_DEV = Boolean((import.meta as any).env?.DEV)

const STATE_MAP: Record<string, TorrentState> = {
  downloading: 'downloading',
  stalledDL: 'downloading',
  metaDL: 'downloading',
  forcedDL: 'downloading',
  allocating: 'checking',
  uploading: 'seeding',
  stalledUP: 'seeding',
  forcedUP: 'seeding',
  pausedDL: 'paused',
  pausedUP: 'paused',
  stoppedDL: 'paused',
  stoppedUP: 'paused',
  unknown: 'paused',
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

  private toolsCapabilities = {
    hasRss: false,
    hasSearch: false,
    lastProbeAt: 0,
  }

  private toolsProbePromise: Promise<void> | null = null

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

      // categories/tags 在 full_update 时应视为快照；否则增量合并
      // 防御：部分后端可能在 full_update 时省略字段（undefined），此时不应把缓存“误清空”导致 UI 闪白。
      if (data.full_update) {
        if (data.categories !== undefined) {
          const categories = new Map<string, Category>()
          for (const [name, cat] of Object.entries(data.categories || {})) {
            categories.set(name, { name, savePath: cat.savePath })
          }
          this.currentCategories = categories
        }
        if (data.tags !== undefined) {
          this.currentTags = Array.from(new Set(data.tags || []))
        }
      } else {
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
      }

      // ServerState 增量更新（类似种子的处理逻辑）
      if (data.server_state) {
        const rawState = data.server_state

        // 检查哪些字段在原始数据中存在（区分"缺失"和"值为 0"）
        const hasDlRateLimit = 'dl_rate_limit' in rawState
        const hasUpRateLimit = 'up_rate_limit' in rawState
        const hasDlInfoSpeed = 'dl_info_speed' in rawState
        const hasUpInfoSpeed = 'up_info_speed' in rawState
        const hasUseAltSpeed = ('use_alt_speed_limits' in rawState) || ('use_alt_speed' in rawState)
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
          if (IS_DEV && (
            this.currentServerState?.dlRateLimit !== merged.dlRateLimit ||
            this.currentServerState?.upRateLimit !== merged.upRateLimit
          )) {
            console.log('[ServerState] Rate limits updated:', {
              old: { dl: this.currentServerState?.dlRateLimit, up: this.currentServerState?.upRateLimit },
              raw: { dl: normalized.dlRateLimit, up: normalized.upRateLimit, hasDl: hasDlRateLimit, hasUp: hasUpRateLimit },
              merged: { dl: merged.dlRateLimit, up: merged.upRateLimit }
            })
          }

          this.currentServerState = merged
        }
      }

      // 能力探测：RSS/Search 可能因配置或环境缺失而不可用（避免 UI 乐观标记误导用户）
      if (this.toolsCapabilities.lastProbeAt === 0) {
        await this.probeToolsCapabilities().catch(error => {
          if (IS_DEV) console.warn('[QbitAdapter] Tools capability probe failed:', error)
        })
      } else {
        void this.probeToolsCapabilities().catch(error => {
          if (IS_DEV) console.warn('[QbitAdapter] Tools capability probe failed:', error)
        })
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

        // rid 重置视为全量更新：重建 categories/tags/serverState，避免残留“幽灵数据”
        if (data.categories !== undefined) {
          this.currentCategories = new Map()
          for (const [name, cat] of Object.entries(data.categories || {})) {
            this.currentCategories.set(name, { name, savePath: cat.savePath })
          }
        }
        if (data.tags !== undefined) {
          this.currentTags = Array.from(new Set(data.tags || []))
        }

        const normalized = this.normalizeServerState(data.server_state)
        this.currentServerState = normalized ?? null

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

  private async probeToolsCapabilities(): Promise<void> {
    const now = Date.now()
    const TTL = 5 * 60 * 1000

    if (this.toolsProbePromise) return this.toolsProbePromise
    if (this.toolsCapabilities.lastProbeAt > 0 && now - this.toolsCapabilities.lastProbeAt < TTL) return

    this.toolsProbePromise = (async () => {
      const [prefsRes, searchPluginsRes] = await Promise.all([
        silentApiClient.get<Record<string, unknown>>('/api/v2/app/preferences').catch(() => null),
        silentApiClient.get<unknown>('/api/v2/search/plugins').catch(() => null),
      ])

      // RSS: preferences.rss_processing_enabled
      if (prefsRes?.data && typeof prefsRes.data === 'object') {
        const raw = (prefsRes.data as any).rss_processing_enabled as unknown
        if (typeof raw === 'boolean') {
          this.toolsCapabilities.hasRss = raw
        } else if (typeof raw === 'number' && Number.isFinite(raw)) {
          this.toolsCapabilities.hasRss = raw !== 0
        } else if (typeof raw === 'string') {
          const normalized = raw.trim().toLowerCase()
          if (normalized === '1' || normalized === 'true') this.toolsCapabilities.hasRss = true
          if (normalized === '0' || normalized === 'false') this.toolsCapabilities.hasRss = false
        }
      }

      // Search: /api/v2/search/plugins 返回数组则认为可用（Python/插件缺失时通常会报错或非数组）
      if (searchPluginsRes?.data !== undefined) {
        this.toolsCapabilities.hasSearch = Array.isArray(searchPluginsRes.data)
      }

      this.toolsCapabilities.lastProbeAt = now
    })().finally(() => {
      this.toolsProbePromise = null
    })

    return this.toolsProbePromise
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
    const infoPromise = apiClient.get<QBTorrentInfo[]>('/api/v2/torrents/info', { params: { hashes: hash } })
      .then(res => ({ ok: true as const, data: res.data }))
      .catch((error: unknown) => {
        // 认证失败应直接抛出，让上层按 AuthError 处理
        if (error instanceof AuthError) throw error
        return { ok: false as const, error }
      })

    const [infoResult, propsRes, filesRes, trackersRes, peersRes] = await Promise.all([
      infoPromise,
      apiClient.get<Partial<QBTorrentGenericProperties>>('/api/v2/torrents/properties', { params: { hash } })
        .catch(() => ({ data: {} as Partial<QBTorrentGenericProperties> })),
      apiClient.get<QBFile[]>('/api/v2/torrents/files', { params: { hash } }),
      apiClient.get<QBTracker[]>('/api/v2/torrents/trackers', { params: { hash } }),
      apiClient.get<{ peers: Record<string, QBPeer> }>('/api/v2/sync/torrentPeers', { params: { hash } })
        .catch(() => ({ data: { peers: {} } }))
    ])

    const props = propsRes.data || {}

    const rawPeers = (peersRes.data as any)?.peers as unknown
    let peerItems: unknown[] = []
    if (Array.isArray(rawPeers)) {
      peerItems = rawPeers
    } else if (rawPeers && typeof rawPeers === 'object') {
      peerItems = Object.values(rawPeers as Record<string, unknown>)
    }

    // Peers 接口文档为 TODO：开发环境下做一个结构探针，避免 qB 升级后“静默失效”。
    // 同时用 warnOnce 避免轮询场景刷屏。
    if (IS_DEV) {
      const kind = rawPeers === null ? 'null' : Array.isArray(rawPeers) ? 'array' : typeof rawPeers

      if (rawPeers === undefined) {
        warnOnce('qbit/peers/missing', 'Missing peers field from /sync/torrentPeers payload.', { hash })
      } else if (rawPeers === null || (!Array.isArray(rawPeers) && typeof rawPeers !== 'object')) {
        warnOnce(`qbit/peers/invalid-kind:${kind}`, 'Unexpected peers payload kind from /sync/torrentPeers.', { hash, kind })
      } else {
        const sample = peerItems[0] as unknown
        if (sample && typeof sample === 'object') {
          const s = sample as Record<string, unknown>
          const looksLikePeer = 'ip' in s || 'client' in s || 'dl_speed' in s || 'up_speed' in s
          if (!looksLikePeer) {
            warnOnce('qbit/peers/structure', 'qB peer structure might have changed (/sync/torrentPeers).', { hash, sample })
          }
        } else if (sample !== undefined) {
          warnOnce(`qbit/peers/invalid-sample:${typeof sample}`, 'Unexpected peer item type from /sync/torrentPeers.', { hash, type: typeof sample })
        }
      }
    }

    const num = (val: unknown): number | undefined => (typeof val === 'number' && Number.isFinite(val) ? val : undefined)
    const nonNeg = (val: unknown): number | undefined => {
      const n = num(val)
      return n !== undefined && n >= 0 ? n : undefined
    }
    const nonNegOr = (val: unknown, fallback: number): number => nonNeg(val) ?? fallback
    const normalizeLimit = (val: unknown): number | undefined => {
      const n = num(val)
      if (n === undefined) return undefined
      // qB 的“无限制”在不同端点/版本里可能返回 0 或 -1；统一归一化为 -1。
      if (n <= 0) return -1
      return Math.round(n)
    }

    const peers = peerItems
      .map(p => this.normalizePeer(p))
      .filter((p): p is Peer => Boolean(p))

    if (infoResult.ok) {
      const info = (infoResult.data || [])[0]
      if (!info) {
        throw new Error('Torrent not found')
      }

      const size = nonNeg(info.size) ?? nonNeg(info.total_size) ?? nonNeg(props.total_size) ?? 0
      const completed = nonNeg(info.completed)
        ?? (typeof info.progress === 'number' ? Math.round(info.progress * size) : undefined)
        ?? nonNeg(props.total_downloaded)
        ?? 0
      const uploaded = nonNeg(info.uploaded) ?? nonNeg(props.total_uploaded) ?? 0

      const numSeeds = nonNeg(info.num_seeds) ?? nonNeg(props.seeds) ?? peers.filter(p => p.progress === 1).length
      const numLeechers = nonNeg(info.num_leechs) ?? nonNeg(props.peers) ?? peers.filter(p => p.progress >= 0 && p.progress < 1).length

      const connections = nonNeg(props.nb_connections) ?? (numSeeds + numLeechers)

      return {
        hash: info.hash,
        name: info.name,
        size,
        completed,
        uploaded,
        dlLimit: normalizeLimit(info.dl_limit) ?? normalizeLimit(props.dl_limit) ?? -1,
        upLimit: normalizeLimit(info.up_limit) ?? normalizeLimit(props.up_limit) ?? -1,
        seedingTime: nonNegOr(info.seeding_time, nonNegOr(props.seeding_time, 0)),
        addedTime: nonNegOr(info.added_on, nonNegOr(props.addition_date, 0)),
        completionOn: nonNegOr(info.completion_on, nonNegOr(props.completion_date, 0)),
        savePath: (typeof info.save_path === 'string' ? info.save_path : (props.save_path ?? '')),
        category: typeof info.category === 'string' ? info.category : '',
        tags: typeof info.tags === 'string' ? info.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        autoManagement: typeof info.auto_tmm === 'boolean' ? info.auto_tmm : undefined,
        sequentialDownload: typeof info.seq_dl === 'boolean' ? info.seq_dl : undefined,
        firstLastPiecePriority: typeof info.f_l_piece_prio === 'boolean' ? info.f_l_piece_prio : undefined,
        superSeeding: typeof info.super_seeding === 'boolean' ? info.super_seeding : undefined,

        // 实际连接数（优先使用 qB 的统计；否则用 seeds+leechers 的可用值）
        connections,

        // 已连接的 seeds/leechers（优先使用 info/properties 的统计；否则从 peers 数组推断）
        numSeeds,
        numLeechers,

        // Swarm 统计（整个 swarm 的总数）
        totalSeeds: nonNeg(info.num_complete) ?? nonNeg(props.seeds_total),
        totalLeechers: nonNeg(info.num_incomplete) ?? nonNeg(props.peers_total),

        files: (filesRes.data || []).map(f => this.normalizeFile(f)),
        trackers: (trackersRes.data || []).map(t => this.normalizeTracker(t)),
        peers,
      }
    }

    // /torrents/info 失败：只对“端点不存在/反代拦截/服务器错误”等场景做降级，避免把真实错误吞掉
    const status = (infoResult.error as any)?.response?.status
    if (status !== 404 && status !== 405 && status !== 500) {
      throw infoResult.error
    }

    const cached = this.currentMap.get(hash)
    if (!cached && Object.keys(props).length === 0) {
      throw infoResult.error
    }

    const size = nonNeg(props.total_size) ?? nonNeg(cached?.size) ?? 0
    const completed = nonNeg(props.total_downloaded)
      ?? (typeof cached?.progress === 'number' ? Math.round(cached.progress * size) : 0)
    const uploaded = nonNeg(props.total_uploaded)
      ?? (typeof cached?.ratio === 'number' ? Math.round(cached.ratio * completed) : 0)

    const numSeeds = nonNeg(props.seeds) ?? nonNeg(cached?.connectedSeeds) ?? 0
    const numLeechers = nonNeg(props.peers) ?? nonNeg(cached?.connectedPeers) ?? 0
    const connections = nonNeg(props.nb_connections) ?? (numSeeds + numLeechers)

    return {
      hash,
      name: cached?.name ?? hash,
      partial: true,
      size,
      completed,
      uploaded,
      dlLimit: normalizeLimit(props.dl_limit) ?? -1,
      upLimit: normalizeLimit(props.up_limit) ?? -1,
      seedingTime: nonNegOr(props.seeding_time, 0),
      addedTime: nonNegOr(props.addition_date, cached?.addedTime ?? 0),
      completionOn: nonNegOr(props.completion_date, 0),
      savePath: props.save_path ?? cached?.savePath ?? '',
      category: cached?.category ?? '',
      tags: cached?.tags ?? [],

      connections,
      numSeeds,
      numLeechers,
      totalSeeds: nonNeg(props.seeds_total) ?? cached?.totalSeeds,
      totalLeechers: nonNeg(props.peers_total) ?? cached?.totalPeers,

      files: (filesRes.data || []).map(f => this.normalizeFile(f)),
      trackers: (trackersRes.data || []).map(t => this.normalizeTracker(t)),
      peers,
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

  async queueMoveTop(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/topPrio', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  async queueMoveUp(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/increasePrio', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  async queueMoveDown(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/decreasePrio', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  async queueMoveBottom(hashes: string[]): Promise<void> {
    await apiClient.post('/api/v2/torrents/bottomPrio', null, {
      params: { hashes: hashes.join('|') || 'all' }
    })
  }

  async setAutoManagement(hashes: string[], enable: boolean): Promise<void> {
    await apiClient.post('/api/v2/torrents/setAutoManagement', null, {
      params: { hashes: hashes.join('|') || 'all', enable: enable.toString() }
    })
  }

  private async resolveTorrentsInfoFlags(hashes: string[]): Promise<QBTorrentInfo[]> {
    const hashesParam = hashes.join('|') || 'all'
    const { data } = await apiClient.get<QBTorrentInfo[]>('/api/v2/torrents/info', { params: { hashes: hashesParam } })
    return Array.isArray(data) ? data : []
  }

  async setSequentialDownload(hashes: string[], enable: boolean): Promise<void> {
    const info = await this.resolveTorrentsInfoFlags(hashes)
    const toToggle = info
      .filter(t => typeof t.hash === 'string' && Boolean(t.seq_dl) !== enable)
      .map(t => t.hash)
      .filter(Boolean)

    if (toToggle.length === 0) return

    await apiClient.post('/api/v2/torrents/toggleSequentialDownload', null, {
      params: { hashes: toToggle.join('|') }
    })
  }

  async setFirstLastPiecePriority(hashes: string[], enable: boolean): Promise<void> {
    const info = await this.resolveTorrentsInfoFlags(hashes)
    const toToggle = info
      .filter(t => typeof t.hash === 'string' && Boolean(t.f_l_piece_prio) !== enable)
      .map(t => t.hash)
      .filter(Boolean)

    if (toToggle.length === 0) return

    await apiClient.post('/api/v2/torrents/toggleFirstLastPiecePrio', null, {
      params: { hashes: toToggle.join('|') }
    })
  }

  async setSuperSeeding(hashes: string[], value: boolean): Promise<void> {
    await apiClient.post('/api/v2/torrents/setSuperSeeding', null, {
      params: { hashes: hashes.join('|') || 'all', value: value.toString() }
    })
  }

  async addTrackers(hash: string, urls: string[]): Promise<void> {
    const sanitized = urls.map(u => u.trim()).filter(Boolean)
    if (sanitized.length === 0) return

    const params = new URLSearchParams()
    params.append('hash', hash)
    params.append('urls', sanitized.join('\n'))

    await apiClient.post('/api/v2/torrents/addTrackers', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async editTracker(hash: string, origUrl: string, newUrl: string): Promise<void> {
    const from = String(origUrl ?? '').trim()
    const to = String(newUrl ?? '').trim()
    if (!from || !to || from === to) return

    const params = new URLSearchParams()
    params.append('hash', hash)
    params.append('origUrl', from)
    params.append('newUrl', to)

    await apiClient.post('/api/v2/torrents/editTracker', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async removeTrackers(hash: string, urls: string[]): Promise<void> {
    const sanitized = urls.map(u => u.trim()).filter(Boolean)
    if (sanitized.length === 0) return

    const params = new URLSearchParams()
    params.append('hash', hash)
    params.append('urls', sanitized.join('|'))

    await apiClient.post('/api/v2/torrents/removeTrackers', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async addPeers(hashes: string[], peers: string[]): Promise<void> {
    const sanitized = peers.map(p => p.trim()).filter(Boolean)
    if (sanitized.length === 0) return

    const params = new URLSearchParams()
    params.append('hashes', hashes.join('|') || 'all')
    params.append('peers', sanitized.join('|'))

    await apiClient.post('/api/v2/torrents/addPeers', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async banPeers(peers: string[]): Promise<void> {
    const sanitized = peers.map(p => p.trim()).filter(Boolean)
    if (sanitized.length === 0) return

    const params = new URLSearchParams()
    params.append('peers', sanitized.join('|'))

    await apiClient.post('/api/v2/transfer/banPeers', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async setDownloadLimit(hash: string, limit: number): Promise<void> {
    await this.setDownloadLimitBatch([hash], limit)
  }

  async setDownloadLimitBatch(hashes: string[], limit: number): Promise<void> {
    // qB 的 setDownloadLimit 在不同端点/版本里对“无限制”的表达不完全一致（0/-1）。
    // 这里统一：<= 0 一律按“无限制”处理，并向后端发送 0（与 downloadLimit 端点保持一致）。
    const raw = typeof limit === 'number' && Number.isFinite(limit) ? limit : 0
    const normalized = raw <= 0 ? 0 : Math.round(raw)
    await apiClient.post('/api/v2/torrents/setDownloadLimit', null, {
      params: { hashes: hashes.join('|') || 'all', limit: normalized.toString() }
    })
  }

  async setUploadLimit(hash: string, limit: number): Promise<void> {
    await this.setUploadLimitBatch([hash], limit)
  }

  async setUploadLimitBatch(hashes: string[], limit: number): Promise<void> {
    // 同 setDownloadLimitBatch：<= 0 视为无限制，发送 0。
    const raw = typeof limit === 'number' && Number.isFinite(limit) ? limit : 0
    const normalized = raw <= 0 ? 0 : Math.round(raw)
    await apiClient.post('/api/v2/torrents/setUploadLimit', null, {
      params: { hashes: hashes.join('|') || 'all', limit: normalized.toString() }
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
      if (safeTags.length === 0) {
        // qB 的 setTags 若 tags 为空可能不会清空；这里用 removeTags 清空标签。
        const removeInChunks = async (payloadTags: string[]) => {
          const CHUNK_SIZE = 100
          for (let i = 0; i < payloadTags.length; i += CHUNK_SIZE) {
            await tryCall('/api/v2/torrents/removeTags', payloadTags.slice(i, i + CHUNK_SIZE))
          }
        }

        const fetchUnionFromInfo = async (): Promise<Set<string>> => {
          const { data } = await apiClient.get<QBTorrentInfo[]>('/api/v2/torrents/info', { params: { hashes: hashesParam } })

          const union = new Set<string>()
          for (const item of data || []) {
            const raw = String(item?.tags ?? '')
            if (!raw.trim()) continue
            for (const t of raw.split(',')) {
              const normalized = t.trim()
              if (normalized) union.add(normalized)
            }
          }
          return union
        }

        let union = new Set<string>()
        let usedFallback = false

        if (hashes.length === 0) {
          try {
            const all = await this.getTags()
            for (const t of all) {
              const normalized = t.trim()
              if (normalized) union.add(normalized)
            }
          } catch (error) {
            usedFallback = true
            console.warn('[QbitAdapter] Failed to load tags list, fallback to cache:', error)
            for (const t of this.currentTags) {
              const normalized = String(t ?? '').trim()
              if (normalized) union.add(normalized)
            }
          }
        } else {
          try {
            union = await fetchUnionFromInfo()
          } catch (error) {
            usedFallback = true
            console.warn('[QbitAdapter] Failed to load torrent tags from backend, fallback to cache:', error)
            for (const h of hashes) {
              const current = this.currentMap.get(h)?.tags ?? []
              for (const t of current) {
                const normalized = String(t ?? '').trim()
                if (normalized) union.add(normalized)
              }
            }
          }
        }

        await removeInChunks(Array.from(union))

        // Silent retry：如果走了缓存兜底，再用后端权威数据补一次，避免 currentMap 脏读导致“清空不彻底”。
        if (usedFallback) {
          try {
            if (hashes.length === 0) {
              const all = await this.getTags()
              const remaining = all.map(t => t.trim()).filter(Boolean)
              await removeInChunks(remaining)
            } else {
              const remainingUnion = await fetchUnionFromInfo()
              await removeInChunks(Array.from(remainingUnion))
            }
          } catch {
            // ignore
          }
        }
        return
      }
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
    let speedModeFailed = false
    let prefsFailed = false

    const [maindataRes, speedModeRes, prefsRes] = await Promise.all([
      apiClient.get<QBSyncResponse>('/api/v2/sync/maindata', { params: { rid: 0 } }),
      apiClient.get('/api/v2/transfer/speedLimitsMode').catch(() => {
        speedModeFailed = true
        return { data: null }
      }),
      apiClient.get<Record<string, unknown>>('/api/v2/app/preferences').catch(() => {
        prefsFailed = true
        return { data: {} as Record<string, unknown> }
      }),
    ])

    const state = this.normalizeServerState(maindataRes.data.server_state)
    const mode = speedModeRes.data
    const modeNum = typeof mode === 'number' ? mode : Number.parseInt(String(mode), 10)
    const modeKnown = Number.isFinite(modeNum)
    const altEnabled = modeKnown ? modeNum === 1 : (state?.useAltSpeed ?? false)

    const prefs = prefsRes.data || {}
    const altDlKib = typeof prefs.alt_dl_limit === 'number' && Number.isFinite(prefs.alt_dl_limit) ? prefs.alt_dl_limit : 0
    const altUpKib = typeof prefs.alt_up_limit === 'number' && Number.isFinite(prefs.alt_up_limit) ? prefs.alt_up_limit : 0
    const partial = speedModeFailed || prefsFailed || !modeKnown

    return {
      downloadLimit: state?.dlRateLimit ?? 0,
      uploadLimit: state?.upRateLimit ?? 0,
      altEnabled,
      altDownloadLimit: Math.max(0, Math.round(altDlKib)) * 1024,
      altUploadLimit: Math.max(0, Math.round(altUpKib)) * 1024,
      speedBytes: 1024,
      ...(partial ? { partial: true } : {}),
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
      // 文档接口：speedLimitsMode + toggleSpeedLimitsMode（无 set）
      // 兼容：若后端提供 setSpeedLimitsMode，则优先使用它
      try {
        await apiClient.post('/api/v2/transfer/setSpeedLimitsMode', null, { params: { mode: patch.altEnabled ? 1 : 0 } })
      } catch (error: any) {
        const status = error?.response?.status
        if (status !== 404 && status !== 405) throw error

        const res = await apiClient.get('/api/v2/transfer/speedLimitsMode').catch(() => ({ data: 0 }))
        const mode = res.data
        const modeNum = typeof mode === 'number' ? mode : Number.parseInt(String(mode), 10)
        const currentEnabled = Number.isFinite(modeNum) ? modeNum === 1 : false
        if (currentEnabled !== patch.altEnabled) {
          await apiClient.post('/api/v2/transfer/toggleSpeedLimitsMode')
        }
      }
    }
    if (typeof patch.altDownloadLimit === 'number' || typeof patch.altUploadLimit === 'number') {
      // 文档接口：备用限速值在 preferences 里（KiB/s）
      // 兼容：若后端提供 transfer/setAlternativeSpeedLimits，则优先使用它
      const downloadLimit = typeof patch.altDownloadLimit === 'number' ? patch.altDownloadLimit : undefined
      const uploadLimit = typeof patch.altUploadLimit === 'number' ? patch.altUploadLimit : undefined

      if (downloadLimit !== undefined && uploadLimit !== undefined) {
        try {
          await apiClient.post('/api/v2/transfer/setAlternativeSpeedLimits', null, { params: { downloadLimit, uploadLimit } })
          return
        } catch (error: any) {
          const status = error?.response?.status
          if (status !== 404 && status !== 405) throw error
        }
      }

      const qbPrefs: Record<string, unknown> = {}
      if (downloadLimit !== undefined) qbPrefs.alt_dl_limit = Math.max(0, Math.round(downloadLimit / 1024))
      if (uploadLimit !== undefined) qbPrefs.alt_up_limit = Math.max(0, Math.round(uploadLimit / 1024))

      if (Object.keys(qbPrefs).length === 0) return

      const params = new URLSearchParams()
      params.append('json', JSON.stringify(qbPrefs))
      await apiClient.post('/api/v2/app/setPreferences', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
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

  private mapLogLevel(type: unknown): AppLogEntry['level'] {
    const num = typeof type === 'number' ? type : Number.parseInt(String(type), 10)
    if (!Number.isFinite(num)) return 'normal'
    // type 是 bitmask：CRITICAL(8) > WARNING(4) > INFO(2) > NORMAL(1)
    if ((num & 8) === 8) return 'critical'
    if ((num & 4) === 4) return 'warning'
    if ((num & 2) === 2) return 'info'
    return 'normal'
  }

  async getAppLog(params?: {
    normal?: boolean
    info?: boolean
    warning?: boolean
    critical?: boolean
    lastKnownId?: number
  }): Promise<AppLogEntry[]> {
    const { data } = await apiClient.get<Array<{ id: number; message: string; timestamp: number; type: number }>>('/api/v2/log/main', {
      params: {
        normal: params?.normal ?? true,
        info: params?.info ?? true,
        warning: params?.warning ?? true,
        critical: params?.critical ?? true,
        last_known_id: params?.lastKnownId ?? -1,
      }
    })

    const items = Array.isArray(data) ? data : []
    return items.map(item => ({
      id: typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : 0,
      timestamp: typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : 0,
      level: this.mapLogLevel(item.type),
      message: String(item.message ?? ''),
    }))
  }

  async getPeerLog(params?: { lastKnownId?: number }): Promise<PeerLogEntry[]> {
    const { data } = await apiClient.get<Array<{ id: number; ip: string; timestamp: number; blocked: boolean; reason: string }>>('/api/v2/log/peers', {
      params: { last_known_id: params?.lastKnownId ?? -1 }
    })

    const items = Array.isArray(data) ? data : []
    return items.map(item => ({
      id: typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : 0,
      ip: String(item.ip ?? ''),
      timestamp: typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : 0,
      blocked: Boolean(item.blocked),
      reason: String(item.reason ?? ''),
    }))
  }

  async rssAddFolder(path: string): Promise<void> {
    const normalized = String(path ?? '').trim()
    if (!normalized) return
    const params = new URLSearchParams()
    params.append('path', normalized)
    await apiClient.post('/api/v2/rss/addFolder', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssAddFeed(url: string, path?: string): Promise<void> {
    const normalizedUrl = String(url ?? '').trim()
    if (!normalizedUrl) return
    const params = new URLSearchParams()
    params.append('url', normalizedUrl)
    const normalizedPath = String(path ?? '').trim()
    if (normalizedPath) params.append('path', normalizedPath)
    await apiClient.post('/api/v2/rss/addFeed', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssRemoveItem(path: string): Promise<void> {
    const normalized = String(path ?? '').trim()
    if (!normalized) return
    const params = new URLSearchParams()
    params.append('path', normalized)
    await apiClient.post('/api/v2/rss/removeItem', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssMoveItem(itemPath: string, destPath: string): Promise<void> {
    const src = String(itemPath ?? '').trim()
    const dest = String(destPath ?? '').trim()
    if (!src || !dest) return
    const params = new URLSearchParams()
    params.append('itemPath', src)
    params.append('destPath', dest)
    await apiClient.post('/api/v2/rss/moveItem', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssGetItems(withData?: boolean): Promise<RssItems> {
    const { data } = await apiClient.get<RssItems>('/api/v2/rss/items', {
      params: withData !== undefined ? { withData } : undefined
    })
    return (data && typeof data === 'object') ? data : {}
  }

  async rssMarkAsRead(itemPath: string, articleId?: string): Promise<void> {
    const path = String(itemPath ?? '').trim()
    if (!path) return
    const params = new URLSearchParams()
    params.append('itemPath', path)
    const article = String(articleId ?? '').trim()
    if (article) params.append('articleId', article)
    await apiClient.post('/api/v2/rss/markAsRead', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssRefreshItem(itemPath: string): Promise<void> {
    const path = String(itemPath ?? '').trim()
    if (!path) return
    const params = new URLSearchParams()
    params.append('itemPath', path)
    await apiClient.post('/api/v2/rss/refreshItem', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssSetRule(ruleName: string, ruleDef: RssRuleDefinition): Promise<void> {
    const name = String(ruleName ?? '').trim()
    if (!name) return
    const params = new URLSearchParams()
    params.append('ruleName', name)
    params.append('ruleDef', JSON.stringify(ruleDef ?? {}))
    await apiClient.post('/api/v2/rss/setRule', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssRenameRule(ruleName: string, newRuleName: string): Promise<void> {
    const from = String(ruleName ?? '').trim()
    const to = String(newRuleName ?? '').trim()
    if (!from || !to || from === to) return
    const params = new URLSearchParams()
    params.append('ruleName', from)
    params.append('newRuleName', to)
    await apiClient.post('/api/v2/rss/renameRule', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssRemoveRule(ruleName: string): Promise<void> {
    const name = String(ruleName ?? '').trim()
    if (!name) return
    const params = new URLSearchParams()
    params.append('ruleName', name)
    await apiClient.post('/api/v2/rss/removeRule', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async rssGetRules(): Promise<Record<string, RssRuleDefinition>> {
    const { data } = await apiClient.get<Record<string, RssRuleDefinition>>('/api/v2/rss/rules')
    return (data && typeof data === 'object') ? data : {}
  }

  async rssMatchingArticles(ruleName: string): Promise<Record<string, string[]>> {
    const name = String(ruleName ?? '').trim()
    if (!name) return {}
    const { data } = await apiClient.get<Record<string, string[]>>('/api/v2/rss/matchingArticles', { params: { ruleName: name } })
    return (data && typeof data === 'object') ? data : {}
  }

  async searchStart(params: { pattern: string; plugins?: string; category?: string }): Promise<number> {
    const pattern = String(params?.pattern ?? '').trim()
    if (!pattern) throw new Error('pattern is required')

    const { data } = await apiClient.get<{ id: number }>('/api/v2/search/start', {
      params: {
        pattern,
        plugins: params?.plugins ?? 'enabled',
        category: params?.category ?? 'all',
      }
    })

    const id = (data as any)?.id
    if (typeof id === 'number' && Number.isFinite(id)) return id
    const parsed = Number(id)
    if (Number.isFinite(parsed)) return parsed
    throw new Error('Invalid search job id')
  }

  async searchStop(id: number): Promise<void> {
    await apiClient.post('/api/v2/search/stop', null, { params: { id } })
  }

  async searchDelete(id: number): Promise<void> {
    await apiClient.post('/api/v2/search/delete', null, { params: { id } })
  }

  async searchStatus(id?: number): Promise<SearchJobStatus[]> {
    const { data } = await apiClient.get<SearchJobStatus[]>('/api/v2/search/status', {
      params: id !== undefined ? { id } : undefined
    })
    return Array.isArray(data) ? data : []
  }

  async searchResults(params: { id: number; limit?: number; offset?: number }): Promise<SearchResults> {
    const { data } = await apiClient.get<SearchResults>('/api/v2/search/results', {
      params: {
        id: params.id,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
      }
    })
    return data
  }

  async searchPlugins(): Promise<SearchPlugin[]> {
    const { data } = await apiClient.get<SearchPlugin[]>('/api/v2/search/plugins')
    return Array.isArray(data) ? data : []
  }

  async searchInstallPlugin(sources: string[]): Promise<void> {
    const sanitized = sources.map(s => s.trim()).filter(Boolean)
    if (sanitized.length === 0) return
    const params = new URLSearchParams()
    params.append('sources', sanitized.join('|'))
    await apiClient.post('/api/v2/search/installPlugin', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async searchUninstallPlugin(names: string[]): Promise<void> {
    const sanitized = names.map(s => s.trim()).filter(Boolean)
    if (sanitized.length === 0) return
    const params = new URLSearchParams()
    params.append('names', sanitized.join('|'))
    await apiClient.post('/api/v2/search/uninstallPlugin', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async searchEnablePlugin(names: string[], enable: boolean): Promise<void> {
    const sanitized = names.map(s => s.trim()).filter(Boolean)
    if (sanitized.length === 0) return
    const params = new URLSearchParams()
    params.append('names', sanitized.join('|'))
    params.append('enable', enable.toString())
    await apiClient.post('/api/v2/search/enablePlugin', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async searchUpdatePlugins(): Promise<void> {
    await apiClient.post('/api/v2/search/updatePlugins')
  }

  getCapabilities(): BackendCapabilities {
    return {
      // 队列相关
      hasSeparateSeedQueue: false, // qB 的队列是全局的（queueing_enabled 同时控制下载/做种）
      hasStalledQueue: false,
      hasTorrentQueue: true,

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

      hasTrackerManagement: true,
      hasPeerManagement: true,
      hasBandwidthPriority: false,
      hasTorrentAdvancedSwitches: true,
      hasAutoManagement: true,
      hasSequentialDownload: true,
      hasFirstLastPiecePriority: true,
      hasSuperSeeding: true,

      hasLogs: true,
      hasRss: this.toolsCapabilities.hasRss,
      hasSearch: this.toolsCapabilities.hasSearch,

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
    const conn = String(state.connection_status ?? '')
    const alt = state.use_alt_speed_limits ?? state.use_alt_speed

    const safeNum = (val: unknown, fallback = 0): number => {
      if (typeof val === 'number') {
        return Number.isFinite(val) ? val : fallback
      }
      if (typeof val === 'string') {
        const trimmed = val.trim()
        if (!trimmed) return fallback
        const parsed = Number(trimmed)
        return Number.isFinite(parsed) ? parsed : fallback
      }
      return fallback
    }
    const safeBool = (val: unknown, fallback = false): boolean => {
      if (typeof val === 'boolean') return val
      if (typeof val === 'number') {
        if (val === 1) return true
        if (val === 0) return false
        return fallback
      }
      if (typeof val === 'string') {
        const normalized = val.trim().toLowerCase()
        if (normalized === '1' || normalized === 'true') return true
        if (normalized === '0' || normalized === 'false') return false
      }
      return fallback
    }

    return {
      dlInfoSpeed: safeNum(state.dl_info_speed),
      upInfoSpeed: safeNum(state.up_info_speed),
      dlRateLimit: safeNum(state.dl_rate_limit),
      upRateLimit: safeNum(state.up_rate_limit),
      connectionStatus: conn === 'connected' ? 'connected' : conn === 'firewalled' ? 'firewalled' : 'disconnected',
      peers: safeNum(state.peers),
      freeSpaceOnDisk: safeNum(state.free_space_on_disk),
      useAltSpeed: safeBool(alt),
      altDlLimit: safeNum(state.alt_dl_limit),
      altUpLimit: safeNum(state.alt_up_limit),
    }
  }

  protected normalize(hash: string, raw: Partial<QBTorrent>, existing?: UnifiedTorrent): UnifiedTorrent {
    const rawState = raw.state
    let normalizedState: TorrentState = existing?.state ?? 'error'
    if (rawState) {
      normalizedState = STATE_MAP[rawState] ?? 'error'
    }

    const rawAny = raw as Record<string, unknown>
    const hasCategory = 'category' in rawAny
    const hasTags = 'tags' in rawAny

    // 注意：sync/maindata 增量更新时，字段可能缺失；区分“字段缺失”和“值为 0”。
    const hasConnectedSeeds = 'num_seeds' in rawAny
    const hasConnectedPeers = 'num_leechs' in rawAny
    const hasTotalSeeds = 'num_complete' in rawAny
    const hasTotalPeers = 'num_incomplete' in rawAny

    const normalizeCount = (val: unknown): number | undefined => (
      typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : undefined
    )

    const connectedSeeds = hasConnectedSeeds ? normalizeCount(rawAny.num_seeds) : existing?.connectedSeeds
    const connectedPeers = hasConnectedPeers ? normalizeCount(rawAny.num_leechs) : existing?.connectedPeers
    const totalSeeds = hasTotalSeeds ? normalizeCount(rawAny.num_complete) : existing?.totalSeeds
    const totalPeers = hasTotalPeers ? normalizeCount(rawAny.num_incomplete) : existing?.totalPeers

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
      // qB 的 category/tags：字段存在且为空字符串时表示“清空”，不能用 truthy 判断（会导致幽灵数据）
      category: hasCategory ? (typeof raw.category === 'string' ? raw.category : '') : existing?.category,
      tags: hasTags
        ? (typeof raw.tags === 'string' ? raw.tags.split(',').map(t => t.trim()).filter(Boolean) : [])
        : existing?.tags,
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
    // qB file priority values (docs): 0=do not download, 1=normal, 6=high, 7=maximal
    // -2: undocumented fallback; treat as "do not download" defensively
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

  protected normalizePeer(peer: unknown): Peer | null {
    if (!peer || typeof peer !== 'object') return null
    const raw = peer as unknown as Record<string, unknown>

    const safeStr = (val: unknown): string => (typeof val === 'string' ? val : '')
    const safeNum = (val: unknown): number | undefined => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : undefined
      if (typeof val === 'string') {
        const trimmed = val.trim()
        if (!trimmed) return undefined
        const parsed = Number(trimmed)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      return undefined
    }
    const nonNeg = (val: unknown): number => {
      const n = safeNum(val)
      return n !== undefined && n >= 0 ? n : 0
    }

    const ip = safeStr(raw.ip)
    if (!ip) return null

    const portRaw = safeNum(raw.port)
    const port = portRaw !== undefined && portRaw >= 0 ? Math.floor(portRaw) : 0

    const progressRaw = safeNum(raw.progress) ?? 0
    const progress = Math.max(0, Math.min(1, progressRaw))

    return {
      ip,
      port,
      client: safeStr(raw.client),
      progress,
      dlSpeed: nonNeg(raw.dl_speed),
      upSpeed: nonNeg(raw.up_speed),
      downloaded: nonNeg(raw.downloaded),
      uploaded: nonNeg(raw.uploaded),
    }
  }
}
