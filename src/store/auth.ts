import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBackendStore } from './backend'
import type { BaseAdapter } from '@/adapter/interface'
import type { BackendType, BackendVersion } from '@/adapter/detect'

type LoginDeps = {
  detectBackendTypeOnly: (timeout?: number) => Promise<BackendType>
  detectBackendWithVersionAuth: (timeout?: number) => Promise<BackendVersion>
  createAdapterByType: (backendType: BackendType) => Promise<BaseAdapter>
  saveVersionCache: (version: BackendVersion) => void
  clearVersionCache: () => void
  QbitAdapter: new (features: any) => BaseAdapter
  DEFAULT_QBIT_FEATURES: any
  TransAdapter: new (opts?: any) => BaseAdapter
}

async function loadLoginDeps(): Promise<LoginDeps> {
  const { detectBackendTypeOnly, detectBackendWithVersionAuth } = await import('@/adapter/detect')
  const { createAdapterByType, saveVersionCache, clearVersionCache } = await import('@/adapter/factory')
  const { QbitAdapter, DEFAULT_QBIT_FEATURES } = await import('@/adapter/qbit')
  const { TransAdapter } = await import('@/adapter/trans/index')
  return {
    detectBackendTypeOnly,
    detectBackendWithVersionAuth,
    createAdapterByType,
    saveVersionCache,
    clearVersionCache,
    QbitAdapter,
    DEFAULT_QBIT_FEATURES,
    TransAdapter,
  }
}

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(false)
  const isChecking = ref(false)
  const isInitializing = ref(false)

  async function login(username: string, password: string, deps?: LoginDeps) {
    const backendStore = useBackendStore()
    const d = deps ?? await loadLoginDeps()

    try {
      // 第一步：从缓存获取后端类型（登录页已经检测并缓存了）
      const backendType = await d.detectBackendTypeOnly()
      console.log('[Login] Backend type:', backendType)

      // 第二步：使用 factory 模式创建初始适配器
      const adapter = await d.createAdapterByType(backendType)
      console.log('[Login] Initial adapter created')

      // 第三步：使用初始适配器登录
      console.log('[Login] Calling login API...')
      await adapter.login(username, password)
      console.log('[Login] Login successful')

      // 第四步：登录后检测版本（只检测一次）
      console.log('[Login] Detecting version with auth...')

      const versionInfo = await d.detectBackendWithVersionAuth()
      console.log('[Login] Version info:', versionInfo)

      // 如果仍然是未知版本，使用默认版本
      const finalVersion: BackendVersion = versionInfo.isUnknown
        ? { type: backendType, version: 'unknown', major: backendType === 'qbit' ? 4 : 0, minor: 0, patch: 0, isUnknown: true }
        : versionInfo

      // 第五步：缓存版本信息（未知版本不缓存，避免污染缓存）
      if (finalVersion.isUnknown) {
        d.clearVersionCache()
      } else {
        d.saveVersionCache(finalVersion)
      }

      // 第六步：基于版本信息构建最终适配器
      let finalAdapter: BaseAdapter = adapter
      if (finalVersion.type === 'qbit') {
        const features = finalVersion.features || {
          ...d.DEFAULT_QBIT_FEATURES,
          pauseEndpoint: finalVersion.major >= 5 ? 'stop' : 'pause',
          resumeEndpoint: finalVersion.major >= 5 ? 'start' : 'resume',
          isLegacy: finalVersion.major < 5
        }
        finalAdapter = new d.QbitAdapter(features)
      } else if (finalVersion.type === 'trans') {
        finalAdapter = new d.TransAdapter({ rpcSemver: finalVersion.rpcSemver })
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
