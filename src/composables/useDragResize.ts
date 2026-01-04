import { ref, computed, onUnmounted } from 'vue'

export interface DragResizeOptions {
  /** 初始高度 */
  initialHeight: number
  /** 最小高度 */
  minHeight?: number
  /** 最大高度 */
  maxHeight?: number
}

/**
 * 高性能拖拽调整大小 Composable
 *
 * 核心优化：
 * - 拖拽过程中使用 CSS transform，不触发布局重排
 * - 使用 requestAnimationFrame 限流到 ~60fps
 * - 拖拽结束时才提交最终高度给父组件
 */
export function useDragResize(options: DragResizeOptions) {
  const {
    initialHeight,
    minHeight = 200,
    maxHeight = 800
  } = options

  const isResizing = ref(false)
  const displayHeight = ref(initialHeight)
  const transformOffset = ref(0)

  const startY = ref(0)
  const startHeight = ref(0)
  const startTransform = ref(0)

  type ResizeMode = 'pointer' | 'mouse' | 'touch' | null
  let resizeMode: ResizeMode = null
  let activePointerId: number | null = null

  let rafId: number | null = null
  let pendingDeltaY = 0

  /**
   * 提交最终高度（拖拽结束时调用）
   */
  function commitHeight(): number {
    const finalHeight = displayHeight.value
    transformOffset.value = 0
    return finalHeight
  }

  /**
   * 设置高度（外部调用）
   */
  function setHeight(h: number) {
    displayHeight.value = Math.max(minHeight, Math.min(maxHeight, h))
    transformOffset.value = 0
  }

  /**
   * 开始拖拽
   */
  function startResize(e: PointerEvent | MouseEvent | TouchEvent) {
    if (isResizing.value) return

    isResizing.value = true
    startY.value = 'touches' in e ? (e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0) : e.clientY
    startHeight.value = displayHeight.value
    startTransform.value = transformOffset.value
    pendingDeltaY = 0

    if (typeof PointerEvent !== 'undefined' && e instanceof PointerEvent) {
      resizeMode = 'pointer'
      activePointerId = e.pointerId
      ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', stopResize)
      document.addEventListener('pointercancel', stopResize)
      document.body.style.cursor = 'ns-resize'
    } else if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
      resizeMode = 'touch'
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', stopResize)
      document.addEventListener('touchcancel', stopResize)
    } else {
      resizeMode = 'mouse'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', stopResize)
      document.body.style.cursor = 'ns-resize'
    }

    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  function scheduleDelta(clientY: number) {
    if (!isResizing.value) return

    // 向上拖拽为正
    const deltaY = startY.value - clientY
    pendingDeltaY = deltaY

    // 使用 RAF 确保每帧只更新一次
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        applyTransform()
        rafId = null
      })
    }
  }

  /**
   * 处理鼠标移动（RAF 限流）
   */
  function handleMouseMove(e: MouseEvent) {
    scheduleDelta(e.clientY)
  }

  function handlePointerMove(e: PointerEvent) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return
    scheduleDelta(e.clientY)
  }

  function handleTouchMove(e: TouchEvent) {
    const touch = e.touches[0]
    if (!touch) return
    scheduleDelta(touch.clientY)
    e.preventDefault()
  }

  /**
   * 应用 transform（不触发重排）
   */
  function applyTransform() {
    const rawHeight = startHeight.value + pendingDeltaY + startTransform.value
    const clampedHeight = Math.max(minHeight, Math.min(maxHeight, rawHeight))

    // 计算需要多少 transform 才能达到目标高度
    const heightDelta = clampedHeight - displayHeight.value
    transformOffset.value = heightDelta
  }

  /**
   * 停止拖拽
   */
  function stopResize() {
    if (!isResizing.value) return

    // 应用最终高度
    const rawHeight = startHeight.value + pendingDeltaY + startTransform.value
    displayHeight.value = Math.max(minHeight, Math.min(maxHeight, rawHeight))
    transformOffset.value = 0

    isResizing.value = false
    pendingDeltaY = 0

    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }

    if (resizeMode === 'pointer') {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      activePointerId = null
    } else if (resizeMode === 'touch') {
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', stopResize)
      document.removeEventListener('touchcancel', stopResize)
    } else {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', stopResize)
    }
    resizeMode = null

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  onUnmounted(() => {
    if (isResizing.value) {
      stopResize()
    }
  })

  // 计算当前显示的总高度（包含 transform）
  const currentHeight = computed(() => displayHeight.value + transformOffset.value)

  // 样式对象：使用 transform 替代直接修改 height
  const panelStyle = computed(() => {
    const baseStyle = { height: `${displayHeight.value}px` }
    if (transformOffset.value !== 0) {
      return { ...baseStyle, transform: `translateY(${-transformOffset.value}px)` }
    }
    return baseStyle
  })

  return {
    isResizing,
    displayHeight,
    currentHeight,
    panelStyle,
    startResize,
    stopResize,
    commitHeight,
    setHeight
  }
}
