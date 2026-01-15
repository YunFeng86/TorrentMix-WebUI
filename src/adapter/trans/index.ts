import { transClient } from '@/api/trans-client'
import type { BaseAdapter, AddTorrentParams, FetchListResult, TransferSettings, BackendPreferences, BackendCapabilities } from '../interface'
import type { Category, Peer, TorrentFile, TorrentState, Tracker, UnifiedTorrent, UnifiedTorrentDetail } from '../types'

/**
 * Transmission RPC 方法名映射（json-rpc2 vs legacy）
 * - json-rpc2: snake_case, method 形如 torrent_get
 * - legacy: kebab-case, method 形如 torrent-get
 */
type TrMethod =
  | 'session-get'
  | 'session-set'
  | 'torrent-get'
  | 'torrent-set'
  | 'torrent-set-location'
  | 'torrent-add'
  | 'torrent-remove'
  | 'torrent-start'
  | 'torrent-start-now'
  | 'torrent-stop'
  | 'torrent-verify'
  | 'torrent-reannounce'

const METHOD_MAP: Record<TrMethod, { jsonrpc2: string; legacy: string }> = {
  'session-get': { jsonrpc2: 'session_get', legacy: 'session-get' },
  'session-set': { jsonrpc2: 'session_set', legacy: 'session-set' },
  'torrent-get': { jsonrpc2: 'torrent_get', legacy: 'torrent-get' },
  'torrent-set': { jsonrpc2: 'torrent_set', legacy: 'torrent-set' },
  'torrent-set-location': { jsonrpc2: 'torrent_set_location', legacy: 'torrent-set-location' },
  'torrent-add': { jsonrpc2: 'torrent_add', legacy: 'torrent-add' },
  'torrent-remove': { jsonrpc2: 'torrent_remove', legacy: 'torrent-remove' },
  'torrent-start': { jsonrpc2: 'torrent_start', legacy: 'torrent-start' },
  'torrent-start-now': { jsonrpc2: 'torrent_start_now', legacy: 'torrent-start-now' },
  'torrent-stop': { jsonrpc2: 'torrent_stop', legacy: 'torrent-stop' },
  'torrent-verify': { jsonrpc2: 'torrent_verify', legacy: 'torrent-verify' },
  'torrent-reannounce': { jsonrpc2: 'torrent_reannounce', legacy: 'torrent-reannounce' },
}

/**
 * Transmission RPC 请求体（JSON-RPC 2.0）
 */
interface JSONRPC2Request {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id: number
}

interface JSONRPC2Response<T = unknown> {
  jsonrpc: '2.0'
  result?: T
  error?: {
    code: number
    message: string
    data?: { errorString?: string }
  }
  id?: number
}

/**
 * Transmission RPC 请求体（旧协议）
 */
interface LegacyRequest {
  method: string
  arguments?: Record<string, unknown>
  tag?: number
}

/**
 * Transmission RPC 响应（旧协议）
 */
interface LegacyResponse<T = unknown> {
  result: 'success' | string
  arguments?: T
  tag?: number
}

interface TRTrackerStat {
  announce: string
  tier: number
  hasAnnounced?: boolean
  has_announced?: boolean
  lastAnnounceSucceeded?: boolean
  last_announce_succeeded?: boolean
  lastAnnounceResult?: string
  last_announce_result?: string
  lastAnnouncePeerCount?: number
  last_announce_peer_count?: number
  announceState?: number
  announce_state?: number
  seederCount?: number
  seeder_count?: number
  leecherCount?: number
  leecher_count?: number
}

interface TRPeer {
  address: string
  port: number
  clientName?: string
  client_name?: string
  progress?: number
  rateToClient?: number
  rate_to_client?: number
  rateToPeer?: number
  rate_to_peer?: number
}

/**
 * Transmission 种子对象（字段按需，可同时兼容 json-rpc2/legacy）
 */
interface TRTorrent {
  id?: number
  hashString?: string
  hash_string?: string
  name?: string
  status?: number
  error?: number
  errorString?: string
  error_string?: string
  percentDone?: number
  percent_done?: number
  totalSize?: number
  total_size?: number
  rateDownload?: number
  rate_download?: number
  rateUpload?: number
  rate_upload?: number
  eta?: number
  uploadRatio?: number
  upload_ratio?: number
  addedDate?: number
  added_date?: number
  downloadDir?: string
  download_dir?: string
  labels?: string[]
  downloadedEver?: number
  downloaded_ever?: number
  uploadedEver?: number
  uploaded_ever?: number
  downloadLimit?: number
  download_limit?: number
  downloadLimited?: boolean
  download_limited?: boolean
  uploadLimit?: number
  upload_limit?: number
  uploadLimited?: boolean
  upload_limited?: boolean
  secondsSeeding?: number
  seconds_seeding?: number
  doneDate?: number
  done_date?: number
  peersConnected?: number
  peers_connected?: number
  peersGettingFromUs?: number
  peers_getting_from_us?: number
  peersSendingToUs?: number
  peers_sending_to_us?: number
  files?: Array<{
    name: string
    length: number
    bytesCompleted?: number
    bytes_completed?: number
  }>
  trackers?: Array<{
    announce: string
    tier: number
  }>
  trackerStats?: TRTrackerStat[]
  tracker_stats?: TRTrackerStat[]
  peers?: TRPeer[]
  priorities?: number[]
  wanted?: Array<boolean | 0 | 1>
}

