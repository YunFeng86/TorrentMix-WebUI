<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useTorrentStore } from '@/store/torrent'
import { useAuthStore } from '@/store/auth'
import { QbitAdapter } from '@/adapter/qbit'
import TorrentRow from '@/components/torrent/TorrentRow.vue'
import TorrentCard from '@/components/torrent/TorrentCard.vue'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'

const torrentStore = useTorrentStore()
const authStore = useAuthStore()
const adapter = new QbitAdapter()

const selectedHashes = ref<Set<string>>(new Set())
const searchQuery = ref('')
const sidebarCollapsed = ref(false)
const isMobile = ref(window.innerWidth < 768)
let pollTimer: number | null = null

// 监听屏幕尺寸变化
const handleResize = () => {
  isMobile.value = window.innerWidth < 768
  // 移动端自动折叠侧边栏
  if (isMobile.value) {
    sidebarCollapsed.value = true
  }
}

// 过滤器
const stateFilter = ref<'all' | 'downloading' | 'seeding' | 'paused' | 'checking'>('all')

// 统计数据
const stats = computed(() => {
  const torrents = Array.from(torrentStore.torrents.values())
  return {
    total: torrents.length,
    downloading: torrents.filter(t => t.state === 'downloading').length,
    seeding: torrents.filter(t => t.state === 'seeding').length,
    paused: torrents.filter(t => t.state === 'paused').length,
    checking: torrents.filter(t => t.state === 'checking').length,
    dlSpeed: torrents.reduce((sum, t) => sum + t.dlspeed, 0),
    upSpeed: torrents.reduce((sum, t) => sum + t.upspeed, 0)
  }
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

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
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

// 转换为数组并排序
const sortedTorrents = computed(() => {
  return Array.from(filteredTorrents.value.values()).sort((a, b) => {
    // 下载中的优先
    if (a.state === 'downloading' && b.state !== 'downloading') return -1
    if (b.state === 'downloading' && a.state !== 'downloading') return 1
    // 然后按名称排序
    return a.name.localeCompare(b.name)
  })
})

async function poll() {
  try {
    const data = await adapter.fetchList()
    torrentStore.updateTorrents(data)
  } catch (error) {
    console.error('轮询失败:', error)
  }
}

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
  await adapter.pause(Array.from(selectedHashes.value))
  selectedHashes.value.clear()
}

async function handleResume() {
  await adapter.resume(Array.from(selectedHashes.value))
  selectedHashes.value.clear()
}

async function handleDelete() {
  if (!confirm(`确定删除 ${selectedHashes.value.size} 个种子吗？`)) return
  await adapter.delete(Array.from(selectedHashes.value), false)
  selectedHashes.value.clear()
}

function logout() {
  authStore.logout()
  window.location.href = '/login'
}

// 传输速度进度条（全局）
const globalProgress = computed(() => {
  const total = stats.total
  if (total === 0) return 0
  const completed = stats.seeding + stats.paused
  return (completed / total) * 100
})

onMounted(() => {
  poll()
  pollTimer = window.setInterval(poll, 2000)
  window.addEventListener('resize', handleResize)
  handleResize() // 初始化
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  window.removeEventListener('resize', handleResize)
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
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" />
            </svg>
          </div>
          <div class="hidden sm:block">
            <h1 class="text-base font-semibold text-gray-900">种子管理</h1>
            <p class="text-xs text-gray-500">qBittorrent WebUI</p>
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
        <div class="hidden md:flex items-center gap-4">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" />
            </svg>
            <span class="text-sm font-mono text-gray-900">{{ formatSpeed(stats.dlSpeed) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span class="text-sm font-mono text-gray-900">{{ formatSpeed(stats.upSpeed) }}</span>
          </div>
        </div>

        <!-- 用户操作 -->
        <button @click="logout" class="btn text-gray-600 hover:text-gray-900">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
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
        :class="`bg-white border-r border-gray-200 flex flex-col shrink-0 transition-all duration-300 z-50
        ${isMobile 
          ? (sidebarCollapsed ? '-translate-x-full w-64 fixed left-0 top-0 h-full' : 'translate-x-0 w-64 fixed left-0 top-0 h-full')
          : (sidebarCollapsed ? 'w-16' : 'w-64')
        }`"
      >
        <!-- 移动端顶部栏 -->
        <div v-if="isMobile" class="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 class="font-medium text-gray-900">筛选</h2>
          <button @click="sidebarCollapsed = true" class="btn p-2 hover:bg-gray-100">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 桌面端侧边栏头部 -->
        <div v-else class="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 :class="`font-medium text-gray-900 ${sidebarCollapsed ? 'hidden' : ''}`">筛选</h2>
          <button @click="sidebarCollapsed = !sidebarCollapsed" class="btn p-2 hover:bg-gray-100">
            <svg class="w-4 h-4" :class="{ 'rotate-180': sidebarCollapsed }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <!-- 过滤器列表 -->
        <nav class="flex-1 overflow-y-auto p-2">
          <div class="space-y-1">
            <button @click="stateFilter = 'all'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'all' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">全部</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'all' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.total }}</span>
            </button>

            <button @click="stateFilter = 'downloading'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'downloading' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <svg class="w-4 h-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" />
              </svg>
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">下载中</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'downloading' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.downloading }}</span>
            </button>

            <button @click="stateFilter = 'seeding'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'seeding' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <svg class="w-4 h-4 shrink-0 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">做种中</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'seeding' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.seeding }}</span>
            </button>

            <button @click="stateFilter = 'paused'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'paused' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <svg class="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">已暂停</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'paused' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.paused }}</span>
            </button>

            <button @click="stateFilter = 'checking'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 ${stateFilter === 'checking' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`">
              <svg class="w-4 h-4 shrink-0 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">检查中</span>
              <span :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'checking' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.checking }}</span>
            </button>
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
          </div>
        </div>
      </aside>

      <!-- 右侧主内容 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-white">
        <!-- 工具栏 -->
        <div class="border-b border-gray-200 px-4 py-3 flex items-center gap-4 shrink-0">
          <!-- 操作按钮组 -->
          <div class="flex gap-1">
            <button @click="handleResume"
                    :disabled="selectedHashes.size === 0"
                    class="btn p-2 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="开始">
              <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-10V9a3 3 0 01-3 3h-4m-4 0H7a3 3 0 01-3-3V4a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
            <button @click="handlePause"
                    :disabled="selectedHashes.size === 0"
                    class="btn p-2 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="暂停">
              <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <div class="w-px h-8 bg-gray-200 mx-2"></div>
            <button @click="handleDelete"
                    :disabled="selectedHashes.size === 0"
                    class="btn-destructive p-2 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="删除">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          <!-- 选择器 -->
          <div class="flex items-center gap-3">
            <button @click="selectAll" class="text-sm text-gray-600 hover:text-gray-900 transition-colors duration-150">
              {{ selectedHashes.size === sortedTorrents.length && sortedTorrents.length > 0 ? '取消全选' : '全选' }}
            </button>
            <span v-if="selectedHashes.size > 0" class="text-sm text-blue-500 font-medium">
              已选 {{ selectedHashes.size }} 项
            </span>
          </div>

          <!-- 搜索框 -->
          <div class="flex-1 max-w-md ml-auto">
            <div class="relative">
              <svg class="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="搜索种子名称..."
                class="input pl-10 py-2"
              />
            </div>
          </div>
        </div>

        <!-- 种子列表 -->
        <div class="flex-1 overflow-auto">
          <!-- 桌面端表格视图 -->
          <div class="hidden md:block">
            <table class="w-full">
              <thead class="sticky top-0 bg-gray-100 border-b border-gray-200">
                <tr class="text-xs text-gray-600 uppercase tracking-wide">
                  <th class="text-left px-3 py-3 font-medium w-12"></th>
                  <th class="text-left px-3 py-3 font-medium">种子</th>
                  <th class="text-left px-3 py-3 font-medium w-32">进度</th>
                  <th class="text-right px-3 py-3 font-medium w-20">下载</th>
                  <th class="text-right px-3 py-3 font-medium w-20 hidden md:table-cell">上传</th>
                  <th class="text-right px-3 py-3 font-medium w-20 hidden lg:table-cell">剩余</th>
                  <th class="text-right px-3 py-3 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="sortedTorrents.length === 0">
                  <td colspan="7" class="px-4 py-16 text-center">
                    <div class="flex flex-col items-center gap-4">
                      <svg class="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 011 1v2a1 1 0 01-1 1h-1v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8H3a1 1 0 01-1-1V5a1 1 0 011-1h4zM9 6h6V4H9v2z" />
                      </svg>
                      <div class="text-gray-500">
                        <p class="font-medium">{{ searchQuery ? '未找到匹配的种子' : '暂无种子' }}</p>
                        <p class="text-sm mt-1">{{ searchQuery ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
                      </div>
                    </div>
                  </td>
                </tr>
                <TorrentRow
                  v-for="torrent in sortedTorrents"
                  :key="torrent.id"
                  :torrent="torrent"
                  :selected="selectedHashes.has(torrent.id)"
                  @click="toggleSelect(torrent.id)"
                />
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片视图 -->
          <div class="md:hidden p-4">
            <!-- 空状态 -->
            <div v-if="sortedTorrents.length === 0" class="text-center py-16">
              <svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 011 1v2a1 1 0 01-1 1h-1v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8H3a1 1 0 01-1-1V5a1 1 0 011-1h4zM9 6h6V4H9v2z" />
              </svg>
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
                @click="toggleSelect(torrent.id)"
              />
            </div>
          </div>
        </div>

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
  </div>
</template>
