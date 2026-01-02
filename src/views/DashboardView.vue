<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import { useTorrentStore } from '@/store/torrent'
import { useAuthStore } from '@/store/auth'
import { useBackendStore } from '@/store/backend'
import { usePolling } from '@/composables/usePolling'
import { AuthError } from '@/api/client'
import type { UnifiedTorrent } from '@/adapter/types'
import type { AddTorrentParams } from '@/adapter/interface'
import TorrentRow from '@/components/torrent/TorrentRow.vue'
import TorrentCard from '@/components/torrent/TorrentCard.vue'
import AddTorrentDialog from '@/components/AddTorrentDialog.vue'
import VirtualTorrentList from '@/components/VirtualTorrentList.vue'
import TorrentBottomPanel from '@/components/TorrentBottomPanel.vue'
import Icon from '@/components/Icon.vue'
import { formatSpeed, formatBytes } from '@/utils/format'

// 虚拟滚动阈值：超过 200 个种子时启用虚拟滚动（性能优化）
const VIRTUAL_SCROLL_THRESHOLD = 200

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
const handleResize = () => {
  isMobile.value = window.innerWidth < 768
  // 移动端自动折叠侧边栏
  if (isMobile.value) {
    sidebarCollapsed.value = true
  }
}

// 过滤器
const stateFilter = ref<'all' | 'downloading' | 'seeding' | 'paused' | 'checking' | 'queued' | 'error'>('all')
const categoryFilter = ref<string>('all')
const tagFilter = ref<string>('all')

// 统计数据 - 一次遍历完成所有统计（Good Taste：消除不必要的多次遍历）
const stats = computed(() => {
  const torrents = Array.from(torrentStore.torrents.values())

  // 单次遍历完成所有统计
  const result = {
    total: torrents.length,
    downloading: 0,
    seeding: 0,
    paused: 0,
    checking: 0,
    dlSpeed: 0,
    upSpeed: 0
  }

  for (const t of torrents) {
    // 状态计数
    if (t.state === 'downloading') result.downloading++
    else if (t.state === 'seeding') result.seeding++
    else if (t.state === 'paused') result.paused++
    else if (t.state === 'checking') result.checking++

    // 速度累加
    result.dlSpeed += t.dlspeed
    result.upSpeed += t.upspeed
  }

  return result
})

