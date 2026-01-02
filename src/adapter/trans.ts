import { transClient } from '@/api/trans-client'
import type { BaseAdapter, AddTorrentParams } from './interface'
import type { UnifiedTorrent, TorrentState } from './types'

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

  async fetchList(): Promise<Map<string, UnifiedTorrent>> {
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
    return this.currentMap
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
      const urls = params.urls.trim().split('\n').filter(u => u)
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
}
