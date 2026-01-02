<script setup lang="ts">
import type { UnifiedTorrent } from '@/adapter/types'
import { formatBytes, formatSpeed } from '@/utils/format'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ torrent: UnifiedTorrent; selected: boolean }>()

const emit = defineEmits<{
  click: [event: Event]
}>()

// 处理复选框点击，切换选择状态
function handleCheckboxClick(e: MouseEvent) {
  // 阻止触发整行点击（否则会先选中行再 toggle，导致无法选中只能取消）
  e.stopPropagation()
  // 触发父组件的 toggleSelect 逻辑
  ;(e.currentTarget as HTMLElement).dispatchEvent(new CustomEvent('toggle-select', {
    bubbles: true,
    detail: props.torrent.id
  }))
}

type TorrentState = UnifiedTorrent['state']

// 状态图标映射
const getStateIcon = (state: TorrentState): { name: string; color: 'blue' | 'cyan' | 'gray' | 'orange' | 'purple' | 'red' } => {
  const icons: Record<TorrentState, { name: string; color: 'blue' | 'cyan' | 'gray' | 'orange' | 'purple' | 'red' }> = {
    downloading: { name: 'download', color: 'blue' },
    seeding: { name: 'upload-cloud', color: 'cyan' },
    paused: { name: 'pause-circle', color: 'gray' },
    queued: { name: 'clock', color: 'orange' },
    checking: { name: 'refresh-cw', color: 'purple' },
    error: { name: 'alert-circle', color: 'red' }
  }
  return icons[state]
}

// 计算健康度百分比
const getHealthPercentage = (torrent: UnifiedTorrent): number => {
  const seeds = torrent.numSeeds || 0
  const peers = torrent.numPeers || 0
  const total = seeds + peers

  if (total === 0) return 0
  if (seeds === 0) return Math.min(25, total * 5)  // 无种子时最多25%
  if (seeds >= 10) return 100  // 10个或以上种子时100%

  // 根据种子数和总连接数计算健康度
  const seedRatio = seeds / Math.max(total, 1)
  const seedBonus = Math.min(seeds * 15, 60)  // 每个种子15分，最多60分
  const baseHealth = seedRatio * 40  // 种子比例最多40分

  return Math.min(100, Math.round(baseHealth + seedBonus))
}

// 格式化ETA
const formatETA = (eta: number, progress: number, state: TorrentState): string => {
  // 已完成或错误状态显示无限
  if (progress >= 1.0 || state === 'error') return '∞'

  // 无限时间判断：-1、负数、非数值、或超过1年
  if (eta === -1 || eta <= 0 || !isFinite(eta) || eta >= 86400 * 365) return '∞'

  const seconds = Math.floor(eta)
  if (seconds < 60) return `${seconds}秒`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时`

  const days = Math.floor(hours / 24)
  return `${days}天`
}
</script>

<template>
  <!-- div-based table row, compatible with virtual scrolling -->
  <div
    class="torrent-row cursor-pointer group flex items-center"
    :class="{ 'bg-blue-50 border-blue-200': selected }"
    @click="$emit('click', $event)"
  >
    <!-- 选择器 -->
    <div class="col-checkbox flex items-center justify-center px-3 py-2 shrink-0">
      <input
        type="checkbox"
        :checked="selected"
        @click="handleCheckboxClick"
        class="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-2 cursor-pointer transition-all duration-150"
      />
    </div>

    <!-- 种子名称与状态 -->
    <div class="col-torrent px-3 py-2 min-w-0 flex-1">
      <div class="flex items-center gap-3">
        <!-- 状态图标 -->
        <div class="flex-shrink-0">
          <Icon :name="getStateIcon(torrent.state).name" :color="getStateIcon(torrent.state).color" :size="16" />
        </div>

        <!-- 名称与基本信息 -->
        <div class="min-w-0 flex-1">
          <div class="font-medium text-gray-900 truncate text-sm leading-5">
            {{ torrent.name }}
          </div>
          <div class="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
            <span class="font-mono">{{ formatBytes(torrent.size) }}</span>
            <span class="hidden sm:inline">•</span>
            <span class="hidden sm:inline">比率 {{ torrent.ratio.toFixed(2) }}</span>
            <span class="hidden md:inline">•</span>
            <span class="hidden md:inline">{{ torrent.numSeeds || 0 }}/{{ torrent.numPeers || 0 }} 连接</span>
            <span class="hidden lg:inline">•</span>
            <span class="hidden lg:inline">健康度 {{ getHealthPercentage(torrent) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 进度条 -->
    <div class="col-progress px-3 py-2 w-32 shrink-0">
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs font-mono text-gray-600">
            {{ (torrent.progress * 100).toFixed(1) }}%
          </span>
          <span class="text-xs text-gray-500">
            {{ formatBytes(torrent.size * torrent.progress) }}
          </span>
        </div>
        <div class="progress-bar">
          <div
            class="progress-fill"
            :class="{
              'bg-cyan-500': torrent.progress >= 1,
              'bg-blue-500': torrent.progress > 0 && torrent.progress < 1,
              'bg-gray-300': torrent.progress === 0
            }"
            :style="{ width: `${Math.max(torrent.progress * 100, 2)}%` }"
          />
        </div>
      </div>
    </div>

    <!-- 下载速度 -->
    <div class="col-dl-speed px-3 py-2 w-20 text-right shrink-0">
      <div class="space-y-0.5">
        <div class="text-sm font-mono text-gray-900">
          {{ formatSpeed(torrent.dlspeed) }}
        </div>
        <div class="text-xs text-gray-500">
          ↓
        </div>
      </div>
    </div>

    <!-- 上传速度 (PC端) -->
    <div class="col-ul-speed px-3 py-2 w-20 text-right shrink-0 hidden md:flex">
      <div class="space-y-0.5">
        <div class="text-sm font-mono text-gray-900">
          {{ formatSpeed(torrent.upspeed) }}
        </div>
        <div class="text-xs text-gray-500">
          ↑
        </div>
      </div>
    </div>

    <!-- ETA (大屏端) -->
    <div class="col-eta px-3 py-2 w-16 text-right shrink-0 hidden lg:flex items-center justify-end">
      <div class="text-sm font-mono text-gray-600">
        {{ formatETA(torrent.eta, torrent.progress, torrent.state) }}
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="w-16 px-3 py-2"></div>
  </div>
</template>

<style scoped>
/* Border between rows */
.torrent-row {
  border-bottom: 1px solid #e5e7eb;
}

.torrent-row:last-child {
  border-bottom: none;
}

.torrent-row:hover {
  background-color: rgba(0, 0, 0, 0.02);
}

/* Progress bar styles */
.progress-bar {
  position: relative;
  height: 4px;
  background-color: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
}
</style>
