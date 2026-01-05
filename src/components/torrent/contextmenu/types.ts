export type ContextMenuItem =
  | {
      type: 'divider'
      id: string
      visible?: boolean
    }
  | {
      type: 'action'
      id: string
      label: string
      icon: string
      danger?: boolean
      disabled?: boolean
      visible?: boolean
      action: () => void
    }

/**
 * 右键菜单状态
 */
export interface ContextMenuState {
  show: boolean           // 是否显示
  x: number               // X 坐标
  y: number               // Y 坐标
  hashes: string[]        // 选中的种子 hash 列表
}
