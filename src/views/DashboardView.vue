<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import { useTorrentStore } from '@/store/torrent'
import { useAuthStore } from '@/store/auth'
import { useBackendStore } from '@/store/backend'
import { usePolling } from '@/composables/usePolling'
import { useTableColumns } from '@/composables/useTableColumns'
import { TORRENT_TABLE_COLUMNS } from '@/composables/useTableColumns/configs'
import { AuthError } from '@/api/client'
import type { UnifiedTorrent } from '@/adapter/types'
import type { AddTorrentParams } from '@/adapter/interface'
import TorrentRow from '@/components/torrent/TorrentRow.vue'
import TorrentCard from '@/components/torrent/TorrentCard.vue'
import AddTorrentDialog from '@/components/AddTorrentDialog.vue'
import VirtualTorrentList from '@/components/VirtualTorrentList.vue'
import VirtualTorrentCardList from '@/components/VirtualTorrentCardList.vue'
import TorrentBottomPanel from '@/components/TorrentBottomPanel.vue'
import ResizableTableHeader from '@/components/table/ResizableTableHeader.vue'
import OverflowActionBar, { type OverflowActionItem } from '@/components/toolbar/OverflowActionBar.vue'
import ColumnSettingsDialog from '@/components/ColumnSettingsDialog.vue'
import BackendSettingsDialog from '@/components/BackendSettingsDialog.vue'
import CategoryManageDialog from '@/components/CategoryManageDialog.vue'
import TagManageDialog from '@/components/TagManageDialog.vue'
import Icon from '@/components/Icon.vue'
import TorrentContextMenu from '@/components/torrent/contextmenu/TorrentContextMenu.vue'
import { formatSpeed, formatBytes } from '@/utils/format'

// 虚拟滚动阈值：超过 200 个种子时启用虚拟滚动（性能优化）
const VIRTUAL_SCROLL_THRESHOLD = 200
// 移动端卡片视图更重：阈值单独设置，避免大量 DOM 导致窄屏 resize 卡顿
const MOBILE_VIRTUAL_SCROLL_THRESHOLD = 80
const TORRENT_ROW_ESTIMATED_HEIGHT = 60

const router = useRouter()
const torrentStore = useTorrentStore()
const authStore = useAuthStore()
const backendStore = useBackendStore()

// 从 Store 获取 adapter（解耦：View 层不再直接实例化 Adapter）
const adapter = computed(() => backendStore.adapter!)

// 确保在访问 adapter 之前已初始化
if (!backendStore.isInitialized) {
  throw new Error('[DashboardView] Backend not initialized. This should not happen after bootstrap.')
}

const selectedHashes = ref<Set<string>>(new Set())
const searchQuery = ref('')
const debouncedSearchQuery = ref('')  // 用于过滤的实际搜索词（防抖后）
const sidebarCollapsed = ref(false)
const isMobile = ref(window.innerWidth < 768)
const windowWidth = ref(window.innerWidth)
const tableScrollRef = ref<HTMLElement | null>(null)
const mobileScrollRef = ref<HTMLElement | null>(null)

type ScrollAnchor = {
  id?: string
  offset: number
  scrollTop: number
}

const pendingScrollAnchor = ref<ScrollAnchor | null>(null)
let restoreScheduled = false

function captureScrollAnchor(): ScrollAnchor | null {
  const scrollEl = tableScrollRef.value
  if (!scrollEl) return null

  const scrollRect = scrollEl.getBoundingClientRect()
  const rows = Array.from(scrollEl.querySelectorAll<HTMLElement>('[data-torrent-id]'))
  if (rows.length === 0) {
    return { offset: 0, scrollTop: scrollEl.scrollTop }
  }

  let bestRow: HTMLElement | null = null
  let bestOffset = 0

  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (rect.bottom <= scrollRect.top) continue
    if (rect.top >= scrollRect.bottom) continue
    const offset = rect.top - scrollRect.top
    if (!bestRow || Math.abs(offset) < Math.abs(bestOffset)) {
      bestRow = row
      bestOffset = offset
    }
  }

  return {
    id: bestRow?.dataset.torrentId,
    offset: bestOffset,
    scrollTop: scrollEl.scrollTop,
  }
}

async function restoreScrollAnchor() {
  const scrollEl = tableScrollRef.value
  const anchor = pendingScrollAnchor.value
  pendingScrollAnchor.value = null
  restoreScheduled = false
  if (!scrollEl || !anchor) return

  const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)

  const index = anchor.id ? sortedTorrents.value.findIndex(t => t.id === anchor.id) : -1
  if (index < 0) {
    scrollEl.scrollTop = Math.max(0, Math.min(anchor.scrollTop, maxScroll))
    return
  }

  const id = anchor.id
  if (!id) return

  const target = index * TORRENT_ROW_ESTIMATED_HEIGHT - anchor.offset
  scrollEl.scrollTop = Math.max(0, Math.min(target, maxScroll))

  await nextTick()

  const row = scrollEl.querySelector<HTMLElement>(`[data-torrent-id="${CSS.escape(id)}"]`)
  if (!row) return
  const scrollRect = scrollEl.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const offsetNow = rowRect.top - scrollRect.top
  const delta = offsetNow - anchor.offset
  if (delta === 0) return

  scrollEl.scrollTop = Math.max(0, Math.min(scrollEl.scrollTop + delta, maxScroll))
}

function schedulePreserveTopAnchor() {
  if (isMobile.value) return
  if (restoreScheduled) return
  pendingScrollAnchor.value = captureScrollAnchor()
  restoreScheduled = true
  void nextTick().then(restoreScrollAnchor)
}

// 表格列宽调整与可见性控制
const {
  columns,
  resizeState,
  startResize,
  toggleVisibility,
  resetToDefaults
} = useTableColumns('torrents', TORRENT_TABLE_COLUMNS)

// 搜索防抖：300ms 后才更新过滤条件
const updateSearch = useDebounceFn((value: string) => {
  debouncedSearchQuery.value = value
}, 300)

// 监听搜索输入
watch(searchQuery, (val) => updateSearch(val))

// 添加种子对话框
const showAddDialog = ref(false)
const addLoading = ref(false)
const addError = ref('')

// 分类/标签管理对话框
const showCategoryManage = ref(false)
const showTagManage = ref(false)
const showColumnSettings = ref(false)
const showBackendSettings = ref(false)

// 右键菜单状态
const contextmenuState = ref({
  show: false,
  x: 0,
  y: 0,
  hashes: [] as string[]
})

// 窄屏搜索：折叠为按钮，使用下拉 popover 展开
const searchPopoverOpen = ref(false)
const searchPopoverRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