// 过滤后的种子
const filteredTorrents = computed(() => {
  let result = torrentStore.torrents

  // 状态过滤
  if (stateFilter.value !== 'all') {
    const filtered = new Map<string, UnifiedTorrent>()
    for (const [hash, torrent] of result) {
      if (torrent.state === stateFilter.value) {
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
type SortField = 'name' | 'size' | 'progress' | 'dlSpeed' | 'upSpeed' | 'addedTime' | 'ratio'
type SortDirection = 'asc' | 'desc'

const sortField = ref<SortField>('name')
const sortDirection = ref<SortDirection>('asc')
const showSortMenu = ref(false)

// 排序字段标签映射
const sortFieldLabels: Record<SortField, string> = {
  name: '名称',
  size: '大小',
  progress: '进度',
  dlSpeed: '下载速度',
  upSpeed: '上传速度',
  addedTime: '添加时间',
  ratio: '分享率'
}

// 切换排序字段
function setSortField(field: SortField) {
  if (sortField.value === field) {
    // 同一字段切换方向
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = 'desc'  // 新字段默认降序（数值类）
    if (field === 'name') sortDirection.value = 'asc'  // 名称默认升序
  }
  showSortMenu.value = false
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
  }

  return sortDirection.value === 'asc' ? compare : -compare
}

// 转换为数组并排序
const sortedTorrents = computed(() => {
  return Array.from(filteredTorrents.value.values()).sort(compareTorrents)
})

// 是否使用虚拟滚动（超过阈值时启用）
const useVirtualScroll = computed(() => sortedTorrents.value.length >= VIRTUAL_SCROLL_THRESHOLD)

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

// 批量操作：重新校验选中项
async function handleRecheckSelected() {
  if (selectedHashes.value.size === 0) return
  const hashes = Array.from(selectedHashes.value)
  try {
    for (const hash of hashes) {
      await adapter.value.recheck(hash)
    }
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
    for (const hash of hashes) {
      await adapter.value.forceStart(hash, true)
    }
    await immediateRefresh()
  } catch (err) {
    console.error('[Dashboard] Force start failed:', err)
    alert(err instanceof Error ? err.message : '强制开始失败')
  }
}

onMounted(() => {
  startPolling()
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeyDown)
  handleResize() // 初始化
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-50">
    <!-- 顶部栏 -->
    <header class="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-4">
        <!-- 移动端菜单按钮 -->
        <button
          v-if="isMobile"
          @click="sidebarCollapsed = false"
          class="btn p-2 hover:bg-gray-100 md:hidden"
        >
          <Icon name="menu" :size="20" />
        </button>

        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <Icon name="download-cloud" color="white" :size="20" class="text-white" />
          </div>
          <div class="hidden sm:block">
            <h1 class="text-base font-semibold text-gray-900">种子管理</h1>
            <p class="text-xs text-gray-500">{{ backendStore.backendName }} WebUI</p>
          </div>
        </div>

        <!-- 状态统计卡片 -->
        <div class="hidden lg:flex items-center gap-4 ml-8">
          <div class="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
            <div class="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span class="text-sm text-gray-700 font-medium">{{ stats.downloading }}</span>
            <span class="text-xs text-gray-500">下载中</span>
          </div>
          <div class="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
            <div class="w-2 h-2 bg-cyan-500 rounded-full"></div>
            <span class="text-sm text-gray-700 font-medium">{{ stats.seeding }}</span>
            <span class="text-xs text-gray-500">做种中</span>
          </div>
        </div>
      </div>

      <!-- 速度显示 -->
      <div class="flex items-center gap-6">
        <!-- 全局服务器状态 (大屏幕显示) -->
        <div v-if="backendStore.serverState" class="hidden xl:flex items-center gap-4 text-xs text-gray-500">
          <!-- 磁盘剩余空间 -->
          <div class="flex items-center gap-1" :title="`磁盘剩余: ${formatBytes(backendStore.serverState.freeSpaceOnDisk)}`">
            <Icon name="hard-drive" :size="14" />
            <span class="font-mono">{{ formatBytes(backendStore.serverState.freeSpaceOnDisk) }}</span>
          </div>
          <!-- 全局 Peer 连接数 -->
          <div class="flex items-center gap-1" :title="`全局 Peer 连接: ${backendStore.serverState.peers}`">
            <Icon name="users" :size="14" />
            <span class="font-mono">{{ backendStore.serverState.peers }}</span>
          </div>
          <!-- 全局限速 (如果设置了) -->
          <div v-if="backendStore.serverState.dlRateLimit > 0 || backendStore.serverState.upRateLimit > 0" class="flex items-center gap-1">
            <Icon name="gauge" :size="14" />
            <span class="font-mono">
              {{ backendStore.serverState.dlRateLimit > 0 ? formatSpeed(backendStore.serverState.dlRateLimit) : '∞' }}/
              {{ backendStore.serverState.upRateLimit > 0 ? formatSpeed(backendStore.serverState.upRateLimit) : '∞' }}
            </span>
          </div>
          <!-- Alt 速率状态 -->
          <div v-if="backendStore.serverState.useAltSpeed" class="flex items-center gap-1 text-orange-500" title="临时限速已启用">
            <Icon name="timer" :size="14" />
            <span>限速中</span>
          </div>
        </div>

        <div class="hidden md:flex items-center gap-4">
          <div class="flex items-center gap-2">
            <Icon name="download" color="blue" :size="16" />
            <span class="text-sm font-mono text-gray-900">{{ formatSpeed(stats.dlSpeed) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <Icon name="upload-cloud" color="cyan" :size="16" />
            <span class="text-sm font-mono text-gray-900">{{ formatSpeed(stats.upSpeed) }}</span>
          </div>
        </div>

        <!-- 用户操作 -->
        <!-- 连接状态指示器 -->
        <div class="hidden sm:flex items-center gap-2" :title="connectionStatus.text">
          <div
            :class="`w-2 h-2 rounded-full ${
              connectionStatus.type === 'success' ? 'bg-green-500' :
              connectionStatus.type === 'warning' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
            }`"
          ></div>
          <span class="text-xs text-gray-500">{{ connectionStatus.text }}</span>
        </div>

        <button @click="logout" class="btn text-gray-600 hover:text-gray-900">
          <Icon name="log-out" :size="16" />
        </button>
      </div>
    </header>

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
          <h2 :class="`font-medium text-gray-900 ${sidebarCollapsed ? 'hidden' : ''}`">筛选</h2>
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
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'all' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.total }}</span>
            </button>

            <button @click="stateFilter = 'downloading'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'downloading' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="download" color="blue" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">下载中</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'downloading' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.downloading }}</span>
            </button>

            <button @click="stateFilter = 'seeding'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'seeding' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="upload-cloud" color="cyan" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">做种中</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'seeding' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.seeding }}</span>
            </button>

            <button @click="stateFilter = 'paused'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'paused' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="pause-circle" color="gray" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">已暂停</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'paused' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.paused }}</span>
            </button>

            <button @click="stateFilter = 'checking'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'checking' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="refresh-cw" color="purple" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">检查中</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'checking' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.checking }}</span>
            </button>

            <button @click="stateFilter = 'queued'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'queued' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="clock" color="orange" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">队列中</span>
            </button>

            <button @click="stateFilter = 'error'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'error' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <Icon name="alert-circle" color="red" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">错误</span>
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

        <!-- 底部统计 (移动隐藏) -->
        <div :class="`p-4 border-t border-gray-200 hidden lg:block ${sidebarCollapsed ? 'hidden' : ''}`">
          <div class="text-xs text-gray-500 space-y-1">
            <div class="flex justify-between">
              <span>活跃连接</span>
              <span class="font-mono">{{ stats.downloading + stats.seeding }}</span>
            </div>
            <div class="flex justify-between">
              <span>总共</span>
              <span class="font-mono">{{ stats.total }}</span>
            </div>
            <div v-if="backendStore.versionDisplay" class="flex justify-between pt-2 mt-2 border-t border-gray-200">
              <span class="text-gray-400">{{ backendStore.versionDisplay }}</span>
            </div>
            <div v-else class="flex items-center gap-1 pt-2 mt-2 border-t border-gray-200 text-amber-600">
              <Icon name="alert-triangle" :size="12" />
              <span>版本检测失败</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧主内容 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-white">
        <!-- 工具栏 -->
        <div class="border-b border-gray-200 px-4 py-3 flex items-center gap-4 shrink-0">
          <!-- 操作按钮组 -->
          <div class="flex gap-1">
            <!-- 添加种子按钮 -->
            <button @click="showAddDialog = true"
                    class="btn p-2 bg-black text-white hover:bg-gray-800 transition-all duration-150"
                    title="添加种子">
              <Icon name="plus" :size="16" />
            </button>

            <button @click="handleResume"
                    :disabled="selectedHashes.size === 0"
                    class="btn p-2 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="开始">
              <Icon name="play" color="blue" :size="16" />
            </button>
            <button @click="handlePause"
                    :disabled="selectedHashes.size === 0"
                    class="btn p-2 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="暂停">
              <Icon name="pause" color="gray" :size="16" />
            </button>
            <button @click="handleDelete"
                    :disabled="selectedHashes.size === 0"
                    class="btn p-2 hover:bg-red-50 text-red-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:text-gray-400 transition-all duration-150"
                    title="删除">
              <Icon name="trash-2" :size="16" />
            </button>
            <div class="w-px h-8 bg-gray-200 mx-2"></div>
            <!-- 更多操作（选中后可用） -->
            <button @click="handleRecheckSelected"
                    :disabled="selectedHashes.size === 0"
                    class="btn p-2 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="重新校验">
              <Icon name="refresh-cw" :size="16" />
            </button>
            <button @click="handleForceStartSelected"
                    :disabled="selectedHashes.size === 0"
                    class="btn p-2 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="强制开始">
              <Icon name="zap" :size="16" />
            </button>
          </div>

          <!-- 选择器 & 排序 -->
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-3">
              <button @click="selectAll" class="text-sm text-gray-600 hover:text-gray-900 transition-colors duration-150">
                {{ selectedHashes.size === sortedTorrents.length && sortedTorrents.length > 0 ? '取消全选' : '全选' }}
              </button>
              <span v-if="selectedHashes.size > 0" class="text-sm text-blue-500 font-medium">
                已选 {{ selectedHashes.size }} 项
              </span>
            </div>

            <!-- 排序下拉选择器 -->
            <div class="relative">
              <button
                @click="setSortField('name')"
                class="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors"
              >
                <Icon name="arrow-up-down" :size="14" />
                <span>{{ sortFieldLabels[sortField] }}</span>
                <Icon name="chevron-up" :size="12" :class="{ 'rotate-180': sortDirection === 'desc' }" />
              </button>

              <!-- 排序下拉菜单 -->
              <Transition
                enter-active-class="transition-opacity duration-150"
                enter-from-class="opacity-0"
                enter-to-class="opacity-100"
                leave-active-class="transition-opacity duration-150"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0"
              >
                <div
                  v-if="showSortMenu"
                  v-click-outside="() => showSortMenu = false"
                  class="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-20 min-w-[160px]"
                >
                  <button
                    v-for="(label, field) in sortFieldLabels"
                    :key="field"
                    @click="setSortField(field as SortField)"
                    :class="`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between ${
                      sortField === field ? 'bg-gray-100 font-medium' : ''
                    }`"
                  >
                    <span>{{ label }}</span>
                    <Icon v-if="sortField === field" name="check" :size="14" class="text-blue-500" />
                  </button>
                </div>
              </Transition>
            </div>
          </div>

          <!-- 搜索框 -->
          <div class="flex-1 max-w-md ml-auto">
            <div class="relative">
              <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                v-model="searchQuery"
                type="text"
                placeholder="搜索种子名称..."
                class="input pl-10 py-2"
              />
            </div>
          </div>
        </div>

        <!-- 种子列表容器：flex-1 自动填充剩余空间 -->
        <div class="flex-1 overflow-auto min-h-0">
          <!-- 桌面端列表视图 -->
          <div class="hidden md:block h-full">
            <!-- 虚拟滚动（大量种子时） -->
            <div v-if="useVirtualScroll" class="h-full flex flex-col">
              <!-- 表头 -->
              <div class="shrink-0 bg-gray-100 border-b border-gray-200 flex items-center text-xs text-gray-600 uppercase tracking-wide">
                <div class="w-12 px-3 py-3"></div>
                <div class="flex-1 px-3 py-3">种子</div>
                <div class="w-32 px-3 py-3">进度</div>
                <div class="w-20 px-3 py-3 text-right">下载</div>
                <div class="w-20 px-3 py-3 text-right hidden md:flex">上传</div>
                <div class="w-20 px-3 py-3 text-right hidden lg:flex">剩余</div>
                <div class="w-16 px-3 py-3"></div>
              </div>
              <!-- 虚拟列表：直接成为滚动容器 -->
              <VirtualTorrentList
                v-if="sortedTorrents.length > 0"
                :torrents="sortedTorrents"
                :selected-hashes="selectedHashes"
                @click="selectTorrentForDetail"
                @toggle-select="toggleSelect"
                @action="handleTorrentAction"
              />
              <div v-else class="px-4 py-16 text-center flex-1 flex items-center justify-center">
                <div class="flex flex-col items-center gap-4">
                  <Icon name="inbox" :size="48" class="text-gray-300" />
                  <div class="text-gray-500">
                    <p class="font-medium">{{ searchQuery ? '未找到匹配的种子' : '暂无种子' }}</p>
                    <p class="text-sm mt-1">{{ searchQuery ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- 普通列表（少量种子时） -->
            <div v-else class="h-full flex flex-col">
              <!-- 表头 -->
              <div class="sticky top-0 bg-gray-100 border-b border-gray-200 z-10 shrink-0 flex items-center text-xs text-gray-600 uppercase tracking-wide">
                <div class="w-12 px-3 py-3"></div>
                <div class="flex-1 px-3 py-3">种子</div>
                <div class="w-32 px-3 py-3">进度</div>
                <div class="w-20 px-3 py-3 text-right">下载</div>
                <div class="w-20 px-3 py-3 text-right hidden md:flex">上传</div>
                <div class="w-20 px-3 py-3 text-right hidden lg:flex">剩余</div>
                <div class="w-16 px-3 py-3"></div>
              </div>
              <!-- 列表内容 -->
              <div v-if="sortedTorrents.length === 0" class="px-4 py-16 text-center">
                <div class="flex flex-col items-center gap-4">
                  <Icon name="inbox" :size="48" class="text-gray-300" />
                  <div class="text-gray-500">
                    <p class="font-medium">{{ searchQuery ? '未找到匹配的种子' : '暂无种子' }}</p>
                    <p class="text-sm mt-1">{{ searchQuery ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
                  </div>
                </div>
              </div>
              <TorrentRow
                v-for="torrent in sortedTorrents"
                :key="torrent.id"
                :torrent="torrent"
                :selected="selectedHashes.has(torrent.id)"
                @click="selectTorrentForDetail(torrent.id, $event)"
                @toggle-select="toggleSelect($event.detail)"
                @action="handleTorrentAction"
              />
            </div>
          </div>

          <!-- 移动端卡片视图 -->
          <div class="md:hidden p-4">
            <!-- 空状态 -->
            <div v-if="sortedTorrents.length === 0" class="text-center py-16">
              <Icon name="inbox" :size="64" class="text-gray-300 mx-auto mb-4" />
              <div class="text-gray-500">
                <p class="font-medium text-base">{{ searchQuery ? '未找到匹配的种子' : '暂无种子' }}</p>
                <p class="text-sm mt-1">{{ searchQuery ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
              </div>
            </div>

            <!-- 卡片网格 -->
            <div class="space-y-3">
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
        <div class="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 flex items-center justify-between shrink-0 bg-gray-50">
          <div class="flex items-center gap-4">
            <span>共 {{ sortedTorrents.length }} 个种子</span>
            <span v-if="searchQuery" class="px-2 py-1 bg-gray-200 rounded text-gray-700">搜索: {{ searchQuery }}</span>
          </div>
          <div class="hidden md:flex items-center gap-4 font-mono">
            <span>↓ {{ formatSpeed(stats.dlSpeed) }}</span>
            <span>↑ {{ formatSpeed(stats.upSpeed) }}</span>
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
  </div>
</template>
