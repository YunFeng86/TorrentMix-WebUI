import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { BaseAdapter } from '@/adapter/interface'
import type { Category, ServerState } from '@/adapter/types'
import type { BackendVersion } from '@/adapter/detect'

/**
 * 后端全局 Store
 */
export const useBackendStore = defineStore('backend', () => {
  const adapter = ref<BaseAdapter | null>(null)
  const backendType = ref<'qbit' | 'trans' | null>(null)
  const version = ref<BackendVersion | null>(null)

  const categories = shallowRef<Map<string, Category>>(new Map())
  const tags = shallowRef<string[]>([])
  const serverState = shallowRef<ServerState | null>(null)

  const isInitialized = computed(() => adapter.value !== null)
  const isQbit = computed(() => backendType.value === 'qbit')
  const isTrans = computed(() => backendType.value === 'trans')
  const backendName = computed(() =>
    backendType.value === 'qbit' ? 'qBittorrent' :
    backendType.value === 'trans' ? 'Transmission' : '种子管理器'
  )

  const versionDisplay = computed(() => {
    if (!version.value) return null
    const v = version.value
    if (v.version === 'unknown') return '版本未知'
    return `${backendName.value} ${v.version}`
  })

  function setAdapter(a: BaseAdapter, v: BackendVersion) {
    adapter.value = a
    backendType.value = v.type === 'unknown' ? 'qbit' : v.type
    version.value = v
  }

  function clearAdapter() {
    adapter.value = null
    backendType.value = null
    version.value = null
    categories.value = new Map()
    tags.value = []
    serverState.value = null
  }

  function updateGlobalData(data: {
    categories?: Map<string, Category>
    tags?: string[]
    serverState?: ServerState | null
  }) {
    if (data.categories !== undefined) {
      categories.value = new Map(data.categories)
    }
    if (data.tags !== undefined) {
      tags.value = [...data.tags]
    }
    if (data.serverState !== undefined) {
      serverState.value = data.serverState
    }
  }

  return {
    adapter,
    backendType,
    version,
    isInitialized,
    isQbit,
    isTrans,
    backendName,
    versionDisplay,
    categories,
    tags,
    serverState,
    setAdapter,
    clearAdapter,
    updateGlobalData
  }
})
