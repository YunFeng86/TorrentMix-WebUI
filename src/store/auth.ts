import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiClient } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  // 纯内存存储，不使用 localStorage
  const credentials = ref<{ username: string; password: string } | null>(null)
  const isAuthenticated = ref(false)

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

  return { credentials, isAuthenticated, login, logout }
})
