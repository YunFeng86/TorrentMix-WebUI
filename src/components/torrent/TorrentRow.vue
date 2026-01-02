<script setup lang="ts">
import type { UnifiedTorrent } from '@/adapter/types'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'
import Icon from '@/components/Icon.vue'

defineProps<{ torrent: UnifiedTorrent; selected: boolean }>()

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
</script>

<template>
  <!-- div-based table row, compatible with virtual scrolling -->
  <div
    class="torrent-row cursor-pointer group flex items-center"
    :class="{ 'bg-blue-50 border-blue-200': selected }"
  >
    <!-- 选择器 -->
    <div class="col-checkbox flex items-center justify-center px-3 py-2 shrink-0">
      <input
        type="checkbox"
        :checked="selected"
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
            <span class="md:hidden">•</span>
            <span class="md:hidden">{{ formatSpeed(torrent.dlspeed) }} ↓</span>
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
    <div class="col-eta px-3 py-2 w-20 text-right shrink-0 hidden lg:flex items-center justify-center">
      <div class="text-sm font-mono text-gray-600">
        {{ formatDuration(torrent.eta) }}
      </div>
    </div>

    <!-- 操作按钮 (移动端隐藏，hover显示) -->
    <div class="col-actions px-3 py-2 w-16 shrink-0">
      <div class="flex opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <button class="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors duration-150" title="更多操作">
          <Icon name="more-vertical" :size="16" />
        </button>
      </div>
    </div>
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
