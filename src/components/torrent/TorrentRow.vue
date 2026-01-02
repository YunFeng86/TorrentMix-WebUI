<script setup lang="ts">
import type { UnifiedTorrent } from '@/adapter/types'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'

defineProps<{ torrent: UnifiedTorrent }>()
</script>

<template>
  <tr class="border-b hover:bg-gray-50">
    <td class="px-4 py-3">{{ torrent.name }}</td>
    <!-- PC 端显示 -->
    <td class="px-4 py-3 hidden md:table-cell">{{ formatBytes(torrent.size) }}</td>
    <td class="px-4 py-3">{{ (torrent.progress * 100).toFixed(1) }}%</td>
    <td class="px-4 py-3">{{ formatSpeed(torrent.dlspeed) }}</td>
    <!-- PC 端显示 -->
    <td class="px-4 py-3 hidden md:table-cell">{{ formatSpeed(torrent.upspeed) }}</td>
    <td class="px-4 py-3 hidden lg:table-cell">{{ formatDuration(torrent.eta) }}</td>
    <td class="px-4 py-3">
      <span class="px-2 py-1 rounded text-xs"
            :class="{
              'bg-green-100 text-green-800': torrent.state === 'downloading',
              'bg-blue-100 text-blue-800': torrent.state === 'seeding',
              'bg-gray-100 text-gray-800': torrent.state === 'paused',
              'bg-yellow-100 text-yellow-800': torrent.state === 'queued',
              'bg-red-100 text-red-800': torrent.state === 'error'
            }">
        {{ torrent.state }}
      </span>
    </td>
  </tr>
</template>