async function openSearchPopover() {
  searchPopoverOpen.value = true
  await nextTick()
  searchInputRef.value?.focus()
}

function closeSearchPopover() {
  searchPopoverOpen.value = false
}

async function toggleSearchPopover() {
  if (searchPopoverOpen.value) {
    closeSearchPopover()
    return
  }
  await openSearchPopover()
}

function handleDocumentClick(e: MouseEvent) {
  const target = e.target as Node | null
  if (!target) return

  if (searchPopoverOpen.value && searchPopoverRef.value && !searchPopoverRef.value.contains(target)) {
    searchPopoverOpen.value = false
  }
}

// 底部详情面板
const showDetailPanel = ref(false)
const selectedTorrent = ref<UnifiedTorrent | null>(null)
const detailPanelHeight = ref(350)

// 选择种子并显示详情
function selectTorrentForDetail(hash: string, event?: Event) {
  const torrent = torrentStore.torrents.get(hash)
  if (!torrent) return

  // 检查是否是特殊按键点击
  const isCtrlClick = event && (event as MouseEvent).ctrlKey
  const isShiftClick = event && (event as MouseEvent).shiftKey
  
  if (isCtrlClick) {
    // Ctrl+点击：切换选择状态，不改变详情面板
    toggleSelect(hash)
    return
  }
  
  if (isShiftClick && selectedHashes.value.size > 0) {
    // Shift+点击：范围选择
    const allTorrents = sortedTorrents.value
    const lastSelected = Array.from(selectedHashes.value)[selectedHashes.value.size - 1]
    const currentIndex = allTorrents.findIndex(t => t.id === hash)
    const lastIndex = allTorrents.findIndex(t => t.id === lastSelected)
    
    if (currentIndex !== -1 && lastIndex !== -1) {
      const start = Math.min(currentIndex, lastIndex)
      const end = Math.max(currentIndex, lastIndex)
      
      selectedHashes.value.clear()
      for (let i = start; i <= end; i++) {
        const t = allTorrents[i]
        if (t) selectedHashes.value.add(t.id)
      }
    }
    return
  }

  // 普通点击：选择种子并显示详情
  selectedTorrent.value = torrent
  showDetailPanel.value = true
  
  // 单选模式
  selectedHashes.value.clear()
  selectedHashes.value.add(hash)
}

// 关闭详情面板
function closeDetailPanel() {
  showDetailPanel.value = false
  selectedTorrent.value = null
}

// 调整面板高度
function resizeDetailPanel(height: number) {
  detailPanelHeight.value = height
}

// 键盘导航
const focusedIndex = ref(-1)

// 键盘事件处理
function handleKeyDown(e: KeyboardEvent) {
  if (sortedTorrents.value.length === 0) return
  
  const maxIndex = sortedTorrents.value.length - 1
  
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      focusedIndex.value = Math.max(0, focusedIndex.value - 1)
      selectTorrentByIndex(focusedIndex.value)
      break
      
    case 'ArrowDown':
      e.preventDefault()
      if (focusedIndex.value === -1) {
        focusedIndex.value = 0
      } else {
        focusedIndex.value = Math.min(maxIndex, focusedIndex.value + 1)
      }
      selectTorrentByIndex(focusedIndex.value)
      break
      
    case 'Enter':
    case ' ':
      e.preventDefault()
      if (focusedIndex.value >= 0) {
        const torrent = sortedTorrents.value[focusedIndex.value]
        if (!torrent) break
        if (e.ctrlKey || e.key === ' ') {
          toggleSelect(torrent.id)
        } else {
          selectTorrentForDetail(torrent.id)
        }
      }
      break
      
    case 'Escape':
      closeDetailPanel()
      break
  }
}

// 通过索引选择种子
function selectTorrentByIndex(index: number) {
  const torrent = sortedTorrents.value[index]
  if (torrent) {
    selectTorrentForDetail(torrent.id)
  }
}

// 监听屏幕尺寸变化
let resizeRafId: number | null = null
let pendingResizeWidth = window.innerWidth
const handleResize = () => {
  pendingResizeWidth = window.innerWidth
  if (resizeRafId !== null) return
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null

    const w = pendingResizeWidth
    if (windowWidth.value !== w) windowWidth.value = w

    const nextMobile = w < 768
    if (isMobile.value !== nextMobile) isMobile.value = nextMobile

    // 移动端自动折叠侧边栏
    if (nextMobile) sidebarCollapsed.value = true

    // 回到较宽屏幕后收起窄屏 popover
    if (w >= 1120) searchPopoverOpen.value = false
  })
}

// 过滤器（支持暂停的二级分类）
type StateFilter = 'all' | 'downloading' | 'seeding' | 'paused' | 'paused-completed' | 'paused-incomplete' | 'checking' | 'queued' | 'error'
const stateFilter = ref<StateFilter>('all')
const categoryFilter = ref<string>('all')
const tagFilter = ref<string>('all')

// 统计数据 - 优先使用 ServerState 的全局速度（后端不支持时回退到求和）
const stats = computed(() => {
  const torrents = Array.from(torrentStore.torrents.values())
  const ss = backendStore.serverState
  const serverDlSpeed = ss?.dlInfoSpeed
  const serverUpSpeed = ss?.upInfoSpeed
  const hasServerSpeed = typeof serverDlSpeed === 'number' && typeof serverUpSpeed === 'number'

  // 单次遍历完成状态计数（无法避免）
  const result = {
    total: torrents.length,
    downloading: 0,
    seeding: 0,
    paused: 0,
    pausedCompleted: 0,
    pausedIncomplete: 0,
    checking: 0,
    queued: 0,
    error: 0,
    dlSpeed: hasServerSpeed ? serverDlSpeed : 0,
    upSpeed: hasServerSpeed ? serverUpSpeed : 0
  }

  for (const t of torrents) {
    // 状态计数
    if (t.state === 'downloading') result.downloading++
    else if (t.state === 'seeding') result.seeding++
    else if (t.state === 'paused') {
      result.paused++
      // 二级分类：已完成 vs 未完成
      if (t.progress >= 1.0) result.pausedCompleted++
      else result.pausedIncomplete++
    }
    else if (t.state === 'checking') result.checking++
    else if (t.state === 'queued') result.queued++
    else if (t.state === 'error') result.error++

    if (!hasServerSpeed) {
      result.dlSpeed += t.dlspeed
      result.upSpeed += t.upspeed
    }
  }

  return result
})