/**
 * Transmission 状态码映射到 TorrentState
 *
 * TR_STATUS_STOPPED = 0
 * TR_STATUS_CHECK_WAIT = 1
 * TR_STATUS_CHECK = 2
 * TR_STATUS_DOWNLOAD_WAIT = 3
 * TR_STATUS_DOWNLOAD = 4
 * TR_STATUS_SEED_WAIT = 5
 * TR_STATUS_SEED = 6
 */
const STATE_MAP: Record<number, TorrentState> = {
  0: 'paused',
  1: 'queued',
  2: 'checking',
  3: 'queued',
  4: 'downloading',
  5: 'queued',
  6: 'seeding'
}

/**
 * Transmission 适配器
 *
 * 实现要点：
 * - 使用 hash_string/hashString 作为稳定的 id（daemon 重启后不变）
 * - 支持 JSON-RPC 2.0 (TR 4.1+) 和旧协议 (TR 4.0.x)
 * - 状态用数字枚举，需要映射到 TorrentState
 * - 进度使用 percent_done/percentDone (0-1)
 * - 使用 labels 数组，第一个元素作为 category
 */
export class TransAdapter implements BaseAdapter {
  private protocolVersion: 'json-rpc2' | 'legacy' = 'legacy'
  private currentMap = new Map<string, UnifiedTorrent>()

  constructor(versionInfo?: { rpcSemver?: string }) {
    // 根据 rpc-version-semver 判断协议版本
    if (versionInfo?.rpcSemver) {
      const semver = versionInfo.rpcSemver.split('.').map(Number)
      // rpc-version-semver >= 6.0.0 使用 JSON-RPC 2.0
      this.protocolVersion = (semver[0] ?? 0) >= 6 ? 'json-rpc2' : 'legacy'
    } else {
      // 未知版本时优先使用 legacy（兼容面更大；4.1+ 也仍支持 legacy）
      this.protocolVersion = 'legacy'
    }
  }

  private pick<T>(obj: Record<string, unknown> | undefined, ...keys: string[]): T | undefined {
    if (!obj) return undefined
    for (const key of keys) {
      const value = (obj as any)[key]
      if (value !== undefined) return value as T
    }
    return undefined
  }

  /**
   * 封装 RPC 调用，统一处理协议版本和错误
   */
  private async rpcCall<T = unknown>(
    method: TrMethod,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (this.protocolVersion === 'json-rpc2') {
      const payload: JSONRPC2Request = {
        jsonrpc: '2.0',
        method: METHOD_MAP[method].jsonrpc2,
        params,
        id: Date.now(),
      }
      const { data, status } = await transClient.post<JSONRPC2Response<T>>('', payload)
      if (status === 204) return undefined as T
      if (!data) return undefined as T
      if (data.error) {
        const extra = data.error.data?.errorString ? `: ${data.error.data.errorString}` : ''
        throw new Error(`Transmission RPC error(${data.error.code}): ${data.error.message}${extra}`)
      }
      return data.result as T
    }

    const payload: LegacyRequest = {
      method: METHOD_MAP[method].legacy,
      arguments: params,
      tag: Date.now(),
    }

    const { data } = await transClient.post<LegacyResponse<T>>('', payload)

    if (data.result !== 'success') {
      throw new Error(`Transmission RPC error: ${data.result}`)
    }

    return data.arguments as T
  }

  /**
   * 归一化：Transmission → UnifiedTorrent
   */
  private normalize(raw: TRTorrent): UnifiedTorrent {
    const hash = this.pick<string>(raw as any, 'hash_string', 'hashString') ?? ''
    const statusCode = this.pick<number>(raw as any, 'status') ?? -1
    const errorCode = this.pick<number>(raw as any, 'error') ?? 0

    const state = errorCode !== 0 ? 'error' : (STATE_MAP[statusCode] ?? 'error')

    return {
      id: hash,
      name: this.pick<string>(raw as any, 'name') ?? '',
      state,
      progress: this.pick<number>(raw as any, 'percent_done', 'percentDone') ?? 0,
      size: this.pick<number>(raw as any, 'total_size', 'totalSize') ?? 0,
      dlspeed: this.pick<number>(raw as any, 'rate_download', 'rateDownload') ?? 0,
      upspeed: this.pick<number>(raw as any, 'rate_upload', 'rateUpload') ?? 0,
      eta: (() => {
        const eta = this.pick<number>(raw as any, 'eta') ?? -1
        return eta === -1 ? -1 : eta
      })(),
      ratio: this.pick<number>(raw as any, 'upload_ratio', 'uploadRatio') ?? 0,
      addedTime: this.pick<number>(raw as any, 'added_date', 'addedDate') ?? 0,
      savePath: this.pick<string>(raw as any, 'download_dir', 'downloadDir') ?? '',
      category: raw.labels?.[0] || '',
      tags: raw.labels || [],
    }
  }

