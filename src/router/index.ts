import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import { useBackendStore } from '@/store/backend'
import { AuthError } from '@/api/client'
import LoginView from '@/views/LoginView.vue'
import DashboardView from '@/views/DashboardView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginView },
    {
      path: '/',
      component: DashboardView,
      meta: { requiresAuth: true }
    }
  ]
})

/**
 * 清理所有认证状态
 */
function clearAuthState() {
  const authStore = useAuthStore()
  const backendStore = useBackendStore()

  authStore.isAuthenticated = false
  backendStore.clearAdapter?.()
}

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  const backendStore = useBackendStore()

  // 需要认证的页面
  if (to.meta.requiresAuth) {
    // 已认证且已初始化，直接放行
    if (authStore.isAuthenticated && backendStore.isInitialized) {
      return true
    }

    // 未认证，先尝试静默验证 session（可能是页面刷新）
    const isValid = await authStore.checkSession()
    if (isValid && backendStore.isInitialized) {
      return true  // session 有效且已初始化，恢复登录状态
    }

    // session 无效或未初始化，跳转登录
    return '/login'
  }

  // 已登录用户访问登录页，重定向到首页
  // 先检查标志位（已登录则直接跳转，避免请求）
  if (to.path === '/login' || to.path === '#/login') {
    if (authStore.isAuthenticated && backendStore.isInitialized) {
      return '/'
    }
    // 标志位未设置，尝试静默验证（可能是页面刷新）
    const isValid = await authStore.checkSession()
    if (isValid && backendStore.isInitialized) {
      return '/'
    }
  }

  return true
})

// 全局错误处理器：捕获组件内抛出的 AuthError
router.onError((error) => {
  if (error instanceof AuthError) {
    clearAuthState()
    router.replace('/login')
  }
})

export default router
