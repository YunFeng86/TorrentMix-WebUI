/**
 * 表格列宽调整与可见性控制 - 类型定义
 *
 * 设计原则:
 * - Good Taste: 统一的数据结构消除各表格的特殊实现
 * - Simplicity: 平铺结构，避免嵌套
 */

/**
 * 列定义 (不可变配置)
 */
export interface ColumnDefinition {
  /** 列唯一标识 */
  id: string
  /** 显示名称 */
  label: string
  /** 最小宽度 (px) */
  minWidth: number
  /** 默认宽度 (px) */
  defaultWidth: number
  /** 是否自适应剩余空间 (flex-1) */
  isFlexible?: boolean
  /** 是否允许拖拽调整宽度 */
  resizable?: boolean
  /** 响应式断点隐藏 */
  responsiveHidden?: 'md' | 'lg' | null
  /** 是否支持排序 */
  sortable?: boolean
  /** 文本对齐 */
  align?: 'left' | 'center' | 'right'
}

/**
 * 列状态 (可变状态)
 */
export interface ColumnState extends ColumnDefinition {
  /** 当前宽度 */
  currentWidth: number
  /** 是否可见 */
  visible: boolean
}

/**
 * 列调整状态 (拖拽中)
 */
export interface ColumnResizeState {
  /** 是否正在调整 */
  isResizing: boolean
  /** 分隔线左侧列 ID */
  columnId: string | null
  /** 分隔线右侧列 ID */
  rightColumnId: string | null
  /** 起始 X 坐标 */
  startX: number
  /** 左列起始宽度 */
  startWidth: number
  /** 左列起始渲染宽度 (受 flex 收缩影响后的实际宽度) */
  startRenderedWidth: number
  /** 右列起始宽度 */
  startRightWidth: number
  /** 右列起始渲染宽度 (受 flex 收缩影响后的实际宽度) */
  startRightRenderedWidth: number
}

/**
 * localStorage 存储格式
 * key: `table-columns-${tableId}`
 * value: JSON.stringify(StoredColumnConfig)
 */
export interface StoredColumnConfig {
  [columnId: string]: {
    width: number
    visible: boolean
  }
}
