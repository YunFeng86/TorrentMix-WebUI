<script setup lang="ts">
import type { UnifiedTorrent } from '@/adapter/types'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'

defineProps<{ torrent: UnifiedTorrent; selected: boolean }>()
</script>

<template>
  <tr class="hover:bg-gray-50 cursor-pointer transition-colors">
    <!-- 复选框列 -->
    <td class="px-4 py-3 w-8">
      <input type="checkbox" :checked="selected" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
    </td>
    <td class="px-4 py-3">
      <div class="font-medium text-gray-900 truncate max-w-md">{{ torrent.name }}</div>
    </td>
    <!-- PC 端显示 -->
    <td class="px-4 py-3 text-gray-600 hidden md:table-cell">{{ formatBytes(torrent.size) }}</td>
    <td class="px-4 py-3">
      <div class="flex items-center gap-2">
        <div class="flex-1 min-w-0">
          <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="{
                'bg-green-500': torrent.progress >= 1,
                'bg-blue-500': torrent.progress > 0 && torrent.progress < 1,
                'bg-gray-400': torrent.progress === 0
              }"
              :style="{ width: `${torrent.progress * 100}%` }"
            />
          </div>
        </div>
        <span class="text-xs text-gray-600 tabular-nums w-12 text-right">{{ (torrent.progress * 100).toFixed(1) }}%</span>
      </div>
    </td>
    <td class="px-4 py-3 text-gray-600 tabular-nums">{{ formatSpeed(torrent.dlspeed) }}</td>
    <!-- PC 端显示 -->
    <td class="px-4 py-3 text-gray-600 tabular-nums hidden md:table-cell">{{ formatSpeed(torrent.upspeed) }}</td>
    <td class="px-4 py-3 text-gray-600 tabular-nums hidden lg:table-cell">{{ formatDuration(torrent.eta) }}</td>
    <td class="px-4 py-3">
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
            :class="{
              'bg-green-100 text-green-800': torrent.state === 'downloading',
              'bg-blue-100 text-blue-800': torrent.state === 'seeding',
              'bg-gray-100 text-gray-800': torrent.state === 'paused',
              'bg-yellow-100 text-yellow-800': torrent.state === 'queued',
              'bg-orange-100 text-orange-800': torrent.state === 'checking',
              'bg-red-100 text-red-800': torrent.state === 'error'
            }">
        {{ torrent.state === 'downloading' ? '下载中' :
           torrent.state === 'seeding' ? '做种中' :
           torrent.state === 'paused' ? '已暂停' :
           torrent.state === 'queued' ? '队列中' :
           torrent.state === 'checking' ? '检查中' : '错误' }}
      </span>
    </td>
  </tr>
</template>
