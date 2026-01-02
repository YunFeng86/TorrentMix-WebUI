<script setup lang="ts">
import type { UnifiedTorrent } from '@/adapter/types'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'

defineProps<{ torrent: UnifiedTorrent; selected: boolean }>()

// 状态图标组件
const getStateIcon = (state: string) => {
  const icons = {
    downloading: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12',
    seeding: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
    paused: 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z',
    queued: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    checking: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    error: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z'
  }
  return icons[state] || icons.error
}

// 状态颜色
const getStateColor = (state: string) => {
  const colors = {
    downloading: 'text-blue-500',
    seeding: 'text-cyan-500',
    paused: 'text-gray-400',
    queued: 'text-orange-500',
    checking: 'text-purple-500',
    error: 'text-red-500'
  }
  return colors[state] || colors.error
}
</script>

<template>
  <tr class="table-row cursor-pointer group" :class="{ 'bg-blue-50 border-blue-200': selected }">
    <!-- 选择器 -->
    <td class="w-12 px-3 py-2">
      <div class="flex items-center justify-center">
        <input 
          type="checkbox" 
          :checked="selected" 
          class="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-2 cursor-pointer transition-all duration-150" 
        />
      </div>
    </td>

    <!-- 种子名称与状态 -->
    <td class="px-3 py-2 min-w-0">
      <div class="flex items-center gap-3">
        <!-- 状态图标 -->
        <div class="flex-shrink-0">
          <svg class="w-4 h-4" :class="getStateColor(torrent.state)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="getStateIcon(torrent.state)" />
          </svg>
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
    </td>

    <!-- 进度条 (高密度) -->
    <td class="px-3 py-2 w-32">
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
    </td>

    <!-- 下载速度 -->
    <td class="px-3 py-2 w-20 text-right">
      <div class="space-y-0.5">
        <div class="text-sm font-mono text-gray-900">
          {{ formatSpeed(torrent.dlspeed) }}
        </div>
        <div class="text-xs text-gray-500">
          ↓
        </div>
      </div>
    </td>

    <!-- 上传速度 (PC端) -->
    <td class="px-3 py-2 w-20 text-right hidden md:table-cell">
      <div class="space-y-0.5">
        <div class="text-sm font-mono text-gray-900">
          {{ formatSpeed(torrent.upspeed) }}
        </div>
        <div class="text-xs text-gray-500">
          ↑
        </div>
      </div>
    </td>

    <!-- ETA (大屏端) -->
    <td class="px-3 py-2 w-20 text-right hidden lg:table-cell">
      <div class="text-sm font-mono text-gray-600">
        {{ formatDuration(torrent.eta) }}
      </div>
    </td>

    <!-- 操作按钮 (移动端隐藏，hover显示) -->
    <td class="px-3 py-2 w-16">
      <div class="flex opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <button class="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors duration-150" title="更多操作">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
        </button>
      </div>
    </td>
  </tr>
</template>
