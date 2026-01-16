<script setup lang="ts">
import { ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { UnifiedTorrent } from '@/adapter/types'
import TorrentCard from '@/components/torrent/TorrentCard.vue'

interface Props {
  torrents: UnifiedTorrent[]
  selectedHashes: Set<string>
  scrollElement?: HTMLElement | null
}

interface Emits {
  (e: 'click', hash: string): void
  (e: 'toggle-select', hash: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const internalScrollRef = ref<HTMLElement | null>(null)

const CARD_HEIGHT_PX = 176
const CARD_GAP_PX = 12 // space-y-3 ~= 0.75rem
const ROW_SIZE_PX = CARD_HEIGHT_PX + CARD_GAP_PX

function handleToggleSelect(event: Event) {
  const customEvent = event as CustomEvent<string>
  emit('toggle-select', customEvent.detail)
}

const virtualizer = useVirtualizer({
  get count() {
    return props.torrents.length
  },
  getScrollElement: () => (props.scrollElement !== undefined ? props.scrollElement : internalScrollRef.value),
  estimateSize: () => ROW_SIZE_PX,
  overscan: 4,
})
</script>

<template>
  <!-- If not providing scrollElement, this component becomes the scroll container -->
  <div
    v-if="scrollElement === undefined"
    ref="internalScrollRef"
    class="h-full overflow-auto"
  >
    <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
      <div
        v-for="virtualRow in virtualizer.getVirtualItems()"
        :key="String(virtualRow.key)"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
        }"
      >
        <TorrentCard
          :torrent="torrents[virtualRow.index]!"
          :selected="selectedHashes.has(torrents[virtualRow.index]!.id)"
          class="w-full h-[176px] overflow-hidden"
          @click="emit('click', torrents[virtualRow.index]!.id)"
          @toggle-select="handleToggleSelect"
        />
      </div>
    </div>
  </div>

  <!-- External scroll container provided -->
  <div v-else :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
    <div
      v-for="virtualRow in virtualizer.getVirtualItems()"
      :key="String(virtualRow.key)"
      :style="{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
      }"
    >
      <TorrentCard
        :torrent="torrents[virtualRow.index]!"
        :selected="selectedHashes.has(torrents[virtualRow.index]!.id)"
        class="w-full h-[176px] overflow-hidden"
        @click="emit('click', torrents[virtualRow.index]!.id)"
        @toggle-select="handleToggleSelect"
      />
    </div>
  </div>
</template>

