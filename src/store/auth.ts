import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBackendStore } from './backend'

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(false)
  const isChecking = ref(false)
  const isInitializing = ref(false)

  async function login(username: string, password: string) {
    const backendStore = useBackendStore()

    try {
      // 第一步：从缓存获取后端类型（登录页已经检测并缓存了）
      const { detectBackendTypeOnly } = await import('@/adapter/detect')
      const backendType = await detectBackendTypeOnly()
      console.log('[Login] Backend type:', backendType)

      // 第二步：根据后端类型创建临时适配器并登录
      let tempAdapter: import('@/adapter/interface').BaseAdapter

      if (backendType === 'qbit') {
        // qBittorrent v4/v5 的 login API 相同，使用 v4 即可
        const { QbitV4Adapter } = await import('@/adapter/qbit/v4')
        tempAdapter = new QbitV4Adapter()
      } else {
        // Transmission
        const { TransAdapter } = await import('@/adapter/trans/index')
        tempAdapter = new TransAdapter()
      }

      console.log('[Login] Calling login API...')
      await tempAdapter.login(username, password)
      console.log('[Login] Login successful')

      // 第三步：登录成功后，使用携带凭证的检测函数获取真实版本
      const { createAdapter, clearVersionCache } = await import('@/adapter/factory')
      const { detectBackendWithVersionAuth } = await import('@/adapter/detect')

      clearVersionCache()  // 清除旧的版本缓存
      console.log('[Login] Detecting version with auth...')

      // 使用认证版本的检测函数，携带 cookie 获取真实版本号
      const versionInfo = await detectBackendWithVersionAuth() as import('@/adapter/detect').BackendVersion & { isUnknown?: boolean }
      console.log('[Login] Version info:', versionInfo)

      // 如果仍然是未知版本，使用默认版本
      const finalVersion = versionInfo.isUnknown
        ? { type: backendType, version: 'unknown', major: backendType === 'qbit' ? 4 : 0, minor: 0, patch: 0 }
        : versionInfo

      // 第四步：创建最终的适配器
      const { adapter: finalAdapter } = await createAdapter()
      backendStore.setAdapter(finalAdapter, finalVersion)
      isAuthenticated.value = true
      console.log('[Login] Setup complete, version:', finalVersion)
    } catch (error) {
      console.error('[Login] Login failed:', error)
      throw error  // 重新抛出错误，让登录页显示
    }
  }

  async function logout() {
    const { adapter } = useBackendStore()
    await adapter?.logout()
    isAuthenticated.value = false
  }

  async function checkSession(): Promise<boolean> {
    const backendStore = useBackendStore()
    const { adapter, isInitialized } = backendStore

    // 如果未初始化，尝试恢复（页面刷新场景）
    if (!adapter || !isInitialized) {
      try {
        // 尝试检测后端类型并初始化适配器
        const { createAdapter } = await import('@/adapter/factory')
        const { adapter: newAdapter, version } = await createAdapter()
        backendStore.setAdapter(newAdapter, version)

        // 验证 session 是否有效
        const valid = await newAdapter.checkSession()
        if (valid) {
          isAuthenticated.value = true
          return true
        }
      } catch {
        // 恢复失败，session 无效
      }
      return false
    }

    // 已初始化，直接验证 session
    isChecking.value = true
    try {
      const valid = await adapter.checkSession()
      isAuthenticated.value = valid
      return valid
    } finally {
      isChecking.value = false
    }
  }

  return { isAuthenticated, isChecking, isInitializing, login, logout, checkSession }
})