  /**
   * 映射 Tracker 状态
   */
  private mapTracker(
    tracker: { announce: string; tier: number },
    stat?: TRTrackerStat
  ): Tracker {
    let status: Tracker['status'] = 'not_working'

    if (stat) {
      const announceState = this.pick<number>(stat as any, 'announce_state', 'announceState') ?? 0
      const hasAnnounced = this.pick<boolean>(stat as any, 'has_announced', 'hasAnnounced') ?? false
      const lastAnnounceSucceeded = this.pick<boolean>(stat as any, 'last_announce_succeeded', 'lastAnnounceSucceeded') ?? false
      if (announceState > 0) {
        status = 'updating'
      } else if (hasAnnounced && lastAnnounceSucceeded) {
        status = 'working'
      }
    }

    return {
      url: tracker.announce,
      status,
      msg: this.pick<string>(stat as any, 'last_announce_result', 'lastAnnounceResult') || '',
      peers: this.pick<number>(stat as any, 'last_announce_peer_count', 'lastAnnouncePeerCount') || 0,
      tier: tracker.tier || 0,
    }
  }

  // ========== 全局/备用限速设置 ==========

  async getTransferSettings(): Promise<TransferSettings> {
    const args = await this.rpcCall<Record<string, unknown>>('session-get')

    const dlEnabled = Boolean(this.pick<boolean>(args, 'speed_limit_down_enabled', 'speed-limit-down-enabled'))
    const ulEnabled = Boolean(this.pick<boolean>(args, 'speed_limit_up_enabled', 'speed-limit-up-enabled'))
    const dlKbps = this.pick<number>(args, 'speed_limit_down', 'speed-limit-down') ?? 0
    const ulKbps = this.pick<number>(args, 'speed_limit_up', 'speed-limit-up') ?? 0

    const altEnabled = Boolean(this.pick<boolean>(args, 'alt_speed_enabled', 'alt-speed-enabled'))
    const altDlKbps = this.pick<number>(args, 'alt_speed_down', 'alt-speed-down') ?? 0
    const altUlKbps = this.pick<number>(args, 'alt_speed_up', 'alt-speed-up') ?? 0

    return {
      downloadLimit: dlEnabled ? Math.max(0, dlKbps) * 1024 : 0,
      uploadLimit: ulEnabled ? Math.max(0, ulKbps) * 1024 : 0,
      altEnabled,
      altDownloadLimit: Math.max(0, altDlKbps) * 1024,
      altUploadLimit: Math.max(0, altUlKbps) * 1024,
    }
  }

  async setTransferSettings(patch: Partial<TransferSettings>): Promise<void> {
    const args: Record<string, unknown> = {}
    const downEnabledKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_down_enabled' : 'speed-limit-down-enabled'
    const downKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_down' : 'speed-limit-down'
    const upEnabledKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_up_enabled' : 'speed-limit-up-enabled'
    const upKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_up' : 'speed-limit-up'
    const altEnabledKey = this.protocolVersion === 'json-rpc2' ? 'alt_speed_enabled' : 'alt-speed-enabled'
    const altDownKey = this.protocolVersion === 'json-rpc2' ? 'alt_speed_down' : 'alt-speed-down'
    const altUpKey = this.protocolVersion === 'json-rpc2' ? 'alt_speed_up' : 'alt-speed-up'

    if (typeof patch.downloadLimit === 'number') {
      const kbps = Math.max(0, Math.round(patch.downloadLimit / 1024))
      args[downEnabledKey] = kbps > 0
      args[downKey] = kbps
    }
    if (typeof patch.uploadLimit === 'number') {
      const kbps = Math.max(0, Math.round(patch.uploadLimit / 1024))
      args[upEnabledKey] = kbps > 0
      args[upKey] = kbps
    }
    if (typeof patch.altEnabled === 'boolean') {
      args[altEnabledKey] = patch.altEnabled
    }
    if (typeof patch.altDownloadLimit === 'number') {
      args[altDownKey] = Math.max(0, Math.round(patch.altDownloadLimit / 1024))
    }
    if (typeof patch.altUploadLimit === 'number') {
      args[altUpKey] = Math.max(0, Math.round(patch.altUploadLimit / 1024))
    }

    if (Object.keys(args).length === 0) return

    await this.rpcCall('session-set', args)
  }

