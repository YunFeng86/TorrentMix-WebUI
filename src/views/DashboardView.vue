<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useTorrentStore } from '@/store/torrent'
import { useAuthStore } from '@/store/auth'
import { QbitAdapter } from '@/adapter/qbit'
import TorrentRow from '@/components/torrent/TorrentRow.vue'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'

const torrentStore = useTorrentStore()
const authStore = useAuthStore()
const adapter = new QbitAdapter()

const selectedHashes = ref<Set<string>>(new Set())
const searchQuery = ref('')
const sidebarCollapsed = ref(false)
let pollTimer: number | null = null

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
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-100">
    <!-- 顶部栏 -->
    <header class="bg-gray-900 text-white px-4 py-2 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3">
        <!-- Logo 图标 -->
        <svg class="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <h1 class="font-bold text-lg">qBittorrent WebUI</h1>
        <span class="text-gray-400 text-sm">v4.6.x</span>
      </div>

      <!-- 全局速度显示 -->
      <div class="flex items-center gap-6 text-sm">
        <div class="flex items-center gap-2">
          <span class="text-gray-400">下载:</span>
          <span class="text-green-400 font-mono">{{ formatSpeed(stats.dlSpeed) }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-gray-400">上传:</span>
          <span class="text-blue-400 font-mono">{{ formatSpeed(stats.upSpeed) }}</span>
        </div>
      </div>

      <!-- 右侧操作 -->
      <div class="flex items-center gap-3">
        <button @click="logout" class="text-gray-300 hover:text-white text-sm">
          退出登录
        </button>
      </div>
    </header>

    <!-- 进度条 -->
    <div class="h-1 bg-gray-700">
      <div class="h-full bg-blue-500 transition-all duration-300" :style="{ width: `${globalProgress}%` }"></div>
    </div>

    <!-- 主内容区 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧边栏 -->
      <aside :class="`bg-gray-800 text-gray-300 flex flex-col shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-12' : 'w-56'}`">
        <!-- 折叠按钮 -->
        <button @click="sidebarCollapsed = !sidebarCollapsed" class="p-2 hover:bg-gray-700 self-end">
          <svg class="w-5 h-5" :class="{ 'rotate-180': sidebarCollapsed }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>

        <!-- 传输列表 -->
        <nav class="flex-1 overflow-y-auto py-2">
          <div class="px-2 mb-2">
            <h3 :class="`text-xs font-semibold uppercase tracking-wider mb-2 ${sidebarCollapsed ? 'hidden' : ''}`">传输</h3>

            <button @click="stateFilter = 'all'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-gray-700 transition ${stateFilter === 'all' ? 'bg-gray-700' : ''}`">
              <svg class="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span :class="`truncate ${sidebarCollapsed ? 'hidden' : ''}`">全部 ({{ stats.total }})</span>
            </button>

            <button @click="stateFilter = 'downloading'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-gray-700 transition ${stateFilter === 'downloading' ? 'bg-gray-700' : ''}`">
              <svg class="w-5 h-5 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4 8l-4-4m0 0L8 12m0 0l4-4m4 4V4" />
              </svg>
              <span :class="`truncate ${sidebarCollapsed ? 'hidden' : ''}`">下载中 ({{ stats.downloading }})</span>
            </button>

            <button @click="stateFilter = 'seeding'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-gray-700 transition ${stateFilter === 'seeding' ? 'bg-gray-700' : ''}`">
              <svg class="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span :class="`truncate ${sidebarCollapsed ? 'hidden' : ''}`">做种中 ({{ stats.seeding }})</span>
            </button>

            <button @click="stateFilter = 'completed'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-gray-700 transition`">
              <svg class="w-5 h-5 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span :class="`truncate ${sidebarCollapsed ? 'hidden' : ''}`">已完成</span>
            </button>

            <button @click="stateFilter = 'paused'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-gray-700 transition ${stateFilter === 'paused' ? 'bg-gray-700' : ''}`">
              <svg class="w-5 h-5 text-yellow-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span :class="`truncate ${sidebarCollapsed ? 'hidden' : ''}`">已暂停 ({{ stats.paused }})</span>
            </button>

            <button @click="stateFilter = 'checking'"
                    :class="`w-full flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-gray-700 transition ${stateFilter === 'checking' ? 'bg-gray-700' : ''}`">
              <svg class="w-5 h-5 text-orange-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span :class="`truncate ${sidebarCollapsed ? 'hidden' : ''}`">检查中 ({{ stats.checking }})</span>
            </button>
          </div>
        </nav>

        <!-- 底部统计 -->
        <div :class="`p-3 border-t border-gray-700 text-xs ${sidebarCollapsed ? 'hidden' : ''}`">
          <div class="text-gray-500">
            <span>活跃连接: {{ stats.downloading + stats.seeding }}</span>
          </div>
        </div>
      </aside>

      <!-- 右侧主内容 -->
      <main class="flex-1 flex flex-col overflow-hidden">
        <!-- 工具栏 -->
        <div class="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0">
          <!-- 操作按钮 -->
          <div class="flex gap-2">
            <button @click="handlePause"
                    :disabled="selectedHashes.size === 0"
                    class="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                    title="暂停">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button @click="handleResume"
                    :disabled="selectedHashes.size === 0"
                    class="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                    title="恢复">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 001.555.832V12a1 1 0 001-.555.832z" />
              </svg>
            </button>
            <button @click="handleDelete"
                    :disabled="selectedHashes.size === 0"
                    class="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                    title="删除">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 011-1h2a1 1 0 011 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          <div class="w-px h-6 bg-gray-300"></div>

          <!-- 全选 -->
          <button @click="selectAll" class="text-sm text-gray-600 hover:text-gray-900">
            {{ selectedHashes.size === sortedTorrents.length ? '取消全选' : '全选' }}
          </button>

          <div class="w-px h-6 bg-gray-300"></div>

          <!-- 搜索框 -->
          <div class="flex-1 max-w-md">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索种子..."
              class="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <!-- 选中计数 -->
          <span v-if="selectedHashes.size > 0" class="text-sm text-blue-600 font-medium">
            已选 {{ selectedHashes.size }} 项
          </span>
        </div>

        <!-- 种子列表 -->
        <div class="flex-1 overflow-auto">
          <table class="w-full text-left">
            <thead class="bg-gray-50 sticky top-0">
              <tr class="text-xs text-gray-500 uppercase">
                <th class="px-4 py-2 font-medium w-8"></th>
                <th class="px-4 py-2 font-medium">名称</th>
                <th class="px-4 py-2 font-medium w-24">大小</th>
                <th class="px-4 py-2 font-medium w-48">进度</th>
                <th class="px-4 py-2 font-medium w-24 text-right">下载速度</th>
                <th class="px-4 py-2 font-medium w-24 text-right">上传速度</th>
                <th class="px-4 py-2 font-medium w-24 text-right">剩余时间</th>
                <th class="px-4 py-2 font-medium w-24">状态</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr v-if="sortedTorrents.length === 0">
                <td colspan="9" class="px-4 py-12 text-center text-gray-500">
                  {{ searchQuery ? '没有找到匹配的种子' : '暂无种子' }}
                </td>
              </tr>
              <TorrentRow
                v-for="torrent in sortedTorrents"
                :key="torrent.id"
                :torrent="torrent"
                :selected="selectedHashes.has(torrent.id)"
                @click="toggleSelect(torrent.id)"
                :class="{ 'bg-blue-50': selectedHashes.has(torrent.id) }"
              />
            </tbody>
          </table>
        </div>

        <!-- 底部状态栏 -->
        <div class="bg-white border-t border-gray-200 px-4 py-1.5 text-xs text-gray-500 flex items-center justify-between shrink-0">
          <span>共 {{ sortedTorrents.length }} 个种子</span>
          <span v-if="searchQuery">搜索: {{ searchQuery }}</span>
        </div>
      </main>
    </div>
  </div>
</template>