// 过滤后的种子
const filteredTorrents = computed(() => {
  let result = torrentStore.torrents

  // 状态过滤（支持暂停的二级分类）
  if (stateFilter.value !== 'all') {
    const filtered = new Map<string, UnifiedTorrent>()
    for (const [hash, torrent] of result) {
      // 一级状态匹配
      if (torrent.state === stateFilter.value) {
        filtered.set(hash, torrent)
      }
      // 暂停的二级分类
      else if (stateFilter.value === 'paused-completed' && torrent.state === 'paused' && torrent.progress >= 1.0) {
        filtered.set(hash, torrent)
      }
      else if (stateFilter.value === 'paused-incomplete' && torrent.state === 'paused' && torrent.progress < 1.0) {
        filtered.set(hash, torrent)
      }
    }
    result = filtered
  }

  // 分类过滤
  if (categoryFilter.value !== 'all') {
    const filtered = new Map<string, UnifiedTorrent>()
    for (const [hash, torrent] of result) {
      if (torrent.category === categoryFilter.value) {
        filtered.set(hash, torrent)
      }
    }
    result = filtered
  }

  // 标签过滤
  if (tagFilter.value !== 'all') {
    const filtered = new Map<string, UnifiedTorrent>()
    for (const [hash, torrent] of result) {
      if (torrent.tags?.includes(tagFilter.value)) {
        filtered.set(hash, torrent)
      }
    }
    result = filtered
  }

  // 搜索过滤（使用防抖后的搜索词）
  if (debouncedSearchQuery.value) {
    const query = debouncedSearchQuery.value.toLowerCase()
    const filtered = new Map<string, UnifiedTorrent>()
    for (const [hash, torrent] of result) {
      if (torrent.name.toLowerCase().includes(query)) {
        filtered.set(hash, torrent)
      }
    }
    result = filtered
  }

  return result
})

// ========== 阶段 4: 排序功能 ==========

// 排序字段和方向
type SortField = 'name' | 'size' | 'progress' | 'dlSpeed' | 'upSpeed' | 'addedTime' | 'ratio' | 'eta'
type SortDirection = 'asc' | 'desc'

const sortField = ref<SortField>('name')
const sortDirection = ref<SortDirection>('asc')

watch(
  [stateFilter, categoryFilter, tagFilter, debouncedSearchQuery, sortField, sortDirection],
  () => schedulePreserveTopAnchor(),
  { flush: 'pre' }
)

// 切换排序字段（表头点击）
function toggleSort(field: SortField) {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = field === 'name' ? 'asc' : 'desc'
  }
}

// 获取排序图标
function getSortIcon(field: SortField): string {
  if (sortField.value !== field) return ''
  return sortDirection.value === 'asc' ? '↑' : '↓'
}

// 排序函数
function compareTorrents(a: UnifiedTorrent, b: UnifiedTorrent): number {
  // 下载中的永远优先（保持现有逻辑）
  if (a.state === 'downloading' && b.state !== 'downloading') return -1
  if (b.state === 'downloading' && a.state !== 'downloading') return 1

  // 按选定字段排序
  let compare = 0
  switch (sortField.value) {
    case 'name':
      compare = a.name.localeCompare(b.name, 'zh-CN')
      break
    case 'size':
      compare = a.size - b.size
      break
    case 'progress':
      compare = a.progress - b.progress
      break
    case 'dlSpeed':
      compare = a.dlspeed - b.dlspeed
      break
    case 'upSpeed':
      compare = a.upspeed - b.upspeed
      break
    case 'addedTime':
      compare = a.addedTime - b.addedTime
      break
    case 'ratio':
      compare = a.ratio - b.ratio
      break
    case 'eta':
      // eta = -1 表示无限大，应该排在最后
      if (a.eta === -1 && b.eta === -1) compare = 0
      else if (a.eta === -1) compare = 1
      else if (b.eta === -1) compare = -1
      else compare = a.eta - b.eta
      break
  }

  return sortDirection.value === 'asc' ? compare : -compare
}

// 转换为数组并排序
const sortedTorrents = computed(() => {
  return Array.from(filteredTorrents.value.values()).sort(compareTorrents)
})

// 是否使用虚拟滚动（超过阈值时启用）
const useVirtualScroll = computed(() => sortedTorrents.value.length >= VIRTUAL_SCROLL_THRESHOLD)
const useMobileVirtualScroll = computed(() => sortedTorrents.value.length >= MOBILE_VIRTUAL_SCROLL_THRESHOLD)

const selectedBadge = computed<string | undefined>(() => {
  const count = selectedHashes.value.size
  if (count <= 0) return undefined
  return count > 99 ? '99+' : String(count)
})

const isAllSelected = computed(() => {
  const total = sortedTorrents.value.length
  return total > 0 && selectedHashes.value.size === total
})

function handleToolbarAction(actionId: string) {
  switch (actionId) {
    case 'filter':
      sidebarCollapsed.value = false
      break
    case 'add':
      showAddDialog.value = true
      break
    case 'resume':
      void handleResume()
      break
    case 'pause':
      void handlePause()
      break
    case 'delete':
      void handleDelete()
      break
    case 'selectAll':
      selectAll()
      break
    case 'recheckSelected':
      void handleRecheckSelected()
      break
    case 'forceStartSelected':
      void handleForceStartSelected()
      break
    case 'reannounceSelected':
      void handleReannounceSelected()
      break
    case 'batchSpeedLimit':
      void handleBatchSpeedLimit()
      break
    case 'categoryManage':
      showCategoryManage.value = true
      break
    case 'tagManage':
      showTagManage.value = true
      break
    case 'columns':
      showColumnSettings.value = true
      break
    case 'backendSettings':
      showBackendSettings.value = true
      break
  }
}

const toolbarPrimaryItems = computed<OverflowActionItem[]>(() => [
  { id: 'filter', title: '筛选', icon: 'panel-left', show: isMobile.value, pinned: true, priority: 0, group: 'main', groupLabel: '操作' },
  { id: 'add', title: '添加种子', icon: 'plus', variant: 'primary', pinned: true, priority: 0, group: 'main', groupLabel: '操作' },
  { id: 'resume', title: '开始', icon: 'play', color: 'blue', disabled: selectedHashes.value.size === 0, pinned: true, priority: 1, group: 'main', groupLabel: '操作' },
  { id: 'pause', title: '暂停', icon: 'pause', color: 'gray', disabled: selectedHashes.value.size === 0, pinned: true, priority: 1, group: 'main', groupLabel: '操作' },
  { id: 'delete', title: '删除', icon: 'trash-2', variant: 'danger', disabled: selectedHashes.value.size === 0, pinned: true, priority: 1, group: 'main', groupLabel: '操作' },
])

