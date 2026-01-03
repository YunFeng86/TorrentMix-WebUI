/**
 * 表格列配置定义
 *
 * 为每个表格定义列的默认属性:
 * - 最小宽度
 * - 默认宽度
 * - 是否自适应 (flex-1)
 * - 响应式断点
 * - 排序支持
 * - 对齐方式
 */

import type { ColumnDefinition } from './types'

/**
 * 主种子列表表格 (DashboardView)
 */
export const TORRENT_TABLE_COLUMNS: ColumnDefinition[] = [
  {
    id: 'checkbox',
    label: '',
    minWidth: 48,
    defaultWidth: 48,
    resizable: false,
    sortable: false
  },
  {
    id: 'name',
    label: '种子',
    minWidth: 200,
    defaultWidth: 400,
    isFlexible: true,
    sortable: true,
    align: 'left'
  },
  {
    id: 'progress',
    label: '进度',
    minWidth: 80,
    defaultWidth: 128,
    sortable: true,
    align: 'center'
  },
  {
    id: 'dlSpeed',
    label: '下载',
    minWidth: 60,
    defaultWidth: 80,
    sortable: true,
    align: 'right'
  },
  {
    id: 'upSpeed',
    label: '上传',
    minWidth: 60,
    defaultWidth: 80,
    sortable: true,
    align: 'right',
    responsiveHidden: 'md'
  },
  {
    id: 'eta',
    label: '剩余时间',
    minWidth: 60,
    defaultWidth: 64,
    sortable: true,
    align: 'right',
    responsiveHidden: 'lg'
  },
  {
    id: 'actions',
    label: '',
    minWidth: 64,
    defaultWidth: 64,
    resizable: false,
    sortable: false
  }
]

/**
 * 文件列表表格 (TorrentBottomPanel - Files Tab)
 */
export const FILE_TABLE_COLUMNS: ColumnDefinition[] = [
  {
    id: 'filename',
    label: '文件名',
    minWidth: 150,
    defaultWidth: 300,
    isFlexible: true,
    sortable: false,
    align: 'left'
  },
  {
    id: 'size',
    label: '大小',
    minWidth: 60,
    defaultWidth: 80,
    sortable: false,
    align: 'right'
  },
  {
    id: 'progress',
    label: '进度',
    minWidth: 80,
    defaultWidth: 96,
    sortable: false,
    align: 'right'
  },
  {
    id: 'priority',
    label: '优先级',
    minWidth: 50,
    defaultWidth: 56,
    sortable: false,
    align: 'center'
  }
]

/**
 * Tracker 列表表格 (TorrentBottomPanel - Trackers Tab)
 */
export const TRACKER_TABLE_COLUMNS: ColumnDefinition[] = [
  {
    id: 'url',
    label: 'Tracker',
    minWidth: 200,
    defaultWidth: 400,
    isFlexible: true,
    sortable: false,
    align: 'left'
  },
  {
    id: 'status',
    label: '状态',
    minWidth: 60,
    defaultWidth: 64,
    sortable: false,
    align: 'center'
  },
  {
    id: 'peers',
    label: 'Peers',
    minWidth: 40,
    defaultWidth: 40,
    sortable: false,
    align: 'right'
  },
  {
    id: 'tier',
    label: 'Tier',
    minWidth: 30,
    defaultWidth: 32,
    sortable: false,
    align: 'right'
  }
]

/**
 * Peers 列表表格 (TorrentBottomPanel - Peers Tab)
 */
export const PEER_TABLE_COLUMNS: ColumnDefinition[] = [
  {
    id: 'address',
    label: '地址',
    minWidth: 100,
    defaultWidth: 112,
    sortable: false,
    align: 'left'
  },
  {
    id: 'client',
    label: '客户端',
    minWidth: 150,
    defaultWidth: 200,
    isFlexible: true,
    sortable: false,
    align: 'left'
  },
  {
    id: 'progress',
    label: '进度',
    minWidth: 60,
    defaultWidth: 64,
    sortable: false,
    align: 'right'
  },
  {
    id: 'dlSpeed',
    label: '下载',
    minWidth: 70,
    defaultWidth: 80,
    sortable: false,
    align: 'right'
  },
  {
    id: 'upSpeed',
    label: '上传',
    minWidth: 70,
    defaultWidth: 80,
    sortable: false,
    align: 'right'
  }
]
