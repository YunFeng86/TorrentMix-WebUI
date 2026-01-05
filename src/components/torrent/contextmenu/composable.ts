import { ref } from 'vue'
import type { ContextMenuState } from './types'

/**
 * 右键菜单复用逻辑
 *
 * 功能：
 * - PC 端：右键点击触发
 * - 移动端：长按 500ms 触发
 */
export function useContextmenu() {
  const state = ref<ContextMenuState>({
    show: false,
    x: 0,
    y: 0,
    hashes: []
  })

  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  const LONG_PRESS_DELAY = 500

  /**
   * PC 端右键点击
   */
  function handleContextMenu(e: MouseEvent, hash: string) {
    e.preventDefault()
    e.stopPropagation()
    state.value = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      hashes: [hash]
    }
  }

  /**
   * 移动端长按开始
   */
  function handleTouchStart(e: TouchEvent, hash: string) {
    const touch = e.touches[0]
    if (!touch) return
    const { clientX, clientY } = touch

    longPressTimer = setTimeout(() => {
      state.value = {
        show: true,
        x: clientX,
        y: clientY,
        hashes: [hash]
      }
    }, LONG_PRESS_DELAY)
  }

  /**
   * 移动端长按结束
   * 如果已经触发长按，阻止默认点击事件
   */
  function handleTouchEnd(e?: TouchEvent) {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }

    // 如果菜单已显示，阻止后续点击事件
    if (state.value.show && e) {
      e.preventDefault()
    }
  }

  /**
   * 关闭菜单
   */
  function close() {
    state.value.show = false
  }

  return {
    state,
    handleContextMenu,
    handleTouchStart,
    handleTouchEnd,
    close
  }
}
