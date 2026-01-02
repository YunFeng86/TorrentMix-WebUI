import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'

import { createAdapter } from './adapter/factory'
import { useBackendStore } from './store/backend'

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

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.directive('click-outside', vClickOutside)

  const { adapter, version } = await createAdapter()
  const backendStore = useBackendStore()
  backendStore.setAdapter(adapter, version)

  app.use(router)
  app.mount('#app')
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Failed to start application:', err)
})
