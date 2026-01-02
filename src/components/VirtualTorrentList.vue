<script setup lang="ts">
import { ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { UnifiedTorrent } from '@/adapter/types'
import TorrentRow from './torrent/TorrentRow.vue'

interface Props {
  torrents: UnifiedTorrent[]
  selectedHashes: Set<string>
}

interface Emits {
  (e: 'click', hash: string, event: Event): void
  (e: 'toggle-select', hash: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 处理行点击：传递事件对象
function handleRowClick(hash: string, event: Event) {
  emit('click', hash, event)
}

// 处理复选框点击：切换选择
function handleToggleSelect(hash: string) {
  emit('toggle-select', hash)
}

const parentRef = ref<HTMLElement | null>(null)

// 虚拟滚动配置（使用 getter 函数使 count 响应式）
const virtualizer = useVirtualizer({
  get count() {
    return props.torrents.length
  },
  getScrollElement: () => parentRef.value,
  estimateSize: () => 60,  // 每行高度
  overscan: 5
})
</script>

<template>
  <div ref="parentRef" class="h-full overflow-auto">
    <div
      :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }"
    >
      <TorrentRow
        v-for="virtualRow in virtualizer.getVirtualItems()"
        :key="String(virtualRow.key)"
        :torrent="torrents[virtualRow.index]!"
        :selected="selectedHashes.has(torrents[virtualRow.index]!.id)"
        @click="handleRowClick(torrents[virtualRow.index]!.id, $event)"
        @toggle-select="handleToggleSelect($event.detail)"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`
        }"
      />
    </div>
  </div>
</template>