  async getPreferences(): Promise<BackendPreferences> {
    const session = await this.rpcCall<Record<string, unknown>>('session-get')

    return {
      // 连接
      maxConnections: this.pick<number>(session, 'peer_limit_global', 'peer-limit-global'),
      maxConnectionsPerTorrent: this.pick<number>(session, 'peer_limit_per_torrent', 'peer-limit-per-torrent'),

      // 队列
      queueDownloadEnabled: this.pick<boolean>(session, 'download_queue_enabled', 'download-queue-enabled'),
      queueDownloadMax: this.pick<number>(session, 'download_queue_size', 'download-queue-size'),
      queueSeedEnabled: this.pick<boolean>(session, 'seed_queue_enabled', 'seed-queue-enabled'),
      queueSeedMax: this.pick<number>(session, 'seed_queue_size', 'seed-queue-size'),
      queueStalledEnabled: this.pick<boolean>(session, 'queue_stalled_enabled', 'queue-stalled-enabled'),
      queueStalledMinutes: this.pick<number>(session, 'queue_stalled_minutes', 'queue-stalled-minutes'),

      // 端口
      listenPort: this.pick<number>(session, 'peer_port', 'peer-port'),
      randomPort: this.pick<boolean>(session, 'peer_port_random_on_start', 'peer-port-random-on-start'),
      upnpEnabled: this.pick<boolean>(session, 'port_forwarding_enabled', 'port-forwarding-enabled'),

      // 协议
      dhtEnabled: this.pick<boolean>(session, 'dht_enabled', 'dht-enabled'),
      pexEnabled: this.pick<boolean>(session, 'pex_enabled', 'pex-enabled'),
      lsdEnabled: this.pick<boolean>(session, 'lpd_enabled', 'lpd-enabled'),
      encryption: this.mapEncryptionMode(this.pick<string>(session, 'encryption')),

      // Phase 1: 做种限制
      shareRatioLimit: this.pick<number>(session, 'seed_ratio_limit', 'seedRatioLimit', 'seed-ratio-limit'),
      shareRatioLimited: this.pick<boolean>(session, 'seed_ratio_limited', 'seedRatioLimited', 'seed-ratio-limited'),
      seedingTimeLimit: this.pick<number>(session, 'seed_idle_limit', 'seedIdleLimit', 'seed-idle-limit'),
      seedingTimeLimited: this.pick<boolean>(session, 'seed_idle_limited', 'seedIdleLimited', 'seed-idle-limited'),

      // Phase 1: 下载路径
      savePath: this.pick<string>(session, 'download_dir', 'download-dir'),
      incompleteDirEnabled: this.pick<boolean>(session, 'incomplete_dir_enabled', 'incomplete-dir-enabled'),
      incompleteDir: this.pick<string>(session, 'incomplete_dir', 'incomplete-dir'),
      incompleteFilesSuffix: this.pick<boolean>(session, 'rename_partial_files', 'rename-partial-files')
    }
  }

