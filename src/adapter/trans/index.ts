import { transClient } from '@/api/trans-client'
import type { BaseAdapter, AddTorrentParams, FetchListResult } from '../interface'
import type { UnifiedTorrent, TorrentState, UnifiedTorrentDetail, TorrentFile, Tracker, Peer } from '../types'

/**
 * Transmission RPC 请求体
 */
interface TRRequest {
  method: string
  arguments?: Record<string, unknown>
  tag?: number
}

/**
 * Transmission RPC 响应
 */
interface TRResponse {
  result: 'success' | string
  arguments?: Record<string, unknown>
  tag?: number
}

/**
 * Transmission 种子对象
 */
interface TRTorrent {
  id: number
  name: string
  status: number
  progress: number
  totalSize: number
  rateDownload: number
  rateUpload: number
  eta: number
  uploadRatio: number
  addedDate: number
  downloadDir: string
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
  0: 'paused',      // stopped
  1: 'queued',      // check wait
  2: 'checking',    // checking
  3: 'queued',      // download wait
  4: 'downloading', // downloading
  5: 'queued',      // seed wait
  6: 'seeding'      // seeding
}

/**
 * Transmission 适配器
 *
 * 实现要点：
 * - id 是数字，需要转换为 string 以匹配 UnifiedTorrent.id
 * - 进度是百分比 (0-100)，需要转换为 (0-1)
 * - 状态用数字枚举，需要映射到 TorrentState
 */
export class TransAdapter implements BaseAdapter {
  private currentMap = new Map<string, UnifiedTorrent>()

  async fetchList(): Promise<FetchListResult> {
    const payload: TRRequest = {
      method: 'torrent-get',
      arguments: {
        fields: [
          'id', 'name', 'status', 'progress',
          'totalSize', 'rateDownload', 'rateUpload',
          'eta', 'uploadRatio', 'addedDate', 'downloadDir'
        ]
      }
    }

    const { data } = await transClient.post<TRResponse>('', payload)

    if (data.result !== 'success') {
      throw new Error(`Transmission RPC error: ${data.result}`)
    }

    const torrents = (data.arguments?.torrents as TRTorrent[]) || []
    const map = new Map<string, UnifiedTorrent>()

    for (const torrent of torrents) {
      map.set(String(torrent.id), this.normalize(torrent))
    }

    this.currentMap = map

    // Transmission 不支持分类和标签，返回空值
    return {
      torrents: this.currentMap,
      categories: new Map(),  // TR 不支持分类
      tags: [],               // TR 不支持标签（可用 labels 替代，暂不实现）
      serverState: undefined  // 暂不实现 TR 的 server state
    }
  }

  async pause(hashes: string[]): Promise<void> {
    const ids = hashes.map(h => parseInt(h, 10))
    const payload: TRRequest = {
      method: 'torrent-stop',
      arguments: { ids: ids.length > 0 ? ids : 'all' }
    }
    await transClient.post('', payload)
  }

