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
  /** 跳过校验（可选）*/
  skip_checking?: boolean
}

/**
 * 传输设置（用于 qB/TR 的全局限速与备用限速）
 *
 * 约定：
 * - 所有速度单位为 bytes/s
 * - 0 表示不限制
 */
export interface TransferSettings {
  downloadLimit: number
  uploadLimit: number
  altEnabled: boolean
  altDownloadLimit: number
  altUploadLimit: number
  /**
   * 是否为“部分读取成功”的结果（例如 speedLimitsMode/preferences 被 403/404/反代拦截）。
   * 用于 UI 提示：当前显示值可能是 fallback/default，并不代表后端真实配置。
   */
  partial?: boolean
}

/**
 * 后端能力标记（用于 UI 动态显示不同后端的设置项）
 */
export interface BackendCapabilities {
  // ========== 队列相关 ==========
  /** 是否支持独立的做种队列（qB: false, TR: true） */
  hasSeparateSeedQueue: boolean
  /** 是否支持队列停滞检测 */
  hasStalledQueue: boolean

  // ========== 协议相关 ==========
  /** 是否支持本地发现（qB: LSD / TR: LPD） */
  hasLSD: boolean
  /** 是否支持加密模式设置 */
  hasEncryption: boolean
  /** 支持的加密模式选项 */
  encryptionModes: Array<'tolerate' | 'prefer' | 'require' | 'disable'>

  // ========== 做种限制 ==========
  /** 是否支持分享率限制 */
  hasSeedingRatioLimit: boolean
  /** 是否支持做种时间/空闲限制 */
  hasSeedingTimeLimit: boolean
  /**
   * 做种时间限制语义
   * - duration: 做种总时长（qB: max_seeding_time）
   * - idle: 做种空闲时长（TR: seedIdleLimit）
   */
  seedingTimeLimitMode: 'duration' | 'idle'

  // ========== 路径相关 ==========
  /** 是否支持设置默认保存路径 */
  hasDefaultSavePath: boolean
  /** 是否支持设置未完成下载目录 */
  hasIncompleteDir: boolean
  /** 是否支持“创建子文件夹”选项（qB: create_subfolder_enabled） */
  hasCreateSubfolder: boolean
  /** 是否支持“未完成文件后缀”选项（qB: .!qB / TR: .part） */
  hasIncompleteFilesSuffix: boolean

  // ========== 高级功能（Phase 2） ==========
  /** 是否支持代理设置（qB 专属） */
  hasProxy: boolean
  /** 是否支持调度器（qB 专属） */
  hasScheduler: boolean
  /** 是否支持 IP 过滤（qB 专属） */
  hasIPFilter: boolean
  /** 是否支持脚本系统（TR 专属） */
  hasScripts: boolean
  /** 是否支持屏蔽列表（TR 专属） */
  hasBlocklist: boolean
  /** 是否支持“移除 .torrent 文件”（TR: trash-original-torrent-files） */
  hasTrashTorrentFiles: boolean
}

/**
 * 后端应用偏好设置（归一化接口）
 *
 * 设计原则：
 * - 字段命名使用 camelCase（TypeScript 约定）
 * - 速度单位统一为 bytes/s（由 Adapter 层处理）
 * - 布尔值明确语义（enable/disable）
 * - 所有字段可选（取决于后端类型和版本）
 */
export interface BackendPreferences {
  // ========== 连接设置 ==========
  /** 全局最大连接数 */
  maxConnections?: number
  /** 单种子最大连接数 */
  maxConnectionsPerTorrent?: number

  // ========== 队列设置 ==========
  /** 是否启用下载队列 */
  queueDownloadEnabled?: boolean
  /** 同时下载数 */
  queueDownloadMax?: number
  /** 是否启用做种队列 */
  queueSeedEnabled?: boolean
  /** 同时做种数 */
  queueSeedMax?: number

  // ========== 端口设置 ==========
  /** 监听端口 */
  listenPort?: number
  /** 是否使用随机端口 */
  randomPort?: boolean
  /** 是否启用 UPnP 端口映射 */
  upnpEnabled?: boolean