  async setPreferences(patch: Partial<BackendPreferences>): Promise<void> {
    const args: Record<string, unknown> = {}

    // 字段名映射（根据协议版本）
    const keyMapper = (key: string) =>
      this.protocolVersion === 'json-rpc2' ? key : key.replace(/_/g, '-')

    if (patch.maxConnections !== undefined) {
      args[keyMapper('peer_limit_global')] = patch.maxConnections
    }
    if (patch.maxConnectionsPerTorrent !== undefined) {
      args[keyMapper('peer_limit_per_torrent')] = patch.maxConnectionsPerTorrent
    }
    if (patch.queueDownloadEnabled !== undefined) {
      args[keyMapper('download_queue_enabled')] = patch.queueDownloadEnabled
    }
    if (patch.queueDownloadMax !== undefined) {
      args[keyMapper('download_queue_size')] = patch.queueDownloadMax
    }
    if (patch.queueSeedEnabled !== undefined) {
      args[keyMapper('seed_queue_enabled')] = patch.queueSeedEnabled
    }
    if (patch.queueSeedMax !== undefined) {
      args[keyMapper('seed_queue_size')] = patch.queueSeedMax
    }
    if (patch.listenPort !== undefined) {
      args[keyMapper('peer_port')] = patch.listenPort
    }
    if (patch.randomPort !== undefined) {
      args[keyMapper('peer_port_random_on_start')] = patch.randomPort
    }
    if (patch.upnpEnabled !== undefined) {
      args[keyMapper('port_forwarding_enabled')] = patch.upnpEnabled
    }
    if (patch.dhtEnabled !== undefined) {
      args[keyMapper('dht_enabled')] = patch.dhtEnabled
    }
    if (patch.pexEnabled !== undefined) {
      args[keyMapper('pex_enabled')] = patch.pexEnabled
    }
    if (patch.lsdEnabled !== undefined) {
      args[keyMapper('lpd_enabled')] = patch.lsdEnabled
    }
    if (patch.encryption !== undefined) {
      args.encryption = this.unmapEncryptionMode(patch.encryption)
    }

    // Phase 1: 做种限制和队列
    if (patch.shareRatioLimit !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_ratio_limit = patch.shareRatioLimit
      else args.seedRatioLimit = patch.shareRatioLimit
    }
    if (patch.shareRatioLimited !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_ratio_limited = patch.shareRatioLimited
      else args.seedRatioLimited = patch.shareRatioLimited
    }
    if (patch.seedingTimeLimit !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_idle_limit = patch.seedingTimeLimit
      else args.seedIdleLimit = patch.seedingTimeLimit
    }
    if (patch.seedingTimeLimited !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_idle_limited = patch.seedingTimeLimited
      else args.seedIdleLimited = patch.seedingTimeLimited
    }
    if (patch.queueStalledEnabled !== undefined) {
      args[keyMapper('queue_stalled_enabled')] = patch.queueStalledEnabled
    }
    if (patch.queueStalledMinutes !== undefined) {
      args[keyMapper('queue_stalled_minutes')] = patch.queueStalledMinutes
    }

    // Phase 1: 下载路径
    if (patch.savePath !== undefined) {
      args[keyMapper('download_dir')] = patch.savePath
    }
    if (patch.incompleteDirEnabled !== undefined) {
      args[keyMapper('incomplete_dir_enabled')] = patch.incompleteDirEnabled
    }
    if (patch.incompleteDir !== undefined) {
      args[keyMapper('incomplete_dir')] = patch.incompleteDir
    }
    if (patch.incompleteFilesSuffix !== undefined) {
      args[keyMapper('rename_partial_files')] = patch.incompleteFilesSuffix
    }

    if (Object.keys(args).length === 0) return

    await this.rpcCall('session-set', args)
  }

  getCapabilities(): BackendCapabilities {
    return {
      // 队列相关
      hasSeparateSeedQueue: true, // TR 的下载/做种队列是独立的
      hasStalledQueue: true,       // 支持 queue-stalled-minutes

      // 协议相关
      hasLSD: true,                // 支持 LPD（本地发现）
      hasEncryption: true,
      encryptionModes: ['tolerate', 'prefer', 'require'],

      // 做种限制
      hasSeedingRatioLimit: true,  // 支持 seedRatioLimit
      hasSeedingTimeLimit: true,   // 支持 seedIdleLimit
      seedingTimeLimitMode: 'idle',

      // 路径相关
      hasDefaultSavePath: true,    // 支持 download-dir
      hasIncompleteDir: true,      // 支持 incomplete-dir
      hasCreateSubfolder: false,
      hasIncompleteFilesSuffix: true,

      // 高级功能
      hasProxy: false,             // 不支持代理设置
      hasScheduler: false,         // 不支持调度器
      hasIPFilter: false,          // 不支持 IP 过滤
      hasScripts: true,            // 支持脚本系统（script-torrent-done-filename）
      hasBlocklist: true,          // 支持屏蔽列表（blocklist-url）
      hasTrashTorrentFiles: true,  // 支持 trash-original-torrent-files
    }
  }

  private mapEncryptionMode(mode?: string): BackendPreferences['encryption'] {
    if (!mode) return undefined
    const normalized = String(mode).toLowerCase()
    if (normalized === 'required') return 'require'
    if (normalized === 'preferred') return 'prefer'
    if (normalized === 'tolerated') return 'tolerate'
    return 'tolerate'
  }

  private unmapEncryptionMode(mode: BackendPreferences['encryption']): string {
    if (mode === 'require') return 'required'
    if (mode === 'prefer') return 'preferred'
    return 'tolerated'
  }

  private buildIds(hashes: string[]): Record<string, unknown> {
    return hashes.length > 0 ? { ids: hashes } : {}
  }

  async fetchList(): Promise<FetchListResult> {
    const data = await this.rpcCall<{
      torrents: TRTorrent[]
    }>('torrent-get', {
      fields: this.protocolVersion === 'json-rpc2'
        ? [
            'hash_string', 'id', 'name', 'status', 'error', 'error_string',
            'percent_done', 'total_size',
            'rate_download', 'rate_upload',
            'eta', 'upload_ratio',
            'added_date', 'download_dir',
            'labels',
          ]
        : [
            'hashString', 'id', 'name', 'status', 'error', 'errorString',
            'percentDone', 'totalSize',
            'rateDownload', 'rateUpload',
            'eta', 'uploadRatio',
            'addedDate', 'downloadDir',
            'labels',
          ],
    })

    const map = new Map<string, UnifiedTorrent>()
    for (const torrent of data.torrents || []) {
      const hash = this.pick<string>(torrent as any, 'hash_string', 'hashString')
      if (!hash) continue
      map.set(hash, this.normalize(torrent))
    }

    this.currentMap = map

    return {
      torrents: this.currentMap,
      categories: new Map(),
      tags: [],
      serverState: undefined,
    }
  }

