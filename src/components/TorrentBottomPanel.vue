<script setup lang="ts">
import { ref, watch } from 'vue'
import { useBackendStore } from '@/store/backend'
import type { UnifiedTorrentDetail, UnifiedTorrent, TorrentFile } from '@/adapter/types'
import Icon from '@/components/Icon.vue'
import { formatBytes, formatSpeed } from '@/utils/format'
import { useDragResize } from '@/composables/useDragResize'

interface Props {
  torrent: UnifiedTorrent | null
  visible: boolean
  height: number
}

interface Emits {
  (e: 'close'): void
  (e: 'resize', height: number): void
  (e: 'action', action: string, hash: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const backendStore = useBackendStore()

// 详情数据
const detail = ref<UnifiedTorrentDetail | null>(null)
const loading = ref(false)
const error = ref('')

// 当前 Tab
const activeTab = ref<'overview' | 'files' | 'trackers' | 'peers'>('overview')

// 使用拖拽 composable（核心性能优化）
const {
  isResizing,
  panelStyle,
  startResize,
  commitHeight,
  setHeight
} = useDragResize({
  initialHeight: props.height,
  minHeight: 200,
  maxHeight: 800
})

// 监听外部高度变化（非拖拽时）
watch(() => props.height, (newHeight) => {
  if (!isResizing.value) {
    setHeight(newHeight)
  }
})

// 监听拖拽状态变化，拖拽结束时提交高度
watch(isResizing, (resizing, wasResizing) => {
  if (wasResizing && !resizing) {
    emit('resize', commitHeight())
  }
})

// 获取详情
async function fetchDetail() {
  if (!props.torrent?.id || !backendStore.adapter) {
    detail.value = null
    return
  }

  loading.value = true
  error.value = ''
  try {
    detail.value = await backendStore.adapter.fetchDetail(props.torrent.id)
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to fetch detail:', err)
    error.value = err instanceof Error ? err.message : '获取详情失败'
    detail.value = null
  } finally {
    loading.value = false
  }
}

// 监听种子变化重新获取详情
watch(() => props.torrent?.id, () => {
  if (props.visible && props.torrent) {
    fetchDetail()
  }
})

// 监听面板显示状态变化
watch(() => props.visible, (visible) => {
  if (visible && props.torrent) {
    fetchDetail()
    activeTab.value = 'overview'
  }
})

// 处理操作
function handleAction(action: string) {
  if (props.torrent) {
    emit('action', action, props.torrent.id)
  }
}

// 计算健康度
function getHealthStatus(torrent: UnifiedTorrent) {
  const seeds = torrent.numSeeds || 0
  const peers = torrent.numPeers || 0
  
  if (seeds >= 10) return { text: '优秀', color: 'text-green-600', bg: 'bg-green-100' }
  if (seeds >= 5) return { text: '良好', color: 'text-blue-600', bg: 'bg-blue-100' }
  if (seeds >= 1) return { text: '一般', color: 'text-yellow-600', bg: 'bg-yellow-100' }
  if (peers > 0) return { text: '较差', color: 'text-orange-600', bg: 'bg-orange-100' }
  return { text: '无连接', color: 'text-red-600', bg: 'bg-red-100' }
}

// ETA格式化
function formatETA(eta: number): string {
  // 无限时间判断：-1、负数、非数值、或超过1年
  if (eta === -1 || eta <= 0 || !isFinite(eta) || eta >= 86400 * 365) return '∞'

  const seconds = Math.floor(eta)
  if (seconds < 60) return `${seconds}秒`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时`

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  if (remainingHours > 0) {
    return `${days}天${remainingHours}小时`
  }
  return `${days}天`
}

// Tracker 状态映射
const trackerStatusMap: Record<string, { text: string; class: string; icon: string }> = {
  working: { text: '工作中', class: 'bg-green-100 text-green-700', icon: '●' },
  updating: { text: '更新中', class: 'bg-yellow-100 text-yellow-700', icon: '○' },
  not_working: { text: '未工作', class: 'bg-red-100 text-red-700', icon: '●' },
  disabled: { text: '已禁用', class: 'bg-gray-100 text-gray-600', icon: '○' }
}

// 文件优先级映射
const priorityMap: Record<string, { text: string; class: string }> = {
  high: { text: '高', class: 'text-red-600' },
  normal: { text: '普通', class: 'text-gray-600' },
  low: { text: '低', class: 'text-blue-600' },
  do_not_download: { text: '跳过', class: 'text-gray-400 line-through' }
}

// 文件树节点类型
interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  progress?: number
  priority?: string
  children?: FileTreeNode[]
  expanded?: boolean
  level: number
}

// 文件夹展开状态管理
const expandedFolders = ref<Set<string>>(new Set())

// 切换文件夹展开状态
function toggleFolder(path: string) {
  if (expandedFolders.value.has(path)) {
    expandedFolders.value.delete(path)
  } else {
    expandedFolders.value.add(path)
  }
  // 触发响应式更新
  expandedFolders.value = new Set(expandedFolders.value)
}

// 构建文件树结构
function buildFileTree(files: TorrentFile[]): FileTreeNode[] {
  if (!files || files.length === 0) return []

  const root: FileTreeNode[] = []
  const folderMap = new Map<string, FileTreeNode>()

  for (const file of files) {
    const parts = file.name.split('/')
    let currentPath = ''
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isFile = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (isFile) {
        // 文件节点
        currentLevel.push({
          name: part,
          path: currentPath,
          type: 'file',
          size: file.size,
          progress: file.progress,
          priority: file.priority,
          level: i
        })
      } else {
        // 文件夹节点
        let folder = folderMap.get(currentPath)
        if (!folder) {
          folder = {
            name: part,
            path: currentPath,
            type: 'folder',
            children: [],
            expanded: expandedFolders.value.has(currentPath),
            level: i
          }
          folderMap.set(currentPath, folder)
          currentLevel.push(folder)
        }
        currentLevel = folder.children!
      }
    }
  }

  return root
}

// 计算文件夹的总大小和进度
function calculateFolderStats(node: FileTreeNode): { size: number; progress: number } {
  if (node.type === 'file') {
    return { size: node.size || 0, progress: node.progress || 0 }
  }

  let totalSize = 0
  let totalProgress = 0

  for (const child of node.children || []) {
    const stats = calculateFolderStats(child)
    totalSize += stats.size
    totalProgress += stats.progress * stats.size
  }

  return {
    size: totalSize,
    progress: totalSize > 0 ? totalProgress / totalSize : 0
  }
}
</script>

<template>
  <!-- 底部详情面板 -->
  <div
    v-show="visible"
    class="border-t border-gray-200 bg-white flex flex-col"
    :style="panelStyle"
  >
    <!-- 顶部拖拽调整条 -->
    <div
      @mousedown="startResize"
      class="h-1 bg-gray-200 hover:bg-gray-300 cursor-ns-resize flex-shrink-0 relative group"
      :class="{ 'bg-blue-400': isResizing }"
    >
      <div class="absolute inset-x-0 top-0 h-2 -translate-y-1 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <div class="h-0.5 w-12 bg-gray-400 rounded"></div>
      </div>
    </div>

    <!-- 面板头部 -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
      <div class="flex items-center gap-4 flex-1 min-w-0">
        <!-- 种子基本信息 -->
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <Icon 
            :name="torrent?.state === 'downloading' ? 'download' : 'upload-cloud'" 
            :color="torrent?.state === 'downloading' ? 'blue' : 'cyan'" 
            :size="20" 
          />
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold text-gray-900 truncate">{{ torrent?.name || '选择一个种子查看详情' }}</h3>
            <div v-if="torrent" class="flex items-center gap-4 text-sm text-gray-500 mt-1">
              <span>{{ formatBytes(torrent.size) }}</span>
              <span>进度 {{ (torrent.progress * 100).toFixed(1) }}%</span>
              <span>比率 {{ torrent.ratio.toFixed(2) }}</span>
              <div 
                class="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                :class="getHealthStatus(torrent)"
              >
                {{ getHealthStatus(torrent).text }}
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 切换 -->
        <nav class="flex gap-1 p-1 bg-gray-100 rounded-lg">
          <button
            v-for="tab in [
              { key: 'overview', label: '概览', icon: 'bar-chart-3' },
              { key: 'files', label: '文件', icon: 'file' },
              { key: 'trackers', label: '服务器', icon: 'server' },
              { key: 'peers', label: 'Peers', icon: 'users' }
            ] as const"
            :key="tab.key"
            @click="activeTab = tab.key"
            :class="[
              'flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            ]"
          >
            <Icon :name="tab.icon" :size="14" />
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <!-- 操作按钮 -->
      <div class="flex items-center gap-2 ml-4">
        <button
          v-if="torrent"
          @click="handleAction(torrent.state === 'paused' ? 'resume' : 'pause')"
          class="btn p-2 hover:bg-gray-100"
          :title="torrent.state === 'paused' ? '开始' : '暂停'"
        >
          <Icon :name="torrent.state === 'paused' ? 'play' : 'pause'" :size="16" />
        </button>

        <button
          @click="emit('close')"
          class="btn p-2 hover:bg-gray-100"
          title="关闭详情面板"
        >
          <Icon name="x" :size="16" />
        </button>
      </div>
    </div>

    <!-- 面板内容 -->
    <div class="flex-1 overflow-hidden">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex items-center justify-center h-full">
        <div class="flex items-center gap-3 text-gray-500">
          <Icon name="loader-2" :size="20" class="animate-spin" />
          <span>加载详情中...</span>
        </div>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="flex items-center justify-center h-full">
        <div class="text-center">
          <Icon name="alert-circle" color="red" :size="24" class="mx-auto mb-2" />
          <p class="text-red-600 font-medium">{{ error }}</p>
          <button @click="fetchDetail" class="btn mt-3 text-sm">重试</button>
        </div>
      </div>

      <!-- 无种子选择 -->
      <div v-else-if="!torrent" class="flex items-center justify-center h-full">
        <div class="text-center text-gray-500">
          <Icon name="mouse-pointer-click" :size="24" class="mx-auto mb-3 text-gray-300" />
          <p>点击上方种子列表中的任意种子查看详情</p>
        </div>
      </div>

      <!-- 详情内容 -->
      <div v-else-if="detail" class="h-full overflow-auto">
        <!-- 概览 Tab -->
        <div v-if="activeTab === 'overview'" class="p-4 space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- 传输统计 -->
            <div class="space-y-4">
              <h4 class="font-semibold text-gray-900 flex items-center gap-2">
                <Icon name="activity" :size="16" />
                传输统计
              </h4>
              <div class="bg-gray-50 rounded-lg p-4 space-y-3">
                <div class="flex justify-between">
                  <span class="text-gray-600">下载速度</span>
                  <span class="font-mono font-medium">{{ formatSpeed(torrent.dlspeed) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">上传速度</span>
                  <span class="font-mono font-medium">{{ formatSpeed(torrent.upspeed) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">已下载</span>
                  <span class="font-mono font-medium">{{ formatBytes(torrent.size * torrent.progress) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">剩余时间</span>
                  <span class="font-mono font-medium">{{ torrent.eta ? formatETA(torrent.eta) : '∞' }}</span>
                </div>
              </div>
            </div>

            <!-- 连接统计 -->
            <div class="space-y-4">
              <h4 class="font-semibold text-gray-900 flex items-center gap-2">
                <Icon name="wifi" :size="16" />
                连接统计
              </h4>
              <div class="bg-gray-50 rounded-lg p-4 space-y-3">
                <div class="flex justify-between">
                  <span class="text-gray-600">种子数量</span>
                  <span class="font-mono font-medium">{{ torrent.numSeeds || 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">下载者</span>
                  <span class="font-mono font-medium">{{ torrent.numPeers || 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">总连接</span>
                  <span class="font-mono font-medium">{{ (torrent.numSeeds || 0) + (torrent.numPeers || 0) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">健康状态</span>
                  <span 
                    class="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                    :class="getHealthStatus(torrent)"
                  >
                    {{ getHealthStatus(torrent).text }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 进度条详细信息 -->
          <div class="space-y-4">
            <h4 class="font-semibold text-gray-900 flex items-center gap-2">
              <Icon name="trending-up" :size="16" />
              下载进度
            </h4>
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="flex justify-between text-sm text-gray-600 mb-2">
                <span>{{ (torrent.progress * 100).toFixed(2) }}% 完成</span>
                <span>{{ formatBytes(torrent.size * torrent.progress) }} / {{ formatBytes(torrent.size) }}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-3">
                <div
                  class="bg-gradient-to-r from-blue-500 to-cyan-500 h-3 rounded-full transition-all duration-300"
                  :style="{ width: `${Math.max(torrent.progress * 100, 1)}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 文件 Tab -->
        <div v-else-if="activeTab === 'files'" class="h-full flex flex-col">
          <!-- 表头 -->
          <div class="flex items-center px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600 shrink-0">
            <div class="flex-1 min-w-0">文件名</div>
            <div class="w-20 text-right">大小</div>
            <div class="w-24 text-right">进度</div>
            <div class="w-14 text-center">优先级</div>
          </div>

          <!-- 文件树列表 -->
          <div class="flex-1 overflow-auto">
            <template v-for="node in buildFileTree(detail.files)" :key="node.path">
              <!-- 文件夹节点 -->
              <div v-if="node.type === 'folder'">
                <div
                  @click="toggleFolder(node.path)"
                  class="flex items-center px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 cursor-pointer text-sm"
                  :style="{ paddingLeft: `${8 + node.level * 16}px` }"
                >
                  <Icon
                    :name="expandedFolders.has(node.path) ? 'chevron-down' : 'chevron-right'"
                    :size="12"
                    class="text-gray-400 shrink-0 mr-1"
                  />
                  <Icon name="folder" :size="14" class="text-yellow-500 shrink-0 mr-1.5" />
                  <span class="truncate text-gray-700 flex-1">{{ node.name }}</span>
                  <span class="font-mono text-xs text-gray-500">
                    {{ formatBytes(calculateFolderStats(node).size) }}
                  </span>
                  <div class="w-24 px-2 shrink-0 ml-2">
                    <div class="flex items-center gap-1.5">
                      <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                        <div
                          class="bg-blue-500 h-1 rounded transition-all"
                          :style="{ width: `${calculateFolderStats(node).progress * 100}%` }"
                        />
                      </div>
                      <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                        {{ (calculateFolderStats(node).progress * 100).toFixed(0) }}%
                      </span>
                    </div>
                  </div>
                </div>

                <!-- 递归渲染子节点 -->
                <template v-if="expandedFolders.has(node.path)">
                  <template v-for="child in node.children" :key="child.path">
                    <!-- 子文件夹 -->
                    <div v-if="child.type === 'folder'">
                      <div
                        @click="toggleFolder(child.path)"
                        class="flex items-center px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 cursor-pointer text-sm"
                        :style="{ paddingLeft: `${8 + child.level * 16}px` }"
                      >
                        <Icon
                          :name="expandedFolders.has(child.path) ? 'chevron-down' : 'chevron-right'"
                          :size="12"
                          class="text-gray-400 shrink-0 mr-1"
                        />
                        <Icon name="folder" :size="14" class="text-yellow-500 shrink-0 mr-1.5" />
                        <span class="truncate text-gray-700 flex-1">{{ child.name }}</span>
                        <span class="font-mono text-xs text-gray-500">
                          {{ formatBytes(calculateFolderStats(child).size) }}
                        </span>
                        <div class="w-24 px-2 shrink-0 ml-2">
                          <div class="flex items-center gap-1.5">
                            <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                              <div
                                class="bg-blue-500 h-1 rounded transition-all"
                                :style="{ width: `${calculateFolderStats(child).progress * 100}%` }"
                              />
                            </div>
                            <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                              {{ (calculateFolderStats(child).progress * 100).toFixed(0) }}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <!-- 继续递归子文件夹 -->
                      <template v-if="expandedFolders.has(child.path)">
                        <template v-for="grandchild in child.children" :key="grandchild.path">
                          <!-- 文件 -->
                          <div
                            v-if="grandchild.type === 'file'"
                            class="flex items-center px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 text-sm"
                            :style="{ paddingLeft: `${8 + grandchild.level * 16}px` }"
                          >
                            <span class="w-3.5 shrink-0"></span>
                            <Icon name="file" :size="14" class="text-gray-400 shrink-0 mr-1.5" />
                            <span class="truncate text-gray-900 flex-1">{{ grandchild.name }}</span>
                            <span class="font-mono text-xs text-gray-600">
                              {{ formatBytes(grandchild.size!) }}
                            </span>
                            <div class="w-24 px-2 shrink-0 ml-2">
                              <div class="flex items-center gap-1.5">
                                <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                                  <div
                                    class="bg-blue-500 h-1 rounded transition-all"
                                    :style="{ width: `${grandchild.progress! * 100}%` }"
                                  />
                                </div>
                                <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                                  {{ (grandchild.progress! * 100).toFixed(0) }}%
                                </span>
                              </div>
                            </div>
                            <span class="text-xs font-medium w-14 text-center shrink-0 ml-2" :class="priorityMap[grandchild.priority!]?.class || 'text-gray-600'">
                              {{ priorityMap[grandchild.priority!]?.text || grandchild.priority }}
                            </span>
                          </div>
                        </template>
                      </template>
                    </div>

                    <!-- 文件节点（直接子节点） -->
                    <div
                      v-else
                      class="flex items-center px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 text-sm"
                      :style="{ paddingLeft: `${8 + child.level * 16}px` }"
                    >
                      <span class="w-3.5 shrink-0"></span>
                      <Icon name="file" :size="14" class="text-gray-400 shrink-0 mr-1.5" />
                      <span class="truncate text-gray-900 flex-1">{{ child.name }}</span>
                      <span class="font-mono text-xs text-gray-600">
                        {{ formatBytes(child.size!) }}
                      </span>
                      <div class="w-24 px-2 shrink-0 ml-2">
                        <div class="flex items-center gap-1.5">
                          <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                            <div
                              class="bg-blue-500 h-1 rounded transition-all"
                              :style="{ width: `${child.progress! * 100}%` }"
                            />
                          </div>
                          <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                            {{ (child.progress! * 100).toFixed(0) }}%
                          </span>
                        </div>
                      </div>
                      <span class="text-xs font-medium w-14 text-center shrink-0 ml-2" :class="priorityMap[child.priority!]?.class || 'text-gray-600'">
                        {{ priorityMap[child.priority!]?.text || child.priority }}
                      </span>
                    </div>
                  </template>
                </template>
              </div>

              <!-- 顶级文件节点（无文件夹） -->
              <div
                v-else
                class="flex items-center px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 text-sm"
                :style="{ paddingLeft: `${8 + node.level * 16}px` }"
              >
                <span class="w-3.5 shrink-0"></span>
                <Icon name="file" :size="14" class="text-gray-400 shrink-0 mr-1.5" />
                <span class="truncate text-gray-900 flex-1">{{ node.name }}</span>
                <span class="font-mono text-xs text-gray-600">
                  {{ formatBytes(node.size!) }}
                </span>
                <div class="w-24 px-2 shrink-0 ml-2">
                  <div class="flex items-center gap-1.5">
                    <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                      <div
                        class="bg-blue-500 h-1 rounded transition-all"
                        :style="{ width: `${node.progress! * 100}%` }"
                      />
                    </div>
                    <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                      {{ (node.progress! * 100).toFixed(0) }}%
                    </span>
                  </div>
                </div>
                <span class="text-xs font-medium w-14 text-center shrink-0 ml-2" :class="priorityMap[node.priority!]?.class || 'text-gray-600'">
                  {{ priorityMap[node.priority!]?.text || node.priority }}
                </span>
              </div>
            </template>
          </div>

          <!-- 底部统计 -->
          <div class="px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 shrink-0">
            {{ detail.files.length }} 个文件
          </div>
        </div>

        <!-- 服务器 Tab -->
        <div v-else-if="activeTab === 'trackers'" class="h-full flex flex-col">
          <!-- 表头 -->
          <div class="flex items-center px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600 shrink-0">
            <div class="flex-1 min-w-0">Tracker</div>
            <div class="w-16 text-center">状态</div>
            <div class="w-10 text-right">Peers</div>
            <div class="w-8 text-right">Tier</div>
          </div>

          <!-- Tracker 列表 -->
          <div class="flex-1 overflow-auto">
            <div
              v-for="(tracker, index) in detail.trackers"
              :key="index"
              class="flex items-center px-3 py-2 hover:bg-gray-50 border-b border-gray-100 text-sm"
            >
              <!-- URL -->
              <div class="flex-1 min-w-0 pr-3">
                <span class="truncate font-mono text-gray-900 text-xs block">
                  {{ tracker.url }}
                </span>
                <span v-if="tracker.msg" class="truncate text-gray-500 text-[10px] block">
                  {{ tracker.msg }}
                </span>
              </div>

              <!-- 状态 -->
              <div class="w-16 text-center shrink-0">
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                  :class="trackerStatusMap[tracker.status]?.class || 'bg-gray-100 text-gray-600'"
                >
                  <span class="text-[8px]">{{ trackerStatusMap[tracker.status]?.icon || '○' }}</span>
                  <span>{{ trackerStatusMap[tracker.status]?.text || tracker.status }}</span>
                </span>
              </div>

              <!-- Peers -->
              <div class="w-10 text-right font-mono text-xs text-gray-600 shrink-0">
                {{ tracker.peers }}
              </div>

              <!-- Tier -->
              <div class="w-8 text-right text-xs text-gray-600 shrink-0">
                {{ tracker.tier }}
              </div>
            </div>
          </div>

          <!-- 底部统计 -->
          <div class="px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 shrink-0">
            {{ detail.trackers.length }} 个 Tracker
          </div>
        </div>

        <!-- Peers Tab -->
        <div v-else-if="activeTab === 'peers'" class="h-full flex flex-col">
          <!-- 表头 -->
          <div class="flex items-center px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600 shrink-0">
            <div class="w-28">地址</div>
            <div class="flex-1 min-w-0">客户端</div>
            <div class="w-16 text-right">进度</div>
            <div class="w-20 text-right">下载</div>
            <div class="w-20 text-right">上传</div>
          </div>

          <!-- Peer 列表 -->
          <div class="flex-1 overflow-auto">
            <div
              v-for="(peer, index) in detail.peers"
              :key="index"
              class="flex items-center px-3 py-2 hover:bg-gray-50 border-b border-gray-100 text-sm"
            >
              <!-- IP:Port -->
              <div class="w-28 pr-2 shrink-0">
                <span class="font-mono text-gray-900 truncate text-xs block">
                  {{ peer.ip }}:{{ peer.port }}
                </span>
              </div>

              <!-- 客户端 -->
              <div class="flex-1 min-w-0 pr-3">
                <span class="truncate text-gray-700 text-xs block">
                  {{ peer.client || 'Unknown' }}
                </span>
              </div>

              <!-- 进度 -->
              <div class="w-16 text-right shrink-0">
                <div class="flex items-center justify-end gap-1.5">
                  <div class="w-10 bg-gray-200 rounded h-1 shrink-0">
                    <div
                      class="bg-blue-500 h-1 rounded transition-all"
                      :style="{ width: `${peer.progress * 100}%` }"
                    />
                  </div>
                  <span class="text-[10px] font-mono text-gray-600 w-7 text-right shrink-0">
                    {{ (peer.progress * 100).toFixed(0) }}%
                  </span>
                </div>
              </div>

              <!-- 下载速度 -->
              <div class="w-20 text-right font-mono text-xs shrink-0">
                <span :class="peer.dlSpeed > 0 ? 'text-blue-600' : 'text-gray-400'">
                  {{ formatSpeed(peer.dlSpeed) }}
                </span>
              </div>

              <!-- 上传速度 -->
              <div class="w-20 text-right font-mono text-xs shrink-0">
                <span :class="peer.upSpeed > 0 ? 'text-cyan-600' : 'text-gray-400'">
                  {{ formatSpeed(peer.upSpeed) }}
                </span>
              </div>
            </div>
          </div>

          <!-- 底部统计 -->
          <div class="px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 shrink-0">
            {{ detail.peers.length }} 个连接
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 确保拖拽调整时有合适的视觉反馈 */
.cursor-ns-resize {
  cursor: ns-resize;
}

/* 防止拖拽时文本被选中 */
.cursor-ns-resize * {
  user-select: none;
}
</style>