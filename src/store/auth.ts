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

      // 第二步：使用 factory 模式创建初始适配器
      const { createAdapterByType, saveVersionCache, clearVersionCache } = await import('@/adapter/factory')
      const adapter = await createAdapterByType(backendType)
      console.log('[Login] Initial adapter created')

      // 第三步：使用初始适配器登录
      console.log('[Login] Calling login API...')
      await adapter.login(username, password)
      console.log('[Login] Login successful')

      // 第四步：登录后检测版本（只检测一次）
      const { detectBackendWithVersionAuth } = await import('@/adapter/detect')
      console.log('[Login] Detecting version with auth...')

      const versionInfo = await detectBackendWithVersionAuth() as import('@/adapter/detect').BackendVersion & { isUnknown?: boolean }
      console.log('[Login] Version info:', versionInfo)

      // 如果仍然是未知版本，使用默认版本
      const finalVersion: (import('@/adapter/detect').BackendVersion & { isUnknown?: boolean }) = versionInfo.isUnknown
        ? { type: backendType, version: 'unknown', major: backendType === 'qbit' ? 4 : 0, minor: 0, patch: 0, isUnknown: true }
        : versionInfo

      // 第五步：缓存版本信息（未知版本不缓存，避免污染缓存）
      if (finalVersion.isUnknown) {
        clearVersionCache()
      } else {
        saveVersionCache(finalVersion)
      }

      // 第六步：智能复用或升级适配器
      let finalAdapter: import('@/adapter/interface').BaseAdapter
      const needsQbitUpgrade = finalVersion.type === 'qbit' && finalVersion.major >= 5
      const needsTransRecreate = finalVersion.type === 'trans' && Boolean(finalVersion.rpcSemver)

      if (needsQbitUpgrade) {
        // 需要 v5 适配器，创建新实例
        console.log('[Login] Upgrading to v5 adapter')
        const { QbitV5Adapter } = await import('@/adapter/qbit/v5')
        finalAdapter = new QbitV5Adapter()
      } else if (needsTransRecreate) {
        console.log('[Login] Recreating Transmission adapter with protocol info')
        const { TransAdapter } = await import('@/adapter/trans/index')
        finalAdapter = new TransAdapter({ rpcSemver: finalVersion.rpcSemver })
      } else {
        // 复用初始适配器（大部分情况）
        console.log('[Login] Reusing initial adapter')
        finalAdapter = adapter
      }

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
