import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiClient, silentApiClient } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  // 只存认证状态，不在 Store 中驻留明文凭证
  const isAuthenticated = ref(false)
  const isChecking = ref(false)  // 验证中标志

  async function login(username: string, password: string) {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)

    const response = await apiClient.post('/api/v2/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    // qBittorrent 返回 "Ok." 表示成功，"Fails." 表示失败
    // 都是 HTTP 200，必须检查响应体
    if (response.data !== 'Ok.') {
      throw new Error(response.data === 'Fails.'
        ? '用户名或密码错误'
        : `登录失败: ${response.data}`)
    }

    isAuthenticated.value = true
  }

  async function logout() {
    // 调用后端 logout API
    try {
      await apiClient.post('/api/v2/auth/logout')
    } catch {
      // 失败也继续清理本地状态（静默失败）
      console.warn('[AuthStore] Logout API call failed, proceeding with local cleanup')
    }
    isAuthenticated.value = false
  }

  // 静默验证当前 session 是否有效（不触发 403 跳转）
  async function checkSession(): Promise<boolean> {
    isChecking.value = true
    try {
      await silentApiClient.get('/api/v2/app/version')
      isAuthenticated.value = true
      return true
    } catch {
      isAuthenticated.value = false
      return false
    } finally {
      isChecking.value = false
    }
  }

  return { isAuthenticated, isChecking, login, logout, checkSession }
})
