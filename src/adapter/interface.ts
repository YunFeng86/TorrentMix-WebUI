import type { UnifiedTorrent, Category, ServerState, UnifiedTorrentDetail } from './types'

/**
 * fetchList 返回结果包装
 */
export interface FetchListResult {
  /** 种子列表 */
  torrents: Map<string, UnifiedTorrent>
  /** 分类列表（可选，后端可能不支持） */
  categories?: Map<string, Category>
  /** 标签列表（可选，后端可能不支持） */
  tags?: string[]
  /** 服务器状态（可选，阶段 5 使用） */
  serverState?: ServerState
}

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
   * @returns FetchListResult - 包含种子列表、分类、标签等
   */
  fetchList(): Promise<FetchListResult>

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

  /**
   * 获取种子详情（按需加载）
   * @param hash - 种子 hash/id
   * @returns 种子详情，包含文件列表、Trackers、Peers 等
   */
  fetchDetail(hash: string): Promise<UnifiedTorrentDetail>

  /**
   * 重新校验种子
   * @param hash - 种子 hash/id
   */
  recheck(hash: string): Promise<void>

  /**
   * 重新汇报（向 tracker 重新 announce）
   * @param hash - 种子 hash/id
   */
  reannounce(hash: string): Promise<void>

  /**
   * 强制开始/取消强制开始
   * @param hash - 种子 hash/id
   * @param value - true 强制开始，false 取消强制
   */
  forceStart(hash: string, value: boolean): Promise<void>

  /**
   * 设置下载限速
   * @param hash - 种子 hash/id
   * @param limit - 限速值（bytes/s），-1 表示无限制
   */
  setDownloadLimit(hash: string, limit: number): Promise<void>

  /**
   * 设置上传限速
   * @param hash - 种子 hash/id
   * @param limit - 限速值（bytes/s），-1 表示无限制
   */
  setUploadLimit(hash: string, limit: number): Promise<void>

  /**
   * 设置保存位置
   * @param hash - 种子 hash/id
   * @param location - 新的保存路径
   */
  setLocation(hash: string, location: string): Promise<void>

  /**
   * 设置分类
   * @param hash - 种子 hash/id
   * @param category - 分类名称，空字符串表示移除分类
   */
  setCategory(hash: string, category: string): Promise<void>

  /**
   * 设置标签
   * @param hash - 种子 hash/id
   * @param tags - 标签数组
   * @param mode - 'set' 替换, 'add' 添加, 'remove' 移除
   */
  setTags(hash: string, tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void>

  /**
   * 设置文件优先级
   * @param hash - 种子 hash/id
   * @param fileIds - 文件 id 数组
   * @param priority - 'high' | 'normal' | 'low' | 'do_not_download'
   */
  setFilePriority(hash: string, fileIds: number[], priority: 'high' | 'normal' | 'low' | 'do_not_download'): Promise<void>
}
