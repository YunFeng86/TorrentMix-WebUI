import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBackendStore } from './backend'

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(false)
  const isChecking = ref(false)

  async function login(username: string, password: string) {
    const { adapter } = useBackendStore()
    if (!adapter) throw new Error('Backend not initialized')

    await adapter.login(username, password)
    isAuthenticated.value = true
  }

  async function logout() {
    const { adapter } = useBackendStore()
    await adapter?.logout()
    isAuthenticated.value = false
  }

  async function checkSession(): Promise<boolean> {
    const { adapter } = useBackendStore()
    if (!adapter) return false

    isChecking.value = true
    try {
      const valid = await adapter.checkSession()
      isAuthenticated.value = valid
      return valid
    } finally {
      isChecking.value = false
    }
  }

  return { isAuthenticated, isChecking, login, logout, checkSession }
})
