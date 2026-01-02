import type { UnifiedTorrent } from './types'

/**
 * BaseAdapter 接口 - 定义所有后端适配器必须实现的方法
 *
 * 设计原则：
 * - 方法签名归一化，屏蔽 qBittorrent 和 Transmission 的 API 差异
 * - 所有返回数据使用 UnifiedTorrent 统一格式
 * - 速度单位统一为 bytes/s（raw number），不在此层做字符串格式化
 */
export interface BaseAdapter {
  /**
   * 获取种子列表
   * @returns Map<string, UnifiedTorrent> - key 为种子 id
   */
  fetchList(): Promise<Map<string, UnifiedTorrent>>

  /**
   * 暂停种子
   * @param hashes - 种子 id 数组，空数组表示暂停所有
   */
  pause(hashes: string[]): Promise<void>

  /**
   * 恢复种子
   * @param hashes - 种子 id 数组，空数组表示恢复所有
   */
  resume(hashes: string[]): Promise<void>

  /**
   * 删除种子
   * @param hashes - 种子 id 数组，空数组表示删除所有
   * @param deleteFiles - 是否同时删除下载文件
   */
  delete(hashes: string[], deleteFiles: boolean): Promise<void>
}
