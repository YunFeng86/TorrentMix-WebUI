import { computed, reactive, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { UnifiedTorrent } from '@/adapter/types'
import type { BaseAdapter, FetchListResult } from '@/adapter/interface'
import { useBackendStore } from '@/store/backend'
import { useTorrentStore } from '@/store/torrent'

// 不要让状态散落在各处
export interface TorrentUIState {
  selection: Set<string>
  sortBy: keyof UnifiedTorrent
  sortOrder: 'asc' | 'desc'
  filter: string
  viewMode: 'list' | 'card'
}

// Dashboard 的状态筛选（保留现有 UI 语义）
export type StateFilter =
  | 'all'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'paused-completed'
  | 'paused-incomplete'
  | 'checking'
  | 'queued'
  | 'error'

export type TorrentAction =
  | 'pause'
  | 'resume'
  | 'delete'
  | 'recheck'
  | 'reannounce'
  | 'forceStart'
  | 'force-start'

function getDefaultViewMode(): TorrentUIState['viewMode'] {
  if (typeof window === 'undefined') return 'list'
  return window.innerWidth < 768 ? 'card' : 'list'
}

function normalizeEta(eta: number): number {
  // -1 表示无限；排序时当作 Infinity 处理
  if (eta === -1) return Number.POSITIVE_INFINITY
  return eta
}

export function useTorrentContext() {
  const torrentStore = useTorrentStore()
  const backendStore = useBackendStore()

  const adapter = computed<BaseAdapter>(() => {
    if (!backendStore.adapter) {
      throw new Error('[useTorrentContext] Backend adapter not initialized.')
    }
    return backendStore.adapter
  })

  const uiState = reactive<TorrentUIState>({
    selection: new Set(),
    sortBy: 'name',
    sortOrder: 'asc',
    filter: '',
    viewMode: getDefaultViewMode(),
  })

  // ===== Filters =====
  const stateFilter = ref<StateFilter>('all')
  const categoryFilter = ref<string>('all')
  const tagFilter = ref<string>('all')

  // 搜索防抖：避免每次 keypress 都全量过滤/排序
  const debouncedFilter = ref('')
  const updateFilter = useDebounceFn((value: string) => {
    debouncedFilter.value = value
  }, 300)
  watch(() => uiState.filter, (val) => updateFilter(val))

  // ===== Selection =====
  function toggleSelect(hash: string) {
    if (uiState.selection.has(hash)) uiState.selection.delete(hash)
    else uiState.selection.add(hash)
  }

  function clearSelection() {
    uiState.selection.clear()
  }

  function removeFromSelection(hashes: string[]) {
    for (const h of hashes) uiState.selection.delete(h)
  }

  // ===== Sort =====
  const sortKeyByColumnId: Record<string, keyof UnifiedTorrent> = {
    name: 'name',
    progress: 'progress',
    dlSpeed: 'dlspeed',
    upSpeed: 'upspeed',
    eta: 'eta',
    size: 'size',
    ratio: 'ratio',
    addedTime: 'addedTime',
  }

  function toggleSortByColumn(columnId: string) {
    const key = sortKeyByColumnId[columnId]
    if (!key) return

    if (uiState.sortBy === key) {
      uiState.sortOrder = uiState.sortOrder === 'asc' ? 'desc' : 'asc'
      return
    }

    uiState.sortBy = key
    uiState.sortOrder = key === 'name' ? 'asc' : 'desc'
  }

  function getSortIconForColumn(columnId: string): string {
    const key = sortKeyByColumnId[columnId]
    if (!key) return ''
    if (uiState.sortBy !== key) return ''
    return uiState.sortOrder === 'asc' ? '↑' : '↓'
  }

  function compareTorrents(a: UnifiedTorrent, b: UnifiedTorrent): number {
    // UX: 下载中的任务对用户最关键，任何排序条件下都优先置顶（保持旧行为）
    if (a.state === 'downloading' && b.state !== 'downloading') return -1
    if (b.state === 'downloading' && a.state !== 'downloading') return 1

    const key = uiState.sortBy
    let compare = 0

    if (key === 'name') {
      compare = a.name.localeCompare(b.name, 'zh-CN')
    } else if (key === 'eta') {
      compare = normalizeEta(a.eta) - normalizeEta(b.eta)
    } else {
      const av = a[key]
      const bv = b[key]
      if (typeof av === 'number' && typeof bv === 'number') compare = av - bv
      else compare = String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN')
    }

    return uiState.sortOrder === 'asc' ? compare : -compare
  }

  // ===== Derived =====
  const filteredTorrents = computed(() => {
    let result: Map<string, UnifiedTorrent> = torrentStore.torrents

    // 状态过滤（支持暂停的二级分类）
    if (stateFilter.value !== 'all') {
      const filtered = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of result) {
        if (torrent.state === stateFilter.value) filtered.set(hash, torrent)
        else if (stateFilter.value === 'paused-completed' && torrent.state === 'paused' && torrent.progress >= 1.0) {
          filtered.set(hash, torrent)
        } else if (stateFilter.value === 'paused-incomplete' && torrent.state === 'paused' && torrent.progress < 1.0) {
          filtered.set(hash, torrent)
        }
      }
      result = filtered
    }

    // 分类过滤
    if (categoryFilter.value !== 'all') {
      const filtered = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of result) {
        if (torrent.category === categoryFilter.value) filtered.set(hash, torrent)
      }
      result = filtered
    }

    // 标签过滤
    if (tagFilter.value !== 'all') {
      const filtered = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of result) {
        if (torrent.tags?.includes(tagFilter.value)) filtered.set(hash, torrent)
      }
      result = filtered
    }

    // 搜索过滤（使用防抖后的搜索词）
    if (debouncedFilter.value) {
      const query = debouncedFilter.value.toLowerCase()
      const filtered = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of result) {
        if (torrent.name.toLowerCase().includes(query)) filtered.set(hash, torrent)
      }
      result = filtered
    }

    return result
  })

  const sortedTorrents = computed(() =>
    Array.from(filteredTorrents.value.values()).sort(compareTorrents)
  )

  // ===== Data refresh =====
  async function refreshList(): Promise<FetchListResult> {
    const result = await adapter.value.fetchList()
    torrentStore.updateTorrents(result.torrents)
    backendStore.updateGlobalData({
      categories: result.categories,
      tags: result.tags,
      serverState: result.serverState,
    })
    return result
  }

  function getTorrentName(hash: string): string {
    return torrentStore.torrents.get(hash)?.name || hash
  }

  function confirmDelete(hashes: string[]): { deleteFiles: boolean } | null {
    const count = hashes.length
    if (count === 0) return null

    const names = hashes
      .map(h => torrentStore.torrents.get(h)?.name)
      .filter(Boolean)
      .slice(0, 3)

    const nameList = names.join('、')
    const moreText = count > 3 ? `等 ${count} 个种子` : `${count} 个种子`

    const deleteFiles = confirm(
      `是否同时删除下载文件？\n\n种子：${nameList}${count > 3 ? '...' : ''}\n(${moreText})`
    )

    if (deleteFiles) {
      if (!confirm(`警告：确定删除 ${moreText} 并同时删除下载文件吗？\n\n此操作不可恢复！`)) return null
    } else {
      if (!confirm(`确定删除 ${moreText} 吗？\n（仅删除种子，保留文件）`)) return null
    }

    return { deleteFiles }
  }

  async function runTorrentAction(
    action: TorrentAction,
    hashes: string[],
    options?: { refresh?: boolean; clearSelection?: boolean }
  ) {
    if (hashes.length === 0) return

    switch (action) {
      case 'pause':
        await adapter.value.pause(hashes)
        break
      case 'resume':
        await adapter.value.resume(hashes)
        break
      case 'delete': {
        const confirmed = confirmDelete(hashes)
        if (!confirmed) return
        await adapter.value.delete(hashes, confirmed.deleteFiles)
        // 删除后避免 selection 里残留已不存在的 hash
        removeFromSelection(hashes)
        break
      }
      case 'recheck':
        if (hashes.length === 1) await adapter.value.recheck(hashes[0]!)
        else await adapter.value.recheckBatch(hashes)
        break
      case 'reannounce':
        if (hashes.length === 1) await adapter.value.reannounce(hashes[0]!)
        else await adapter.value.reannounceBatch(hashes)
        break
      case 'forceStart':
      case 'force-start':
        if (hashes.length === 1) await adapter.value.forceStart(hashes[0]!, true)
        else await adapter.value.forceStartBatch(hashes, true)
        break
      default:
        console.warn('[useTorrentContext] Unknown action:', action)
        return
    }

    if (options?.clearSelection) clearSelection()
    if (options?.refresh !== false) await refreshList()
  }

  return {
    adapter,
    uiState,
    debouncedFilter,
    stateFilter,
    categoryFilter,
    tagFilter,
    filteredTorrents,
    sortedTorrents,
    toggleSelect,
    clearSelection,
    toggleSortByColumn,
    getSortIconForColumn,
    refreshList,
    runTorrentAction,
    getTorrentName,
  }
}