const toolbarBatchItems = computed<OverflowActionItem[]>(() => [
  { id: 'recheckSelected', title: '重新校验', icon: 'refresh-cw', disabled: selectedHashes.value.size === 0, pinned: true, priority: 0, group: 'batch', groupLabel: '批量' },
  { id: 'reannounceSelected', title: '重新汇报', icon: 'radio', disabled: selectedHashes.value.size === 0, pinned: true, priority: 1, group: 'batch', groupLabel: '批量' },
  { id: 'forceStartSelected', title: '强制开始', icon: 'zap', disabled: selectedHashes.value.size === 0, pinned: true, priority: 2, group: 'batch', groupLabel: '批量' },
  { id: 'batchSpeedLimit', title: '批量限速', icon: 'sliders', disabled: selectedHashes.value.size === 0, pinned: true, priority: 3, group: 'batch', groupLabel: '批量' },
])

const toolbarSelectItems = computed<OverflowActionItem[]>(() => [
  { id: 'selectAll', title: isAllSelected.value ? '取消全选' : '全选', icon: isAllSelected.value ? 'square-x' : 'square-check', badge: selectedBadge.value, pinned: true, priority: 0, group: 'select', groupLabel: '选择' },
])

const toolbarManageItems = computed<OverflowActionItem[]>(() => [
  { id: 'columns', title: '列设置', icon: 'columns-3', pinned: false, priority: 10, group: 'manage', groupLabel: '管理' },
  { id: 'categoryManage', title: '分类管理', icon: 'folder', show: backendStore.isQbit, pinned: false, priority: 11, group: 'manage', groupLabel: '管理' },
  { id: 'tagManage', title: '标签管理', icon: 'tag', show: backendStore.isQbit, pinned: false, priority: 12, group: 'manage', groupLabel: '管理' },
  { id: 'backendSettings', title: '设置', icon: 'settings', pinned: false, priority: 13, group: 'manage', groupLabel: '管理' },
])

const toolbarSingleRowLeftItems = computed<OverflowActionItem[]>(() => [
  ...toolbarPrimaryItems.value,
  ...toolbarBatchItems.value,
  ...toolbarSelectItems.value,
])
const toolbarTwoRowTopItems = computed<OverflowActionItem[]>(() => [
  ...toolbarPrimaryItems.value,
  ...toolbarSelectItems.value,
])

// 渐进式：先在一排内收缩搜索/状态，最后再把“批量+管理”移到第二排
const showSearchInput = computed(() => windowWidth.value >= 1120)
const useTwoRowToolbar = computed(() => windowWidth.value < 960)

// 立即刷新函数（操作后调用）
async function immediateRefresh() {
  try {
    const result = await adapter.value.fetchList()
    torrentStore.updateTorrents(result.torrents)
    // 更新全局数据（分类、标签、服务器状态）
    backendStore.updateGlobalData({
      categories: result.categories,
      tags: result.tags,
      serverState: result.serverState
    })
    // 同步更新详情面板的种子引用（否则面板显示的是快照数据）
    if (selectedTorrent.value) {
      const updated = result.torrents.get(selectedTorrent.value.id)
      if (updated) selectedTorrent.value = updated
    }
  } catch (error) {
    console.error('[Dashboard] Refresh failed:', error)
  }
}

// 使用智能轮询（指数退避 + 熔断器 + 页面可见性监听 + 致命错误处理）
const { start: startPolling, failureCount, isCircuitBroken } = usePolling({
  fn: async () => {
    const result = await adapter.value.fetchList()
    torrentStore.updateTorrents(result.torrents)
    // 更新全局数据（分类、标签、服务器状态）
    backendStore.updateGlobalData({
      categories: result.categories,
      tags: result.tags,
      serverState: result.serverState
    })
    // 同步更新详情面板的种子引用（保持面板数据与 Store 同步）
    if (selectedTorrent.value) {
      const updated = result.torrents.get(selectedTorrent.value.id)
      if (updated) selectedTorrent.value = updated
    }
  },
  // 遇到 403 立即跳转登录
  onFatalError: (error) => {
    if (error instanceof AuthError) {
      router.replace('/login')
    }
  },
  baseInterval: 2000,
  maxInterval: 30000,
  circuitBreakerThreshold: 5,
  circuitBreakerDelay: 60000,
  pauseWhenHidden: true
})

// 连接状态计算
const connectionStatus = computed(() => {
  if (isCircuitBroken.value) {
    return { text: '连接断开', type: 'error' as const, icon: 'disconnected' }
  }
  if (failureCount.value > 0) {
    return { text: `重连中... (${failureCount.value})`, type: 'warning' as const, icon: 'reconnecting' }
  }
  return { text: '已连接', type: 'success' as const, icon: 'connected' }
})

const connectionLabel = computed(() => {
  if (windowWidth.value >= 1400) return connectionStatus.value.text
  if (connectionStatus.value.type === 'success') return '已连'
  if (connectionStatus.value.type === 'warning') return '异常'
  return '断开'
})

const showToolbarConnection = computed(() => showSearchInput.value && !useTwoRowToolbar.value)

function toggleSelect(hash: string) {
  if (selectedHashes.value.has(hash)) {
    selectedHashes.value.delete(hash)
  } else {
    selectedHashes.value.add(hash)
  }
}

function selectAll() {
  if (selectedHashes.value.size === sortedTorrents.value.length) {
    selectedHashes.value.clear()
  } else {
    for (const [hash] of filteredTorrents.value) {
      selectedHashes.value.add(hash)
    }
  }
}

async function handlePause() {
  await adapter.value.pause(Array.from(selectedHashes.value))
  selectedHashes.value.clear()
  await immediateRefresh()
}

async function handleResume() {
  await adapter.value.resume(Array.from(selectedHashes.value))
  selectedHashes.value.clear()
  await immediateRefresh()
}

async function handleDelete() {
  const count = selectedHashes.value.size
  if (count === 0) return

  // 获取种子名称（最多显示 3 个）
  const names = Array.from(selectedHashes.value)
    .map(h => torrentStore.torrents.get(h)?.name)
    .filter(Boolean)
    .slice(0, 3)

  const nameList = names.join('、')
  const moreText = count > 3 ? `等 ${count} 个种子` : `${count} 个种子`

  // 询问是否删除文件
  const deleteFiles = confirm(
    `是否同时删除下载文件？\n\n种子：${nameList}${count > 3 ? '...' : ''}\n(${moreText})`
  )

  // 二次确认（如果删除文件）
  if (deleteFiles) {
    if (!confirm(`⚠️ 确定删除 ${moreText} 并同时删除下载文件吗？\n\n此操作不可恢复！`)) {
      return
    }
  } else {
    if (!confirm(`确定删除 ${moreText} 吗？\n（仅删除种子，保留文件）`)) {
      return
    }
  }

  await adapter.value.delete(Array.from(selectedHashes.value), deleteFiles)
  selectedHashes.value.clear()
  await immediateRefresh()
}

