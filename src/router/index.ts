import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import LoginView from '@/views/LoginView.vue'
import DashboardView from '@/views/DashboardView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView },
    {
      path: '/',
      component: DashboardView,
      meta: { requiresAuth: true }
    }
  ]
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  // 需要认证的页面
  if (to.meta.requiresAuth) {
    // 已认证，直接放行
    if (authStore.isAuthenticated) {
      return true
    }

    // 未认证，先尝试静默验证 session（可能是页面刷新）
    const isValid = await authStore.checkSession()
    if (isValid) {
      return true  // session 有效，恢复登录状态
    }

    // session 无效，跳转登录
    return '/login'
  }

  // 已登录用户访问登录页，重定向到首页
  if (to.path === '/login' && authStore.isAuthenticated) {
    return '/'
  }

  return true
})

export default router
