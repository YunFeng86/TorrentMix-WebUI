import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { BaseAdapter } from '@/adapter/interface'
import type { Category, ServerState } from '@/adapter/types'

/**
 * 后端全局 Store
 *
 * 职责：
 * - 存储当前激活的 Adapter 实例
 * - 提供后端类型信息
 * - 作为依赖注入容器，解耦 View 层与具体 Adapter
 */
export const useBackendStore = defineStore('backend', () => {
  const adapter = ref<BaseAdapter | null>(null)
  const backendType = ref<'qbit' | 'trans' | null>(null)

  // 分类和标签存储（使用 shallowRef 优化性能）
  const categories = shallowRef<Map<string, Category>>(new Map())
  const tags = shallowRef<string[]>([])
  const serverState = shallowRef<ServerState | null>(null)

  // 是否已初始化
  const isInitialized = computed(() => adapter.value !== null)

  // 是否为 qBittorrent
  const isQbit = computed(() => backendType.value === 'qbit')

  // 是否为 Transmission
  const isTrans = computed(() => backendType.value === 'trans')

  // 后端显示名称
  const backendName = computed(() =>
    backendType.value === 'qbit' ? 'qBittorrent' :
    backendType.value === 'trans' ? 'Transmission' : '种子管理器'
  )

  /**
   * 设置 Adapter 实例
   * @param a - Adapter 实例
   * @param type - 后端类型
   */
  function setAdapter(a: BaseAdapter, type: 'qbit' | 'trans') {
    adapter.value = a
    backendType.value = type
  }

  /**
   * 清除 Adapter（退出登录时使用）
   */
  function clearAdapter() {
    adapter.value = null
    backendType.value = null
    categories.value = new Map()
    tags.value = []
    serverState.value = null
  }

  /**
   * 更新全局数据（分类、标签、服务器状态）
   */
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
    isInitialized,
    isQbit,
    isTrans,
    backendName,
    categories,
    tags,
    serverState,
    setAdapter,
    clearAdapter,
    updateGlobalData
  }
})
