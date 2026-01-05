import { apiClient } from '@/api/client'
import { QbitBaseAdapter } from './base'
import type { QbitFeatures } from '../detect'

/**
 * qBittorrent 统一适配器
 * 通过特性标志支持 v4-v5 所有版本，消除代码重复
 */
export class QbitAdapter extends QbitBaseAdapter {
  protected features: QbitFeatures

  constructor(features: QbitFeatures) {
    super()
    this.features = features
  }

  // ========== 基础操作（统一实现）==========

  async pause(hashes: string[]): Promise<void> {
    const endpoint = `/api/v2/torrents/${this.features.pauseEndpoint}`
    const params = new URLSearchParams()
    params.append('hashes', hashes.join('|') || 'all')
    await apiClient.post(endpoint, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  }

  async resume(hashes: string[]): Promise<void> {
    const endpoint = `/api/v2/torrents/${this.features.resumeEndpoint}`
    const params = new URLSearchParams()
    params.append('hashes', hashes.join('|') || 'all')
    await apiClient.post(endpoint, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  }

  // ========== v5 新增功能（带特性检测）==========

  /**
   * 重命名种子（WebAPI v2.8.0+）
   * 不支持时静默失败并打印警告
   */
  async renameTorrent(hash: string, newName: string): Promise<void> {
    if (!this.features.hasTorrentRename) {
      console.warn('[QbitAdapter] Torrent rename not supported on this version')
      return
    }

    try {
      const params = new URLSearchParams()
      params.append('hash', hash)
      params.append('name', newName)
      await apiClient.post('/api/v2/torrents/rename', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch (error: any) {
      const status = error.response?.status
      if (status === 404 || status === 405) {
        console.warn('[QbitAdapter] Rename endpoint returned', status, '- feature may not be supported')
        return
      }
      throw error
    }
  }

  /**
   * 重命名文件（WebAPI v2.8.2+）
   */
  async renameFile(hash: string, oldPath: string, newPath: string): Promise<void> {
    if (!this.features.hasFileRename) {
      console.warn('[QbitAdapter] File rename not supported on this version')
      return
    }

    try {
      const params = new URLSearchParams()
      params.append('hash', hash)
      params.append('oldPath', oldPath)
      params.append('newPath', newPath)
      await apiClient.post('/api/v2/torrents/renameFile', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch (error: any) {
      const status = error.response?.status
      if (status === 404 || status === 405) {
        console.warn('[QbitAdapter] RenameFile endpoint returned', status)
        return
      }
      throw error
    }
  }

  /**
   * 重命名文件夹（WebAPI v2.8.2+）
   */
  async renameFolder(hash: string, oldPath: string, newPath: string): Promise<void> {
    if (!this.features.hasFileRename) {
      console.warn('[QbitAdapter] Folder rename not supported on this version')
      return
    }

    try {
      const params = new URLSearchParams()
      params.append('hash', hash)
      params.append('oldPath', oldPath)
      params.append('newPath', newPath)
      await apiClient.post('/api/v2/torrents/renameFolder', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch (error: any) {
      const status = error.response?.status
      if (status === 404 || status === 405) {
        console.warn('[QbitAdapter] RenameFolder endpoint returned', status)
        return
      }
      throw error
    }
  }
}

/**
 * 默认 qBittorrent 特性配置
 * 用于登录前创建适配器（保守策略，所有新特性关闭）
 */
export const DEFAULT_QBIT_FEATURES: QbitFeatures = {
  pauseEndpoint: 'pause',
  resumeEndpoint: 'resume',
  hasTorrentRename: false,
  hasFileRename: false,
  hasReannounceField: false,
  hasShareLimit: false,
  isLegacy: true,
}
