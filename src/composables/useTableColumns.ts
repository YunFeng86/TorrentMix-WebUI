/**
 * 表格列宽调整与可见性控制 - 核心逻辑
 *
 * 功能:
 * - 列状态管理 (宽度、可见性)
 * - 拖拽调整列宽 (RAF 限流到 60fps)
 * - localStorage 持久化
 * - 最小宽度限制
 * - 重置为默认值
 *
 * 设计原则:
 * - Good Taste: 复用 useDragResize 的 RAF 限流模式
 * - Pragmatism: 直接更新宽度 (横向不适合 transform)
 * - Simplicity: 数据结构简单，复杂度 O(1)
 */

import { ref, computed, watch, onUnmounted } from 'vue'
import type { ColumnDefinition, ColumnState, ColumnResizeState, StoredColumnConfig } from '@/composables/useTableColumns/types'

const STORAGE_PREFIX = 'table-columns-'

export function useTableColumns(tableId: string, definitions: ColumnDefinition[]) {
  // ========== 状态初始化 ==========

  // 从 localStorage 加载配置
  const stored = loadFromStorage(tableId)

  // 列状态 (响应式)
  const columns = ref<ColumnState[]>(
    definitions.map(def => ({
      ...def,
      currentWidth: stored[def.id]?.width ?? def.defaultWidth,
      visible: stored[def.id]?.visible ?? true
    }))
  )

  // 调整状态
  const resizeState = ref<ColumnResizeState>({
    isResizing: false,
    columnId: null,
    rightColumnId: null,
    startX: 0,
    startWidth: 0,
    startRenderedWidth: 0,
    startRightWidth: 0,
    startRightRenderedWidth: 0
  })

  // ========== 计算属性 ==========

  // 可见列 (用于渲染)
  const visibleColumns = computed(() =>
    columns.value.filter(col => col.visible)
  )

  // 固定宽度列的总宽度 (用于计算 flex-1 列的剩余空间)
  const totalFixedWidth = computed(() =>
    columns.value
      .filter((col: ColumnState) => col.visible && !col.isFlexible)
      .reduce((sum: number, col: ColumnState) => sum + col.currentWidth, 0)
  )

  // ========== 拖拽调整逻辑 (RAF 限流) ==========

  let rafId: number | null = null
  let pendingLeftWidth = 0
  let pendingRightWidth = 0

  /**
   * 开始拖拽调整
   */
  function startResize(
    leftColumnId: string,
    rightColumnId: string,
    startX: number,
    snapshots?: Array<{ id: string; width: number }>
  ) {
    const leftColumn = columns.value.find((c: ColumnState) => c.id === leftColumnId)
    const rightColumn = columns.value.find((c: ColumnState) => c.id === rightColumnId)
    if (!leftColumn || !rightColumn) return
    if (leftColumn.resizable === false || rightColumn.resizable === false) return

    // 在开始拖拽时，把所有渲染中的列宽“冻结”为真实像素宽度，避免 flex 分配带来的弹性变化
    if (snapshots && snapshots.length > 0) {
      for (const snapshot of snapshots) {
        const column = columns.value.find(c => c.id === snapshot.id)
        if (!column) continue
        const nextWidth = Math.max(column.minWidth, snapshot.width)
        column.currentWidth = nextWidth
      }
    }

    resizeState.value = {
      isResizing: true,
      columnId: leftColumnId,
      rightColumnId,
      startX,
      startWidth: leftColumn.currentWidth,
      startRenderedWidth: leftColumn.currentWidth,
      startRightWidth: rightColumn.currentWidth,
      startRightRenderedWidth: rightColumn.currentWidth
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopResize)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  /**
   * 处理鼠标移动 (RAF 限流到 ~60fps)
   */
  function handleMouseMove(e: MouseEvent) {
    if (!resizeState.value.isResizing) return

    const leftId = resizeState.value.columnId
    const rightId = resizeState.value.rightColumnId
    if (!leftId || !rightId) return

    const deltaX = e.clientX - resizeState.value.startX
    const leftColumn = columns.value.find((c: ColumnState) => c.id === leftId)
    const rightColumn = columns.value.find((c: ColumnState) => c.id === rightId)
    if (!leftColumn || !rightColumn) return

    const startLeftBasis = resizeState.value.startWidth || 0
    const startRightBasis = resizeState.value.startRightWidth || 0
    const startLeftRendered = resizeState.value.startRenderedWidth || startLeftBasis
    const startRightRendered = resizeState.value.startRightRenderedWidth || startRightBasis

    // 分隔线拖拽：左边 +d，右边 -d，二者渲染宽度总和不变
    const lowerBound = leftColumn.minWidth - startLeftRendered
    const upperBound = startRightRendered - rightColumn.minWidth
    const clampedDelta = Math.min(upperBound, Math.max(lowerBound, deltaX))

    const nextLeftWidth = startLeftBasis + clampedDelta
    const nextRightWidth = startRightBasis - clampedDelta

    pendingLeftWidth = Math.max(leftColumn.minWidth, nextLeftWidth)
    pendingRightWidth = Math.max(rightColumn.minWidth, nextRightWidth)

    // RAF 限流: 确保每帧只更新一次
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        applyWidth()
        rafId = null
      })
    }
  }

  /**
   * 应用宽度 (由 RAF 调用)
   */
  function applyWidth() {
    const leftId = resizeState.value.columnId
    const rightId = resizeState.value.rightColumnId
    if (!leftId || !rightId) return

    const leftColumn = columns.value.find((c: ColumnState) => c.id === leftId)
    const rightColumn = columns.value.find((c: ColumnState) => c.id === rightId)

    if (leftColumn) leftColumn.currentWidth = pendingLeftWidth
    if (rightColumn) rightColumn.currentWidth = pendingRightWidth
  }

  /**
   * 停止拖拽调整
   */
  function stopResize() {
    if (!resizeState.value.isResizing) return

    resizeState.value.isResizing = false
    resizeState.value.columnId = null
    resizeState.value.rightColumnId = null

    // 清理 RAF
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }

    // 移除事件监听
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    // 保存到 localStorage
    saveToStorage(tableId, columns.value)
  }

  // ========== 可见性控制 ==========

  /**
   * 切换列可见性
   * 至少保留 1 列可见
   */
  function toggleVisibility(columnId: string) {
    const column = columns.value.find((c: ColumnState) => c.id === columnId)
    if (!column) return

    // 如果是最后一列，不允许隐藏
    const visibleCount = columns.value.filter((c: ColumnState) => c.visible).length
    if (column.visible && visibleCount <= 1) {
      return // 至少保留一列
    }

    column.visible = !column.visible
    saveToStorage(tableId, columns.value)
  }

  /**
   * 重置为默认值
   */
  function resetToDefaults() {
    columns.value = definitions.map(def => ({
      ...def,
      currentWidth: def.defaultWidth,
      visible: true
    }))
    localStorage.removeItem(STORAGE_PREFIX + tableId)
  }

  // ========== 持久化 ==========

  // 监听变化并保存 (防抖: 只在 resize 结束时保存)
  watch(columns, () => {
    saveToStorage(tableId, columns.value)
  }, { deep: true })

  // ========== 清理 ==========

  onUnmounted(() => {
    if (resizeState.value.isResizing) {
      stopResize()
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
    }
  })

  return {
    columns,
    visibleColumns,
    totalFixedWidth,
    resizeState,
    startResize,
    toggleVisibility,
    resetToDefaults
  }
}

// ========== 工具函数 ==========

/**
 * 从 localStorage 加载配置
 */
function loadFromStorage(tableId: string): StoredColumnConfig {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableId)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch (e) {
    console.warn('[useTableColumns] Failed to load config:', e)
    return {}
  }
}

/**
 * 保存配置到 localStorage
 */
function saveToStorage(tableId: string, columns: ColumnState[]) {
  try {
    const config: StoredColumnConfig = {}
    columns.forEach((col: ColumnState) => {
      config[col.id] = {
        width: col.currentWidth,
        visible: col.visible
      }
    })
    localStorage.setItem(STORAGE_PREFIX + tableId, JSON.stringify(config))
  } catch (e) {
    console.warn('[useTableColumns] Failed to save config:', e)
  }
}
