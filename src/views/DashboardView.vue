<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useTorrentStore } from '@/store/torrent'
import { QbitAdapter } from '@/adapter/qbit'
import TorrentRow from '@/components/torrent/TorrentRow.vue'

const torrentStore = useTorrentStore()
const adapter = new QbitAdapter()

const selectedHashes = ref<Set<string>>(new Set())
let pollTimer: number | null = null

async function poll() {
  try {
    const data = await adapter.fetchList()
    torrentStore.updateTorrents(data)
  } catch (error) {
    console.error('轮询失败:', error)
    // 静默失败，不清空现有数据
  }
}

function toggleSelect(hash: string) {
  if (selectedHashes.value.has(hash)) {
    selectedHashes.value.delete(hash)
  } else {
    selectedHashes.value.add(hash)
  }
}

async function handlePause() {
  await adapter.pause(Array.from(selectedHashes.value))
  selectedHashes.value.clear()
  await poll()
}

async function handleResume() {
  await adapter.resume(Array.from(selectedHashes.value))
  selectedHashes.value.clear()
  await poll()
}

async function handleDelete() {
  if (!confirm(`确定删除 ${selectedHashes.value.size} 个种子？`)) return
  await adapter.delete(Array.from(selectedHashes.value), false)
  selectedHashes.value.clear()
  await poll()
}

onMounted(() => {
  poll()
  pollTimer = window.setInterval(poll, 2000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="p-4">
    <!-- 操作栏 -->
    <div class="mb-4 flex gap-2 flex-wrap">
      <button @click="handlePause"
              :disabled="selectedHashes.size === 0"
              class="px-4 py-2 bg-yellow-500 text-white rounded disabled:opacity-50">
        暂停 ({{ selectedHashes.size }})
      </button>
      <button @click="handleResume"
              :disabled="selectedHashes.size === 0"
              class="px-4 py-2 bg-green-500 text-white rounded disabled:opacity-50">
        恢复 ({{ selectedHashes.size }})
      </button>
      <button @click="handleDelete"
              :disabled="selectedHashes.size === 0"
              class="px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50">
        删除 ({{ selectedHashes.size }})
      </button>
    </div>

    <!-- 种子表格 -->
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead class="bg-gray-100">
          <tr>
            <th class="px-4 py-2">名称</th>
            <th class="px-4 py-2 hidden md:table-cell">大小</th>
            <th class="px-4 py-2">进度</th>
            <th class="px-4 py-2">下载</th>
            <th class="px-4 py-2 hidden md:table-cell">上传</th>
            <th class="px-4 py-2 hidden lg:table-cell">剩余</th>
            <th class="px-4 py-2">状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="torrentStore.torrents.size === 0">
            <td colspan="7" class="px-4 py-8 text-center text-gray-500">
              暂无种子
            </td>
          </tr>
          <TorrentRow
            v-for="[hash, torrent] in torrentStore.torrents"
            :key="hash"
            :torrent="torrent"
            @click="toggleSelect(hash)"
            :class="{ 'bg-blue-50': selectedHashes.has(hash) }"
          />
        </tbody>
      </table>
    </div>
  </div>
</template>