  // ========== 协议设置（按后端支持情况） ==========
  /** 是否启用 DHT */
  dhtEnabled?: boolean
  /** 是否启用 PeX */
  pexEnabled?: boolean
  /** 是否启用 LSD */
  lsdEnabled?: boolean
  /**
   * 加密模式
   * - tolerate: 宽容（TR: tolerated）
   * - prefer: 优先加密（允许回退）
   * - require: 强制加密
   * - disable: 禁用加密
   */
  encryption?: 'tolerate' | 'prefer' | 'require' | 'disable'

  // ========== 代理设置（qB 专属） ==========
  proxy?: {
    /** 代理类型 */
    type?: 'none' | 'http' | 'socks4' | 'socks5'
    /** 代理主机 */
    host?: string
    /** 代理端口 */
    port?: number
    /** 用户名（可选） */
    username?: string
    /** 密码（可选） */
    password?: string
    /** 是否启用代理 */
    enabled?: boolean
  }

  // ========== Phase 1: 做种限制 ==========
  /** 做种分享率限制（-1 或 0 表示不限制） */
  shareRatioLimit?: number
  /** 是否启用做种分享率限制 */
  shareRatioLimited?: boolean
  /** 做种时间限制（分钟，-1 或 0 表示不限制） */
  seedingTimeLimit?: number
  /** 是否启用做种时间限制 */
  seedingTimeLimited?: boolean
  /** 队列停滞时间（分钟，TR） */
  queueStalledMinutes?: number
  /** 是否启用队列停滞检测（TR） */
  queueStalledEnabled?: boolean

  // ========== Phase 1: 下载路径 ==========
  /** 默认保存路径 */
  savePath?: string
  /** 是否启用“未完成下载目录” */
  incompleteDirEnabled?: boolean
  /** 未完成下载目录 */
  incompleteDir?: string
  /** 是否给未完成文件添加后缀（qB: .!qB / TR: .part） */
  incompleteFilesSuffix?: boolean
  /** 添加种子时创建子文件夹（qB: create_subfolder_enabled） */
  createSubfolderEnabled?: boolean
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
   * 批量重新校验种子
   * @param hashes - 种子 hash/id 数组
   */
  recheckBatch(hashes: string[]): Promise<void>

  /**
   * 重新汇报（向 tracker 重新 announce）
   * @param hash - 种子 hash/id
   */
  reannounce(hash: string): Promise<void>

  /**
   * 批量重新汇报
   * @param hashes - 种子 hash/id 数组
   */
  reannounceBatch(hashes: string[]): Promise<void>

  /**
   * 强制开始/取消强制开始
   * @param hash - 种子 hash/id
   * @param value - true 强制开始，false 取消强制
   */
  forceStart(hash: string, value: boolean): Promise<void>

  /**
   * 批量强制开始/取消强制开始
   * @param hashes - 种子 hash/id 数组
   * @param value - true 强制开始，false 取消强制
   */
  forceStartBatch(hashes: string[], value: boolean): Promise<void>

  /**
   * 设置下载限速
   * @param hash - 种子 hash/id
   * @param limit - 限速值（bytes/s），-1 表示无限制
   */
  setDownloadLimit(hash: string, limit: number): Promise<void>

  /**
   * 批量设置下载限速
   * @param hashes - 种子 hash/id 数组
   * @param limit - 限速值（bytes/s），0 表示无限制
   */
  setDownloadLimitBatch(hashes: string[], limit: number): Promise<void>

  /**
   * 设置上传限速
   * @param hash - 种子 hash/id
   * @param limit - 限速值（bytes/s），-1 表示无限制
   */
  setUploadLimit(hash: string, limit: number): Promise<void>

  /**
   * 批量设置上传限速
   * @param hashes - 种子 hash/id 数组
   * @param limit - 限速值（bytes/s），0 表示无限制
   */
  setUploadLimitBatch(hashes: string[], limit: number): Promise<void>

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
   * 批量设置分类
   * @param hashes - 种子 hash/id 数组
   * @param category - 分类名称，空字符串表示移除分类
   */
  setCategoryBatch(hashes: string[], category: string): Promise<void>