  async pause(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-stop', this.buildIds(hashes))
  }

  async resume(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-start', this.buildIds(hashes))
  }

  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    const deleteKey = this.protocolVersion === 'json-rpc2' ? 'delete_local_data' : 'delete-local-data'
    await this.rpcCall('torrent-remove', {
      ...this.buildIds(hashes),
      [deleteKey]: deleteFiles,
    })
  }

  async addTorrent(params: AddTorrentParams): Promise<void> {
    const rpcParams: Record<string, unknown> = {}
    const downloadDirKey = this.protocolVersion === 'json-rpc2' ? 'download_dir' : 'download-dir'

    if (params.paused !== undefined) {
      rpcParams['paused'] = params.paused
    }
    if (params.savepath) {
      rpcParams[downloadDirKey] = params.savepath
    }

    const labels = (params.tags || []).map(t => t.trim()).filter(Boolean)
    const category = params.category?.trim()
    if (category) {
      const filtered = labels.filter(t => t !== category)
      labels.length = 0
      labels.push(category, ...filtered)
    }
    if (labels.length > 0) {
      rpcParams['labels'] = labels
    }

    // 处理 URL（magnet 和 HTTP URL 都用 filename 参数）
    if (params.urls?.trim()) {
      const urls = params.urls.trim().split('\n').filter((u: string) => u)
      for (const url of urls) {
        await this.rpcCall('torrent-add', {
          ...rpcParams,
          filename: url,
        })
      }
    }

    // 处理 .torrent 文件
    if (params.files?.length) {
      for (const file of params.files) {
        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

        await this.rpcCall('torrent-add', {
          ...rpcParams,
          metainfo: base64,
        })
      }
    }
  }

  // 登录认证（Transmission 使用 HTTP Basic Auth）
  async login(username: string, password: string): Promise<void> {
    transClient.defaults.auth = { username, password }

    // 验证凭证有效性
    await this.rpcCall('session-get')
  }

  // 登出
  async logout(): Promise<void> {
    transClient.defaults.auth = undefined
  }

  // 静默验证 session
  async checkSession(): Promise<boolean> {
    if (!transClient.defaults.auth) return false
    try {
      await this.rpcCall('session-get')
      return true
    } catch {
      return false
    }
  }

  // 获取种子详情
  async fetchDetail(hash: string): Promise<UnifiedTorrentDetail> {
    const data = await this.rpcCall<{
      torrents: TRTorrent[]
    }>('torrent-get', {
      ids: [hash],
      fields: this.protocolVersion === 'json-rpc2'
        ? [
            'hash_string', 'name',
            'total_size',
            'downloaded_ever', 'uploaded_ever',
            'download_limit', 'download_limited',
            'upload_limit', 'upload_limited',
            'seconds_seeding',
            'added_date', 'done_date',
            'download_dir',
            'labels',
            'peers_connected',
            'peers_getting_from_us',
            'peers_sending_to_us',
            'files',
            'trackers',
            'tracker_stats',
            'peers',
            'priorities',
            'wanted',
          ]
        : [
            'hashString', 'name',
            'totalSize',
            'downloadedEver', 'uploadedEver',
            'downloadLimit', 'downloadLimited',
            'uploadLimit', 'uploadLimited',
            'secondsSeeding',
            'addedDate', 'doneDate',
            'downloadDir',
            'labels',
            'peersConnected',
            'peersGettingFromUs',
            'peersSendingToUs',
            'files',
            'trackers',
            'trackerStats',
            'peers',
            'priorities',
            'wanted',
          ],
    })

    const torrent = data.torrents?.[0]
    if (!torrent) {
      throw new Error('Torrent not found')
    }

    const trackerStats = torrent.tracker_stats || torrent.trackerStats || []

    // 从 tracker_stats 聚合 Swarm 统计
    let totalSeeds = 0
    let totalLeechers = 0

    for (const stat of trackerStats) {
      totalSeeds += this.pick<number>(stat as any, 'seeder_count', 'seederCount') ?? 0
      totalLeechers += this.pick<number>(stat as any, 'leecher_count', 'leecherCount') ?? 0
    }

    const files: TorrentFile[] = (torrent.files || []).map((f, idx) => {
      const priorityNum = torrent.priorities?.[idx] ?? 0
      const wantedRaw = torrent.wanted?.[idx]
      const wanted = wantedRaw === undefined ? true : Boolean(wantedRaw)

      let priority: TorrentFile['priority'] = 'normal'
      if (!wanted) {
        priority = 'do_not_download'
      } else if (priorityNum === 1) {
        priority = 'high'
      } else if (priorityNum === -1) {
        priority = 'low'
      }

      const completedBytes = this.pick<number>(f as any, 'bytes_completed', 'bytesCompleted') ?? 0
      const length = f.length || 0

      return {
        id: idx,
        name: f.name,
        size: length,
        progress: length > 0 ? completedBytes / length : 0,
        priority,
      }
    })

    const trackers: Tracker[] = (torrent.trackers || []).map((t, i) => {
      const stat = trackerStats[i]
      return this.mapTracker(t, stat)
    })

    const peers: Peer[] = (torrent.peers || []).map(p => ({
      ip: p.address,
      port: p.port,
      client: this.pick<string>(p as any, 'client_name', 'clientName') || '',
      progress: p.progress || 0,
      dlSpeed: this.pick<number>(p as any, 'rate_to_client', 'rateToClient') || 0,
      upSpeed: this.pick<number>(p as any, 'rate_to_peer', 'rateToPeer') || 0,
      downloaded: 0,
      uploaded: 0,
    }))

    const dlLimited = this.pick<boolean>(torrent as any, 'download_limited', 'downloadLimited') ?? false
    const dlLimitKb = this.pick<number>(torrent as any, 'download_limit', 'downloadLimit') ?? 0
    const upLimited = this.pick<boolean>(torrent as any, 'upload_limited', 'uploadLimited') ?? false
    const upLimitKb = this.pick<number>(torrent as any, 'upload_limit', 'uploadLimit') ?? 0

    return {
      hash: this.pick<string>(torrent as any, 'hash_string', 'hashString') || hash,
      name: torrent.name || '',
      size: this.pick<number>(torrent as any, 'total_size', 'totalSize') ?? 0,
      completed: this.pick<number>(torrent as any, 'downloaded_ever', 'downloadedEver') ?? 0,
      uploaded: this.pick<number>(torrent as any, 'uploaded_ever', 'uploadedEver') ?? 0,
      dlLimit: dlLimited ? dlLimitKb * 1024 : -1,
      upLimit: upLimited ? upLimitKb * 1024 : -1,
      seedingTime: this.pick<number>(torrent as any, 'seconds_seeding', 'secondsSeeding') ?? 0,
      addedTime: this.pick<number>(torrent as any, 'added_date', 'addedDate') ?? 0,
      completionOn: this.pick<number>(torrent as any, 'done_date', 'doneDate') ?? 0,
      savePath: this.pick<string>(torrent as any, 'download_dir', 'downloadDir') ?? '',
      category: torrent.labels?.[0] || '',
      tags: torrent.labels || [],
      connections: this.pick<number>(torrent as any, 'peers_connected', 'peersConnected') || 0,
      numSeeds: totalSeeds,
      numLeechers: totalLeechers,
      totalSeeds,
      totalLeechers,
      files,
      trackers,
      peers,
    }
  }

  // ========== 种子操作 ==========

  async recheck(hash: string): Promise<void> {
    await this.rpcCall('torrent-verify', { ids: [hash] })
  }

  async recheckBatch(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-verify', this.buildIds(hashes))
  }

  async reannounce(hash: string): Promise<void> {
    await this.rpcCall('torrent-reannounce', { ids: [hash] })
  }

  async reannounceBatch(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-reannounce', this.buildIds(hashes))
  }

  async forceStart(hash: string, value: boolean): Promise<void> {
    await this.rpcCall(value ? 'torrent-start-now' : 'torrent-start', { ids: [hash] })
  }

  async forceStartBatch(hashes: string[], value: boolean): Promise<void> {
    await this.rpcCall(value ? 'torrent-start-now' : 'torrent-start', this.buildIds(hashes))
  }

  async setDownloadLimit(hash: string, limit: number): Promise<void> {
    await this.setDownloadLimitBatch([hash], limit)
  }

  async setDownloadLimitBatch(hashes: string[], limit: number): Promise<void> {
    const limited = limit > 0
    const kbLimit = limited ? Math.max(1, Math.round(limit / 1024)) : 0
    const limitedKey = this.protocolVersion === 'json-rpc2' ? 'download_limited' : 'downloadLimited'
    const limitKey = this.protocolVersion === 'json-rpc2' ? 'download_limit' : 'downloadLimit'
    await this.rpcCall('torrent-set', {
      ...this.buildIds(hashes),
      [limitedKey]: limited,
      [limitKey]: kbLimit,
    })
  }

  async setUploadLimit(hash: string, limit: number): Promise<void> {
    await this.setUploadLimitBatch([hash], limit)
  }

  async setUploadLimitBatch(hashes: string[], limit: number): Promise<void> {
    const limited = limit > 0
    const kbLimit = limited ? Math.max(1, Math.round(limit / 1024)) : 0
    const limitedKey = this.protocolVersion === 'json-rpc2' ? 'upload_limited' : 'uploadLimited'
    const limitKey = this.protocolVersion === 'json-rpc2' ? 'upload_limit' : 'uploadLimit'
    await this.rpcCall('torrent-set', {
      ...this.buildIds(hashes),
      [limitedKey]: limited,
      [limitKey]: kbLimit,
    })
  }

  async setLocation(hash: string, location: string): Promise<void> {
    await this.rpcCall('torrent-set-location', {
      ids: [hash],
      location,
      move: true,
    })
  }

  async setCategory(hash: string, category: string): Promise<void> {
    await this.setCategoryBatch([hash], category)
  }

  async setCategoryBatch(hashes: string[], category: string): Promise<void> {
    const data = await this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
      ...this.buildIds(hashes),
      fields: this.protocolVersion === 'json-rpc2' ? ['hash_string', 'labels'] : ['hashString', 'labels'],
    })

    // 批量更新：保留其他 labels，只替换第一个
    for (const torrent of data.torrents || []) {
      const torrentHash = this.pick<string>(torrent as any, 'hash_string', 'hashString')
      if (!torrentHash) continue

      const existingLabels = torrent.labels || []
      const newLabels = category
        ? [category, ...existingLabels.slice(1)]
        : existingLabels.slice(1)

      await this.rpcCall('torrent-set', {
        ids: [torrentHash],
        labels: newLabels,
      })
    }
  }

  async setTags(hash: string, tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    await this.setTagsBatch([hash], tags, mode)
  }

  async setTagsBatch(hashes: string[], tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    const sanitized = tags.map(t => t.trim()).filter(Boolean)

    if (mode === 'set') {
      await this.rpcCall('torrent-set', { ...this.buildIds(hashes), labels: sanitized })
      return
    }

    // add/remove 模式需要先获取当前 labels
    const data = await this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
      ...this.buildIds(hashes),
      fields: this.protocolVersion === 'json-rpc2' ? ['hash_string', 'labels'] : ['hashString', 'labels'],
    })

    const target = new Set(sanitized)

    for (const torrent of data.torrents || []) {
      const torrentHash = this.pick<string>(torrent as any, 'hash_string', 'hashString')
      if (!torrentHash) continue

      const current = new Set(torrent.labels || [])

      const newLabels = mode === 'add'
        ? Array.from(new Set([...current, ...target]))
        : Array.from(current).filter(t => !target.has(t))

      await this.rpcCall('torrent-set', {
        ids: [torrentHash],
        labels: newLabels,
      })
    }
  }

  async setFilePriority(
    hash: string,
    fileIds: number[],
    priority: 'high' | 'normal' | 'low' | 'do_not_download'
  ): Promise<void> {
    const filesUnwantedKey = this.protocolVersion === 'json-rpc2' ? 'files_unwanted' : 'files-unwanted'
    const filesWantedKey = this.protocolVersion === 'json-rpc2' ? 'files_wanted' : 'files-wanted'
    const priorityKey = (value: 'high' | 'normal' | 'low') => {
      if (this.protocolVersion === 'json-rpc2') return `priority_${value}`
      return `priority-${value}`
    }

    if (priority === 'do_not_download') {
      await this.rpcCall('torrent-set', {
        ids: [hash],
        [filesUnwantedKey]: fileIds,
      })
      return
    }

    // Transmission priority: low=-1, normal=0, high=1
    await this.rpcCall('torrent-set', {
      ids: [hash],
      [filesWantedKey]: fileIds,
      [priorityKey(priority)]: fileIds,
    })
  }

  // ========== 分类管理 ==========

  async getCategories(): Promise<Map<string, Category>> {
    // Transmission 不支持独立的分类管理
    return new Map()
  }

  async createCategory(_name: string, _savePath?: string): Promise<void> {
    throw new Error('Transmission 不支持创建分类（labels）')
  }

  async editCategory(_name: string, _newName?: string, _savePath?: string): Promise<void> {
    throw new Error('Transmission 不支持编辑分类（labels）')
  }

  async deleteCategories(..._names: string[]): Promise<void> {
    throw new Error('Transmission 不支持删除分类（labels）')
  }

  async setCategorySavePath(_category: string, _savePath: string): Promise<void> {
    throw new Error('Transmission 不支持设置分类保存路径')
  }

  // ========== 标签管理 ==========

  async getTags(): Promise<string[]> {
    // 从所有种子中聚合 labels
    const data = await this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
      fields: ['labels']
    })

    const labels = new Set<string>()
    for (const torrent of data.torrents || []) {
      for (const label of torrent.labels || []) {
        labels.add(label)
      }
    }

    return Array.from(labels)
  }

  async createTags(..._tags: string[]): Promise<void> {
    throw new Error('Transmission 不支持预创建标签（labels 随种子自动创建）')
  }

  async deleteTags(..._tags: string[]): Promise<void> {
    throw new Error('Transmission 不支持删除标签（labels 仅通过 setTags 移除）')
  }
}
