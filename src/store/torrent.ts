import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { UnifiedTorrent } from '@/adapter/types'

export const useTorrentStore = defineStore('torrent', () => {
  // shallowRef 避免深度响应式，性能优化
  const torrents = shallowRef<Map<string, UnifiedTorrent>>(new Map())

  // Copy-on-Write：创建新 Map 触发响应式
  function updateTorrents(newData: Map<string, UnifiedTorrent>) {
    torrents.value = new Map(newData)
  }

  function getTorrent(hash: string) {
    return torrents.value.get(hash)
  }

  function getTorrentsArray() {
    return Array.from(torrents.value.values())
  }

  return { torrents, updateTorrents, getTorrent, getTorrentsArray }
})
