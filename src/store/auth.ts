import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiClient, silentApiClient } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  // 纯内存存储，不使用 localStorage
  const credentials = ref<{ username: string; password: string } | null>(null)
  const isAuthenticated = ref(false)
  const isChecking = ref(false)  // 验证中标志

  async function login(username: string, password: string) {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)

    await apiClient.post('/api/v2/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    credentials.value = { username, password }
    isAuthenticated.value = true
  }

  function logout() {
    credentials.value = null
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

  return { credentials, isAuthenticated, isChecking, login, logout, checkSession }
})
