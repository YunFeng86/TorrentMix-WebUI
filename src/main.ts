import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'

import { detectBackend } from './adapter/detect'
import { QbitAdapter } from './adapter/qbit'
import { TransAdapter } from './adapter/trans'
import { useBackendStore } from './store/backend'

// 全局指令：点击外部关闭
const vClickOutside = {
  mounted(el: HTMLElement & { _clickOutside?: (event: MouseEvent) => void }, binding: { value: () => void }) {
    el._clickOutside = (event: MouseEvent) => {
      if (!(el === event.target || el.contains(event.target as Node))) {
        binding.value()
      }
    }
    document.addEventListener('click', el._clickOutside as EventListener)
  },
  unmounted(el: HTMLElement & { _clickOutside?: (event: MouseEvent) => void }) {
    if (el._clickOutside) {
      document.removeEventListener('click', el._clickOutside as EventListener)
    }
  }
}

/**
 * 应用启动引导流程
 *
 * 1. 创建 Vue 应用实例
 * 2. 安装 Pinia（需要先安装才能使用 Store）
 * 3. 探测后端类型（detectBackend 内部根据环境决定走代理还是直连）
 * 4. 注入对应的 Adapter 实例
 * 5. 安装路由并挂载应用
 */
async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)

  // 注册全局指令
  app.directive('click-outside', vClickOutside)

  // 探测后端类型并注入 Adapter（detectBackend 自动处理代理逻辑）
  const backendType = await detectBackend()

  const backendStore = useBackendStore()

  if (backendType === 'qbit') {
    backendStore.setAdapter(new QbitAdapter(), 'qbit')
  } else if (backendType === 'trans') {
    backendStore.setAdapter(new TransAdapter(), 'trans')
  } else {
    // 探测失败，默认使用 qBittorrent（向后兼容）
    console.warn('[Bootstrap] Backend detection failed, defaulting to qBittorrent')
    backendStore.setAdapter(new QbitAdapter(), 'qbit')
  }

  app.use(router)
  app.mount('#app')
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Failed to start application:', err)
})