async function logout() {
  await authStore.logout()
  router.replace('/login')
}

// 添加种子
async function handleAddTorrent(params: AddTorrentParams) {
  addLoading.value = true
  addError.value = ''
  try {
    await adapter.value.addTorrent(params)
    showAddDialog.value = false
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Failed to add torrent:', err)
    addError.value = err instanceof Error ? err.message : '添加种子失败'
  } finally {
    addLoading.value = false
  }
}

// 处理种子行操作（来自 TorrentRow 的 action 事件）
async function handleTorrentAction(action: string, hash: string) {
  try {
    switch (action) {
      case 'pause':
        await adapter.value.pause([hash])
        break
      case 'resume':
        await adapter.value.resume([hash])
        break
      case 'recheck':
        await adapter.value.recheck(hash)
        break
      case 'reannounce':
        await adapter.value.reannounce(hash)
        break
      case 'forceStart':
        await adapter.value.forceStart(hash, true)
        break
      case 'delete': {
        const torrent = torrentStore.torrents.get(hash)
        const deleteFiles = confirm(
          `是否同时删除下载文件？\n\n种子：${torrent?.name || hash}`
        )
        if (deleteFiles) {
          if (!confirm(`⚠️ 确定删除并删除文件吗？\n\n此操作不可恢复！`)) return
        } else {
          if (!confirm(`确定删除种子吗？\n（仅删除种子，保留文件）`)) return
        }
        await adapter.value.delete([hash], deleteFiles)
        break
      }
    }
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Action failed:', err)
    alert(err instanceof Error ? err.message : '操作失败')
  }
}

// 处理右键菜单打开
function handleContextMenu(e: MouseEvent, hash: string) {
  e.preventDefault()
  e.stopPropagation()

  const hashes = selectedHashes.value.has(hash)
    ? Array.from(selectedHashes.value)
    : [hash]

  contextmenuState.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    hashes
  }
}

// 处理右键菜单操作
async function handleContextMenuAction(action: string, hashes: string[]) {
  contextmenuState.value.show = false

  try {
    switch (action) {
      case 'pause':
        await adapter.value.pause(hashes)
        break
      case 'resume':
        await adapter.value.resume(hashes)
        break
      case 'delete': {
        const count = hashes.length
        const names = hashes
          .map(h => torrentStore.torrents.get(h)?.name)
          .filter(Boolean)
          .slice(0, 3)
        const nameList = names.join('、')
        const moreText = count > 3 ? `等 ${count} 个种子` : `${count} 个种子`

        const deleteFiles = confirm(
          `是否同时删除下载文件？\n\n种子：${nameList}${count > 3 ? '...' : ''}\n(${moreText})`
        )
        if (deleteFiles) {
          if (!confirm(`⚠️ 确定删除 ${moreText} 并同时删除下载文件吗？\n\n此操作不可恢复！`)) return
        } else {
          if (!confirm(`确定删除 ${moreText} 吗？\n（仅删除种子，保留文件）`)) return
        }
        await adapter.value.delete(hashes, deleteFiles)
        break
      }
      case 'recheck':
        await adapter.value.recheckBatch(hashes)
        break
      case 'reannounce':
        await adapter.value.reannounceBatch(hashes)
        break
      case 'force-start':
        await adapter.value.forceStartBatch(hashes, true)
        break
      case 'set-category':
        // TODO: 打开分类选择对话框
        alert('设置分类功能开发中')
        return
      case 'set-tags':
        // TODO: 打开标签选择对话框
        alert('设置标签功能开发中')
        return
      default:
        console.warn('[Dashboard] Unknown contextmenu action:', action)
        return
    }
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Contextmenu action failed:', err)
    alert(err instanceof Error ? err.message : '操作失败')
  }
}

// 批量操作：重新校验选中项
async function handleRecheckSelected() {
  if (selectedHashes.value.size === 0) return
  const hashes = Array.from(selectedHashes.value)
  try {
    await adapter.value.recheckBatch(hashes)
    selectedHashes.value.clear()
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Recheck failed:', err)
    alert(err instanceof Error ? err.message : '重新校验失败')
  }
}

// 批量操作：强制开始选中项
async function handleForceStartSelected() {
  if (selectedHashes.value.size === 0) return
  const hashes = Array.from(selectedHashes.value)
  try {
    await adapter.value.forceStartBatch(hashes, true)
    selectedHashes.value.clear()
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Force start failed:', err)
    alert(err instanceof Error ? err.message : '强制开始失败')
  }
}

// 批量操作：重新汇报选中项
async function handleReannounceSelected() {
  if (selectedHashes.value.size === 0) return
  const hashes = Array.from(selectedHashes.value)
  try {
    await adapter.value.reannounceBatch(hashes)
    selectedHashes.value.clear()
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Reannounce failed:', err)
    alert(err instanceof Error ? err.message : '重新汇报失败')
  }
}

// 批量操作：限速
async function handleBatchSpeedLimit() {
  if (selectedHashes.value.size === 0) return

  const dlLimitInput = prompt('下载限制 (KB/s, 留空或 0 表示不限制):')
  if (dlLimitInput === null) return

  const upLimitInput = prompt('上传限制 (KB/s, 留空或 0 表示不限制):')
  if (upLimitInput === null) return

  const hashes = Array.from(selectedHashes.value)
  try {
    const parseKbLimit = (raw: string) => {
      const text = raw.trim()
      if (text === '' || text === '0') return 0
      const kb = Number.parseInt(text, 10)
      if (!Number.isFinite(kb) || kb < 0) {
        throw new Error('限速请输入非负整数（KB/s）')
      }
      return kb * 1024
    }

    const dlLimit = parseKbLimit(dlLimitInput)
    const upLimit = parseKbLimit(upLimitInput)

    await adapter.value.setDownloadLimitBatch(hashes, dlLimit)
    await adapter.value.setUploadLimitBatch(hashes, upLimit)

    selectedHashes.value.clear()
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Set speed limit failed:', err)
    alert(err instanceof Error ? err.message : '设置限速失败')
  }
}

onMounted(() => {
  startPolling()
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeyDown)
  document.addEventListener('click', handleDocumentClick)
  handleResize() // 初始化
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('click', handleDocumentClick)
  if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
})
</script>

