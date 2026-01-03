import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'

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

// 简化启动流程：先挂载应用，登录后再初始化适配器
const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.directive('click-outside', vClickOutside)
app.use(router)
app.mount('#app')
