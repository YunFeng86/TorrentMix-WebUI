import type { UnifiedTorrent } from './types'

/**
 * 添加种子参数
 */
export interface AddTorrentParams {
  /** Magnet 链接或 HTTP URL（多个用换行分隔） */
  urls?: string
  /** .torrent 文件 */
  files?: File[]
  /** 保存路径（可选） */
  savepath?: string
  /** 分类（可选） */
  category?: string
  /** 标签（可选） */
  tags?: string[]
  /** 添加后暂停（默认 false）*/
  paused?: boolean
  /** 种子哈希（用于跳过重复检测，可选）*/
  skip_checking?: boolean
}

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
   * 添加种子
   * @param params - 添加种子参数
   */
  addTorrent(params: AddTorrentParams): Promise<void>

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

  /**
   * 登录认证
   * @param username - 用户名
   * @param password - 密码
   */
  login(username: string, password: string): Promise<void>

  /**
   * 登出
   */
  logout(): Promise<void>

  /**
   * 静默验证当前 session 是否有效
   * @returns true 表示已认证，false 表示需要登录
   */
  checkSession(): Promise<boolean>
}