<template>
  <div class="h-screen flex bg-gray-50">
    <!-- 主内容区 -->
    <div class="flex-1 flex overflow-hidden relative">
      <!-- 移动端遮罩层 -->
      <div
        v-if="!sidebarCollapsed && isMobile"
        @click="sidebarCollapsed = true"
        class="fixed inset-0 bg-black/50 z-40 md:hidden"
      ></div>

      <!-- 左侧边栏 -->
      <aside
        :class="`bg-white border-r border-gray-200 flex flex-col shrink-0 z-50
        ${isMobile
          ? (sidebarCollapsed ? '-translate-x-full w-64 fixed left-0 top-0 h-full transition-transform duration-300' : 'translate-x-0 w-64 fixed left-0 top-0 h-full transition-transform duration-300')
          : (sidebarCollapsed ? 'w-16' : 'w-64')
        }`"
        :style="!isMobile ? 'transition: width 300ms ease;' : ''"
      >
        <!-- 移动端顶部栏 -->
        <div v-if="isMobile" class="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 class="font-medium text-gray-900">筛选</h2>
          <button @click="sidebarCollapsed = true" class="btn p-2 hover:bg-gray-100">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <!-- 桌面端侧边栏头部 -->
        <div v-else class="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 :class="`font-medium text-gray-900 ${sidebarCollapsed ? 'hidden' : ''}`">TorrentMix UI</h2>
          <button @click="sidebarCollapsed = !sidebarCollapsed" class="btn p-2 hover:bg-gray-100">
            <Icon name="chevron-left" :size="16" :class="{ 'rotate-180': sidebarCollapsed }" />
          </button>
        </div>

        <!-- 过滤器列表 -->
        <nav class="flex-1 overflow-y-auto p-2">
          <div class="space-y-1">
            <button @click="stateFilter = 'all'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'all' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="list" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">全部</span>
              <span v-if="stats.total > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'all' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.total }}</span>
            </button>

            <button @click="stateFilter = 'downloading'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'downloading' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="download" color="blue" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">下载中</span>
              <span v-if="stats.downloading > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'downloading' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.downloading }}</span>
            </button>

            <button @click="stateFilter = 'seeding'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'seeding' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="upload-cloud" color="cyan" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">做种中</span>
              <span v-if="stats.seeding > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'seeding' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.seeding }}</span>
            </button>

            <!-- 已暂停（固定展开二级分类） -->
            <div>
              <button @click="stateFilter = 'paused'"
                      :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'paused' || stateFilter.startsWith('paused-') ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
                <Icon name="pause-circle" color="gray" :size="16" />
                <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">已暂停</span>
                <span v-if="stats.paused > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'paused' || stateFilter.startsWith('paused-') ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.paused }}</span>
              </button>

              <!-- 二级分类：固定展开 -->
              <div v-if="!sidebarCollapsed" class="ml-6 mt-1 space-y-1">
                <button @click.stop="stateFilter = 'paused-completed'"
                        :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'paused-completed' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`">
                  <Icon name="check-circle" color="green" :size="14" />
                  <span class="truncate text-sm">已完成</span>
                  <span v-if="stats.pausedCompleted > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${stateFilter === 'paused-completed' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.pausedCompleted }}</span>
                </button>

                <button @click.stop="stateFilter = 'paused-incomplete'"
                        :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'paused-incomplete' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`">
                  <Icon name="download-cloud" color="orange" :size="14" />
                  <span class="truncate text-sm">未完成</span>
                  <span v-if="stats.pausedIncomplete > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${stateFilter === 'paused-incomplete' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.pausedIncomplete }}</span>
                </button>
              </div>
            </div>

            <button @click="stateFilter = 'checking'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'checking' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="refresh-cw" color="purple" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">检查中</span>
              <span v-if="stats.checking > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'checking' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.checking }}</span>
            </button>

            <button @click="stateFilter = 'queued'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'queued' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="clock" color="orange" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">队列中</span>
              <span v-if="stats.queued > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'queued' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.queued }}</span>
            </button>

            <button @click="stateFilter = 'error'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'error' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="alert-circle" color="red" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">错误</span>
              <span v-if="stats.error > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'error' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.error }}</span>
            </button>
          </div>

          <!-- 分类筛选 (qB only) -->
          <div v-if="backendStore.isQbit && backendStore.categories.size > 0" :class="`mt-4 ${sidebarCollapsed ? 'hidden' : ''}`">
            <h3 :class="`text-xs font-medium text-gray-500 uppercase tracking-wider px-3 mb-2`">分类</h3>
            <div class="space-y-1">
              <button @click="categoryFilter = 'all'"
                      :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${categoryFilter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`">
                <Icon name="folder" :size="14" />
                <span class="truncate text-sm">全部分类</span>
              </button>
              <button v-for="cat in Array.from(backendStore.categories.values())" :key="cat.name"
                      @click="categoryFilter = cat.name"
                      :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${categoryFilter === cat.name ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`">
                <Icon name="folder" :size="14" />
                <span class="truncate text-sm">{{ cat.name }}</span>
              </button>
            </div>
          </div>

          <!-- 标签筛选 (qB only) -->
          <div v-if="backendStore.isQbit && backendStore.tags.length > 0" :class="`mt-4 ${sidebarCollapsed ? 'hidden' : ''}`">
            <h3 :class="`text-xs font-medium text-gray-500 uppercase tracking-wider px-3 mb-2`">标签</h3>
            <div class="flex flex-wrap gap-2 px-3">
              <button @click="tagFilter = 'all'"
                      :class="`px-2 py-1 rounded text-xs font-medium transition-colors ${tagFilter === 'all' ? 'bg-black text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`">
                全部
              </button>
              <button v-for="tag in backendStore.tags" :key="tag"
                      @click="tagFilter = tag"
                      :class="`px-2 py-1 rounded text-xs font-medium transition-colors ${tagFilter === tag ? 'bg-black text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`">
                {{ tag }}
              </button>
            </div>
          </div>
        </nav>
      </aside>

      <!-- 右侧主内容 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-white">
        <!-- 工具栏 -->
        <div class="border-b border-gray-200 px-3 py-2 sm:px-4 sm:py-3 flex flex-col gap-2 shrink-0">
          <!-- 单排：能放下时尽量一排 -->
          <div v-if="!useTwoRowToolbar" class="flex items-center gap-2 w-full min-w-0">
            <OverflowActionBar
              class="flex-1 min-w-0"
              :items="toolbarSingleRowLeftItems"
              overflow-title="更多操作"
              grouped
              @action="handleToolbarAction"
            />

            <div class="flex items-center gap-2 min-w-0">
              <OverflowActionBar
                class="min-w-0"
                :items="toolbarManageItems"
                overflow-title="更多管理"
                grouped
                @action="handleToolbarAction"
              />

              <!-- 搜索 -->
              <div class="flex items-center">
                <div v-if="showSearchInput" class="relative w-[clamp(9rem,14vw,14rem)] min-w-0">
                  <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input v-model="searchQuery" type="text" placeholder="搜索种子名称..." class="input pl-10 py-2" />
                </div>

                <div v-else ref="searchPopoverRef" class="relative">
                  <button @click.stop="toggleSearchPopover" class="icon-btn" title="搜索">
                    <Icon name="search" :size="16" />
                  </button>
                  <div
                    v-if="searchPopoverOpen"
                    class="absolute right-0 top-full mt-2 bg-white border border-gray-200 shadow-lg rounded-xl z-50 w-[min(92vw,22rem)]"
                  >
                    <div class="p-2">
                      <div class="flex items-center gap-2">
                        <div class="relative flex-1 min-w-0">
                          <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            ref="searchInputRef"
                            v-model="searchQuery"
                            type="text"
                            placeholder="搜索种子名称..."
                            class="input pl-10 py-2"
                            @keydown.escape="closeSearchPopover"
                          />
                        </div>
                        <button @click="closeSearchPopover" class="icon-btn" title="关闭搜索">
                          <Icon name="x" :size="16" />
                        </button>
                      </div>
                      <div class="text-[11px] text-gray-400 mt-2 px-1">
                        Esc 关闭，点击空白处收起
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 连接状态 -->
              <div v-if="showToolbarConnection" class="flex items-center gap-2 shrink-0" :title="connectionStatus.text">
                <div
                  :class="`w-2 h-2 rounded-full ${
                    connectionStatus.type === 'success' ? 'bg-green-500' :
                    connectionStatus.type === 'warning' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
                  }`"
                ></div>
                <span class="text-xs text-gray-500 max-w-[5rem] truncate">{{ connectionLabel }}</span>
              </div>

              <button @click="logout" class="icon-btn" title="退出">
                <Icon name="log-out" :size="16" />
              </button>
            </div>
          </div>

          <!-- 双排：批量 + 管理下移 -->
          <template v-else>
            <!-- 第一排：主操作 + 搜索/状态/退出 -->
            <div class="flex items-center gap-2 w-full min-w-0">
              <OverflowActionBar
                class="flex-1 min-w-0"
                :items="toolbarTwoRowTopItems"
                overflow-title="更多操作"
                grouped
                @action="handleToolbarAction"
              />

              <div class="flex items-center gap-2 shrink-0">
                <!-- 搜索 -->
                <div class="flex items-center">
                  <div ref="searchPopoverRef" class="relative">
                    <button @click.stop="toggleSearchPopover" class="icon-btn" title="搜索">
                      <Icon name="search" :size="16" />
                    </button>
                    <div
                      v-if="searchPopoverOpen"
                      class="absolute right-0 top-full mt-2 bg-white border border-gray-200 shadow-lg rounded-xl z-50 w-[min(92vw,22rem)]"
                    >
                      <div class="p-2">
                        <div class="flex items-center gap-2">
                          <div class="relative flex-1 min-w-0">
                            <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              ref="searchInputRef"
                              v-model="searchQuery"
                              type="text"
                              placeholder="搜索种子名称..."
                              class="input pl-10 py-2"
                              @keydown.escape="closeSearchPopover"
                            />
                          </div>
                          <button @click="closeSearchPopover" class="icon-btn" title="关闭搜索">
                            <Icon name="x" :size="16" />
                          </button>
                        </div>
                        <div class="text-[11px] text-gray-400 mt-2 px-1">
                          Esc 关闭，点击空白处收起
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <button @click="logout" class="icon-btn" title="退出">
                  <Icon name="log-out" :size="16" />
                </button>
              </div>
            </div>

            <!-- 第二排：批量 + 管理 -->
            <div class="flex items-center gap-2 w-full min-w-0">
              <OverflowActionBar
                class="flex-1 min-w-0"
                :items="toolbarBatchItems"
                overflow-title="更多操作"
                grouped
                @action="handleToolbarAction"
              />
              <OverflowActionBar
                class="ml-auto flex-initial min-w-0"
                :items="toolbarManageItems"
                overflow-title="更多管理"
                grouped
                @action="handleToolbarAction"
              />
            </div>
          </template>
        </div>

        <!-- 种子列表容器：flex-1 自动填充剩余空间 -->
        <div class="flex-1 overflow-hidden min-h-0">
          <!-- 桌面端列表视图 -->
          <div v-if="!isMobile" class="h-full min-h-0 flex flex-col">
            <!-- 表头 -->
            <ResizableTableHeader
              :columns="columns"
              :resize-state="resizeState"
              @start-resize="(leftId, rightId, startX, snapshots) => startResize(leftId, rightId, startX, snapshots)"
              @toggle-sort="(columnId) => toggleSort(columnId as SortField)"
            >
              <template #header-name="{ column }">
                {{ column.label }} {{ getSortIcon('name') }}
              </template>
              <template #header-progress="{ column }">
                {{ column.label }} {{ getSortIcon('progress') }}
              </template>
              <template #header-dlSpeed="{ column }">
                {{ column.label }} {{ getSortIcon('dlSpeed') }}
              </template>
              <template #header-upSpeed="{ column }">
                {{ column.label }} {{ getSortIcon('upSpeed') }}
              </template>
              <template #header-eta="{ column }">
                {{ column.label }} {{ getSortIcon('eta') }}
              </template>
            </ResizableTableHeader>

            <!-- 列表滚动容器：单一滚动条（避免嵌套） -->
            <div
              ref="tableScrollRef"
              class="flex-1 overflow-auto overflow-x-hidden min-h-0"
              style="scrollbar-gutter: stable;"
            >
              <!-- 虚拟滚动（大量种子时） -->
              <VirtualTorrentList
                v-if="useVirtualScroll && sortedTorrents.length > 0"
                :torrents="sortedTorrents"
                :selected-hashes="selectedHashes"
                :columns="columns"
                :scroll-element="tableScrollRef"
                :is-resizing="resizeState.isResizing"
                @click="selectTorrentForDetail"
                @toggle-select="toggleSelect"
                @action="handleTorrentAction"
                @contextmenu="handleContextMenu"
              />

              <!-- 普通列表（少量种子时） -->
              <template v-else-if="sortedTorrents.length > 0">
                <TorrentRow
                  v-for="torrent in sortedTorrents"
                  :key="torrent.id"
                  :torrent="torrent"
                  :selected="selectedHashes.has(torrent.id)"
                  :columns="columns"
                  :is-resizing="resizeState.isResizing"
                  @click="selectTorrentForDetail(torrent.id, $event)"
                  @toggle-select="toggleSelect($event.detail)"
                  @action="handleTorrentAction"
                  @contextmenu="handleContextMenu"
                />
              </template>

              <!-- 空状态 -->
              <div v-else class="px-4 py-16 text-center h-full flex items-center justify-center">
                <div class="flex flex-col items-center gap-4">
                  <Icon name="inbox" :size="48" class="text-gray-300" />
                  <div class="text-gray-500">
                    <p class="font-medium">{{ searchQuery ? '未找到匹配的种子' : '暂无种子' }}</p>
                    <p class="text-sm mt-1">{{ searchQuery ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 移动端卡片视图 -->
          <div v-else ref="mobileScrollRef" class="h-full overflow-auto p-4">
            <!-- 空状态 -->
            <div v-if="sortedTorrents.length === 0" class="text-center py-16">
              <Icon name="inbox" :size="64" class="text-gray-300 mx-auto mb-4" />
              <div class="text-gray-500">
                <p class="font-medium text-base">{{ searchQuery ? '未找到匹配的种子' : '暂无种子' }}</p>
                <p class="text-sm mt-1">{{ searchQuery ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
              </div>
            </div>

            <!-- 卡片列表 -->
            <VirtualTorrentCardList
              v-if="useMobileVirtualScroll && sortedTorrents.length > 0"
              :torrents="sortedTorrents"
              :selected-hashes="selectedHashes"
              :scroll-element="mobileScrollRef"
              @click="selectTorrentForDetail"
              @toggle-select="toggleSelect"
            />

            <div v-else class="space-y-3">
              <TorrentCard
                v-for="torrent in sortedTorrents"
                :key="torrent.id"
                :torrent="torrent"
                :selected="selectedHashes.has(torrent.id)"
                @click="selectTorrentForDetail(torrent.id)"
                @toggle-select="toggleSelect($event.detail)"
                @action="handleTorrentAction"
              />
            </div>
          </div>
        </div>

        <!-- 底部详情面板（在状态栏上面） -->
        <TorrentBottomPanel
          :torrent="selectedTorrent"
          :visible="showDetailPanel"
          :height="detailPanelHeight"
          @close="closeDetailPanel"
          @resize="resizeDetailPanel"
          @action="handleTorrentAction"
        />

        <!-- 底部状态栏 -->
        <div class="relative border-t border-gray-200 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-xs text-gray-500 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0 bg-gray-50">
          <!-- 左侧：版本号 + 统计信息 -->
          <div class="flex items-center gap-3 order-2 sm:order-1">
            <div class="flex items-center gap-x-4 gap-y-1 flex-wrap flex-1 min-w-0">
              <!-- 版本号 -->
              <span v-if="backendStore.versionDisplay" class="text-gray-400">{{ backendStore.versionDisplay }}</span>
              <div v-else class="flex items-center gap-1 text-amber-600">
                <Icon name="alert-triangle" :size="12" />
                <span>版本检测失败</span>
              </div>
              <div class="w-px h-3 bg-gray-300"></div>
              <!-- 统计 -->
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span class="font-medium text-gray-700">{{ stats.downloading }}</span>
                <span>下载中</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 bg-cyan-500 rounded-full"></div>
                <span class="font-medium text-gray-700">{{ stats.seeding }}</span>
                <span>做种中</span>
              </div>
              <div class="hidden lg:flex items-center gap-2">
                <span>总大小</span>
                <span class="font-mono font-medium text-gray-700">{{ formatBytes(Array.from(torrentStore.torrents.values()).reduce((sum, t) => sum + t.size, 0)) }}</span>
              </div>
            </div>

          </div>

          <!-- 右侧：速度（含限速） -->
          <div class="flex items-center gap-4 font-mono text-xs w-full justify-between sm:w-auto sm:justify-end order-1 sm:order-2">
            <div class="flex items-center gap-1">
              <span class="text-gray-500">↓</span>
              <span class="font-medium">{{ formatSpeed(stats.dlSpeed) }}</span>
              <span v-if="backendStore.serverState && backendStore.serverState.dlRateLimit > 0"
                    class="text-gray-400 text-[10px] ml-0.5"
                    :title="`下载限速: ${formatSpeed(backendStore.serverState.dlRateLimit)}`">
                / {{ formatSpeed(backendStore.serverState.dlRateLimit) }}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-gray-500">↑</span>
              <span class="font-medium">{{ formatSpeed(stats.upSpeed) }}</span>
              <span v-if="backendStore.serverState && backendStore.serverState.upRateLimit > 0"
                    class="text-gray-400 text-[10px] ml-0.5"
                    :title="`上传限速: ${formatSpeed(backendStore.serverState.upRateLimit)}`">
                / {{ formatSpeed(backendStore.serverState.upRateLimit) }}
              </span>
            </div>
            <!-- 备用速度限制（Alt Speed）指示器 -->
            <div v-if="backendStore.serverState?.useAltSpeed"
                 class="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium ml-2"
                 title="备用速度限制已启用">
              <Icon name="gauge" :size="10" />
              <span>ALT</span>
            </div>
          </div>

          <!-- 连接状态点：固定右下角（顶部不显示时） -->
          <div v-if="!showToolbarConnection" class="absolute right-4 bottom-2" :title="connectionStatus.text">
            <div
              :class="`w-2 h-2 rounded-full ${
                connectionStatus.type === 'success' ? 'bg-green-500' :
                connectionStatus.type === 'warning' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
              }`"
            ></div>
          </div>
        </div>
      </main>
    </div>

    <!-- 添加种子对话框 -->
    <AddTorrentDialog
      :open="showAddDialog"
      @close="showAddDialog = false"
      @add="handleAddTorrent"
    />

    <!-- 列设置对话框 -->
    <ColumnSettingsDialog
      :open="showColumnSettings"
      :columns="columns"
      @close="showColumnSettings = false"
      @toggle-visibility="toggleVisibility"
      @reset="resetToDefaults"
    />

    <!-- 后端设置对话框 -->
    <BackendSettingsDialog
      :open="showBackendSettings"
      @close="showBackendSettings = false; immediateRefresh()"
    />

    <!-- 分类管理对话框 -->
    <CategoryManageDialog
      v-if="showCategoryManage"
      @close="showCategoryManage = false; immediateRefresh()"
    />

    <!-- 标签管理对话框 -->
    <TagManageDialog
      v-if="showTagManage"
      @close="showTagManage = false; immediateRefresh()"
    />

    <!-- 右键菜单 -->
    <TorrentContextMenu
      :show="contextmenuState.show"
      :x="contextmenuState.x"
      :y="contextmenuState.y"
      :hashes="contextmenuState.hashes"
      @close="contextmenuState.show = false"
      @action="handleContextMenuAction"
    />
  </div>
</template>