  /**
   * 设置标签
   * @param hash - 种子 hash/id
   * @param tags - 标签数组
   * @param mode - 'set' 替换, 'add' 添加, 'remove' 移除
   */
  setTags(hash: string, tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void>

  /**
   * 批量设置标签
   * @param hashes - 种子 hash/id 数组
   * @param tags - 标签数组
   * @param mode - 'set' 替换, 'add' 添加, 'remove' 移除
   */
  setTagsBatch(hashes: string[], tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void>

  /**
   * 设置文件优先级
   * @param hash - 种子 hash/id
   * @param fileIds - 文件 id 数组
   * @param priority - 'high' | 'normal' | 'low' | 'do_not_download'
   */
  setFilePriority(hash: string, fileIds: number[], priority: 'high' | 'normal' | 'low' | 'do_not_download'): Promise<void>

  // ========== 分类管理 ==========

  /**
   * 获取所有分类
   * @returns 分类 Map，key 为分类名称
   */
  getCategories(): Promise<Map<string, Category>>

  /**
   * 创建分类
   * @param name - 分类名称
   * @param savePath - 保存路径（可选）
   */
  createCategory(name: string, savePath?: string): Promise<void>

  /**
   * 编辑分类
   * @param name - 原分类名称
   * @param newName - 新分类名称（可选）
   * @param savePath - 新保存路径（可选）
   */
  editCategory(name: string, newName?: string, savePath?: string): Promise<void>

  /**
   * 删除分类
   * @param names - 分类名称数组
   */
  deleteCategories(...names: string[]): Promise<void>

  /**
   * 设置分类保存路径
   * @param category - 分类名称
   * @param savePath - 保存路径
   */
  setCategorySavePath(category: string, savePath: string): Promise<void>

  // ========== 标签管理 ==========

  /**
   * 获取所有标签
   * @returns 标签数组
   */
  getTags(): Promise<string[]>

  /**
   * 创建标签
   * @param tags - 标签数组
   */
  createTags(...tags: string[]): Promise<void>

  /**
   * 删除标签
   * @param tags - 标签数组
   */
  deleteTags(...tags: string[]): Promise<void>

  // ========== 全局/备用限速设置 ==========

  /**
   * 获取后端传输设置
   */
  getTransferSettings(): Promise<TransferSettings>

  /**
   * 更新后端传输设置（部分字段）
   */
  setTransferSettings(patch: Partial<TransferSettings>): Promise<void>

  // ========== v5 新增功能 ==========

  /**
   * 重命名种子（仅 WebAPI v2.8.0+）
   * @param hash - 种子 hash
   * @param newName - 新名称
   */
  renameTorrent?(hash: string, newName: string): Promise<void>

  /**
   * 重命名文件（仅 WebAPI v2.8.2+）
   * @param hash - 种子 hash
   * @param oldPath - 旧文件路径
   * @param newPath - 新文件路径
   */
  renameFile?(hash: string, oldPath: string, newPath: string): Promise<void>

  /**
   * 重命名文件夹（仅 WebAPI v2.8.2+）
   * @param hash - 种子 hash
   * @param oldPath - 旧文件夹路径
   * @param newPath - 新文件夹路径
   */
  renameFolder?(hash: string, oldPath: string, newPath: string): Promise<void>

  // ========== 应用偏好设置 ==========

  /**
   * 获取后端应用偏好设置
   * @returns BackendPreferences - 后端设置对象
   */
  getPreferences(): Promise<BackendPreferences>

  /**
   * 更新后端应用偏好设置（部分字段）
   * @param patch - 要修改的字段（undefined 字段会被忽略）
   */
  setPreferences(patch: Partial<BackendPreferences>): Promise<void>

  /**
   * 获取后端支持的功能列表（用于 UI 动态显示）
   * @returns BackendCapabilities - 后端能力标记对象
   */
  getCapabilities(): BackendCapabilities
}