  async resume(hashes: string[]): Promise<void> {
    const ids = hashes.map(h => parseInt(h, 10))
    const payload: TRRequest = {
      method: 'torrent-start',
      arguments: { ids: ids.length > 0 ? ids : 'all' }
    }
    await transClient.post('', payload)
  }

  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    const ids = hashes.map(h => parseInt(h, 10))
    const payload: TRRequest = {
      method: 'torrent-remove',
      arguments: {
        ids: ids.length > 0 ? ids : 'all',
        'delete-local-data': deleteFiles
      }
    }
    await transClient.post('', payload)
  }

  async addTorrent(params: AddTorrentParams): Promise<void> {
    // Transmission 支持 magnet 和 .torrent 文件（需要 base64 编码）
    const args: Record<string, unknown> = {}

    if (params.paused !== undefined) {
      args['paused'] = params.paused
    }
    if (params.savepath) {
      args['download-dir'] = params.savepath
    }

    // 处理 magnet 链接
    if (params.urls?.trim()) {
      const urls = params.urls.trim().split('\n').filter((u: string) => u)
      for (const url of urls) {
        if (url.startsWith('magnet:')) {
          args['filename'] = url
          const payload: TRRequest = {
            method: 'torrent-add',
            arguments: args
          }
          await transClient.post('', payload)
        }
      }
    }

    // 处理 .torrent 文件（需要读取并转为 base64）
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
        args['metainfo'] = base64

        const payload: TRRequest = {
          method: 'torrent-add',
          arguments: { ...args }
        }
        await transClient.post('', payload)
      }
    }
  }

  // 登录认证（Transmission 使用 HTTP Basic Auth）
  async login(username: string, password: string): Promise<void> {
    transClient.defaults.auth = { username, password }

    // 验证凭证有效性
    const { data } = await transClient.post<TRResponse>('', { method: 'session-get' })
    if (data.result !== 'success') {
      transClient.defaults.auth = undefined
      throw new Error('认证失败')
    }
  }

  // 登出
  async logout(): Promise<void> {
    transClient.defaults.auth = undefined
  }

  // 静默验证 session
  async checkSession(): Promise<boolean> {
    if (!transClient.defaults.auth) return false
    try {
      const { data } = await transClient.post<TRResponse>('', { method: 'session-get' })
      return data.result === 'success'
    } catch {
      return false
    }
  }

  /**
   * 归一化：Transmission → UnifiedTorrent
   */
  private normalize(raw: TRTorrent): UnifiedTorrent {
    return {
      id: String(raw.id),               // TR 的 id 是数字，转为 string
      name: raw.name,
      state: STATE_MAP[raw.status] || 'error',
      progress: raw.progress / 100,     // TR 是 0-100，转为 0-1
      size: raw.totalSize,
      dlspeed: raw.rateDownload,
      upspeed: raw.rateUpload,
      eta: raw.eta === -1 ? -1 : raw.eta,  // TR 的 -1 表示无限
      ratio: raw.uploadRatio,
      addedTime: raw.addedDate,
      savePath: raw.downloadDir
    }
  }

  // 获取种子详情（Transmission 版本）
  async fetchDetail(hash: string): Promise<UnifiedTorrentDetail> {
    const id = parseInt(hash, 10)
    const payload: TRRequest = {
      method: 'torrent-get',
      arguments: {
        ids: id,
        fields: [
          'hashString', 'name', 'totalSize', 'downloadedEver', 'uploadedEver',
          'downloadLimit', 'uploadLimit', 'secondsSeeding', 'addedDate', 'doneDate',
          'downloadDir', 'priority', 'labels',
          'speedLimitDown', 'speedLimitUp',
          'peersConnected', 'peersGettingFromUs', 'peersSendingToUs',
          'files', 'trackers', 'peers'
        ]
      }
    }

    const { data } = await transClient.post<TRResponse>('', payload)

    const torrents = data.arguments?.torrents as unknown[] | undefined
    if (data.result !== 'success' || !torrents || torrents.length === 0) {
      throw new Error(`Failed to fetch torrent details: ${data.result}`)
    }

    const torrent = torrents[0] as any
    const files: TorrentFile[] = (torrent.files || []).map((f: any, idx: number) => ({
      id: idx,
      name: f.name,
      size: f.length,
      progress: f.bytesCompleted / f.length,
      priority: 'normal' as const  // TR 的 priority 在 'priority' 字段，简化处理
    }))

    const trackers: Tracker[] = (torrent.trackers || []).map((t: any) => ({
      url: t.announce,
      status: 'working' as const,  // TR 没有 tracker status 字段，简化处理
      msg: '',
      peers: 0,
      tier: t.tier || 0
    }))

    const peers: Peer[] = (torrent.peers || []).map((p: any) => ({
      ip: p.address,
      port: p.port,
      client: p.clientName || '',
      progress: p.progress,
      dlSpeed: p.rateToClient || 0,
      upSpeed: p.rateToPeer || 0,
      downloaded: 0,
      uploaded: 0
    }))

    return {
      hash: torrent.hashString,
      name: torrent.name,
      size: torrent.totalSize,
      completed: torrent.downloadedEver || 0,
      uploaded: torrent.uploadedEver || 0,
      dlLimit: torrent.downloadLimit || -1,
      upLimit: torrent.uploadLimit || -1,
      seedingTime: torrent.secondsSeeding || 0,
      addedTime: torrent.addedDate,
      completionOn: torrent.doneDate || 0,
      savePath: torrent.downloadDir,
      category: torrent.labels?.[0] || '',
      tags: torrent.labels || [],
      connections: torrent.peersConnected || 0,
      numSeeds: torrent.peersSendingToUs || 0,
      numLeechers: torrent.peersGettingFromUs || 0,
      files,
      trackers,
      peers
    }
  }

  // ========== 阶段 3: 新增种子操作 ==========

  // 重新校验
  async recheck(hash: string): Promise<void> {
    const id = parseInt(hash, 10)
    await transClient.post('', {
      method: 'torrent-verify',
      arguments: { ids: id }
    })
  }

  // 重新汇报（Transmission 不支持，空操作）
  async reannounce(): Promise<void> {
    // Transmission 没有等效的 reannounce API，保持空实现
  }

  // 强制开始（使用 torrent-start-now）
  async forceStart(hash: string): Promise<void> {
    const id = parseInt(hash, 10)
    await transClient.post('', {
      method: 'torrent-start-now',
      arguments: { ids: id }
    })
  }

  // 设置下载限速
  async setDownloadLimit(hash: string, limit: number): Promise<void> {
    const id = parseInt(hash, 10)
    await transClient.post('', {
      method: 'torrent-set',
      arguments: {
        ids: id,
        downloadLimit: limit < 0 ? -1 : limit  // -1 表示无限制
      }
    })
  }

  // 设置上传限速
  async setUploadLimit(hash: string, limit: number): Promise<void> {
    const id = parseInt(hash, 10)
    await transClient.post('', {
      method: 'torrent-set',
      arguments: {
        ids: id,
        uploadLimit: limit < 0 ? -1 : limit  // -1 表示无限制
      }
    })
  }

  // 设置保存位置
  async setLocation(hash: string, location: string): Promise<void> {
    const id = parseInt(hash, 10)
    await transClient.post('', {
      method: 'torrent-set',
      arguments: {
        ids: id,
        'download-dir': location
      }
    })
  }

  // 设置分类（Transmission 用 labels 替代）
  async setCategory(hash: string, category: string): Promise<void> {
    const id = parseInt(hash, 10)
    // Transmission 使用 labels，先清除现有 labels，再设置新的
    if (category) {
      await transClient.post('', {
        method: 'torrent-set',
        arguments: {
          ids: id,
          labels: [category]
        }
      })
    } else {
      // 清空 labels
      await transClient.post('', {
        method: 'torrent-set',
        arguments: {
          ids: id,
          labels: []
        }
      })
    }
  }

  // 设置标签（Transmission 用 labels 替代）
  async setTags(hash: string, tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    const id = parseInt(hash, 10)

    // Transmission 的 labels 操作比较简单，这里只实现 set 模式
    // add/remove 模式需要先获取现有 labels 再修改，暂不实现
    if (mode === 'set') {
      await transClient.post('', {
        method: 'torrent-set',
        arguments: {
          ids: id,
          labels: tags
        }
      })
    }
    // add/remove 模式暂不支持
  }

  // 设置文件优先级（Transmission 只有 3 级：high/normal/low）
  async setFilePriority(hash: string, fileIds: number[], priority: 'high' | 'normal' | 'low' | 'do_not_download'): Promise<void> {
    const id = parseInt(hash, 10)

    // Transmission priority-low: -1, priority-normal: 0, priority-high: 1
    // do_not_download 通过 'files-unwanted' 实现
    let priorityField = 'priority-normal'
    if (priority === 'high') priorityField = 'priority-high'
    else if (priority === 'low') priorityField = 'priority-low'
    else if (priority === 'do_not_download') {
      // 不下载
      await transClient.post('', {
        method: 'torrent-set',
        arguments: {
          ids: id,
          'files-unwanted': fileIds
        }
      })
      return
    }

    // 设置优先级
    await transClient.post('', {
      method: 'torrent-set',
      arguments: {
        ids: id,
        [priorityField]: fileIds
      }
    })
  }
}
