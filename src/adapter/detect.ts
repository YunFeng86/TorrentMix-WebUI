import axios from 'axios'
import { getQbitBaseUrl } from '@/api/client'

export type BackendType = 'qbit' | 'trans' | 'unknown'

export interface BackendVersion {
  type: BackendType
  version: string
  major: number
  minor: number
  patch: number
  apiVersion?: string
  rpcSemver?: string
}

// 从环境变量读取强制指定的后端类型
function getForcedBackend(): BackendType | null {
  const forced = import.meta.env.VITE_BACKEND_TYPE?.toLowerCase()
  if (forced === 'qbit') return 'qbit'
  if (forced === 'trans') return 'trans'
  // auto 或未设置 = 自动检测
  return null
}

/**
 * 判断是否应该使用代理（开发环境或同源）
 *
 * - 开发环境：走 Vite 代理（baseURL 为空字符串）
 * - 生产环境同源：使用配置的 baseURL
 * - 生产环境跨域且 VITE_ALLOW_CROSS_ORIGIN=true：使用配置的 baseURL
 */
function shouldUseProxy(): boolean {
  const configuredUrl = getQbitBaseUrl()
  if (!configuredUrl) return true  // 空 URL = 开发环境走代理

  // 检查是否同源
  if (typeof window === 'undefined') return true
  try {
    const resolved = new URL(configuredUrl, window.location.href)
    return resolved.origin === window.location.origin
  } catch {
    return true
  }
}

const BACKEND_TYPE_CACHE_KEY = 'webui_backend_type'
const BACKEND_TYPE_CACHE_DURATION = 3600000 // 1小时

/**
 * 探测后端类型（仅类型，不检测版本号，用于登录页）
 */
export async function detectBackendTypeOnly(timeout = 3000): Promise<BackendType> {
  // 尝试从缓存读取类型
  try {
    const cached = localStorage.getItem(BACKEND_TYPE_CACHE_KEY)
    if (cached) {
      const { type, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < BACKEND_TYPE_CACHE_DURATION) {
        return type
      }
    }
  } catch {}

  // 缓存未命中或过期，重新检测
  const forced = getForcedBackend()
  const useProxy = shouldUseProxy()
  const baseURL = useProxy ? '' : getQbitBaseUrl()
  const detector = axios.create({ baseURL, timeout, withCredentials: false })

  // 尝试 qBittorrent
  try {
    const res = await detector.get('/api/v2/app/version', { validateStatus: () => true })
    if (res.status === 200 || res.status === 403) {
      // 缓存检测到的类型
      try {
        localStorage.setItem(BACKEND_TYPE_CACHE_KEY, JSON.stringify({
          type: 'qbit',
          timestamp: Date.now()
        }))
      } catch {}
      return 'qbit'
    }
  } catch {}

  // 尝试 Transmission
  try {
    const res = await detector.post('/transmission/rpc', { method: 'session-get' }, {
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' }
    })
    if (res.status === 409 || res.status === 200) {
      // 缓存检测到的类型
      try {
        localStorage.setItem(BACKEND_TYPE_CACHE_KEY, JSON.stringify({
          type: 'trans',
          timestamp: Date.now()
        }))
      } catch {}
      return 'trans'
    }
  } catch {}

  // 保守策略：返回环境变量指定的类型或默认 qBittorrent
  return forced || 'qbit'
}

/**
 * 探测后端类型并获取版本信息（已认证版本）
 * 此函数会携带凭证，用于登录后获取真实版本号
 */
export async function detectBackendWithVersionAuth(timeout = 3000): Promise<BackendVersion> {
  // 使用 silentApiClient 来携带已登录的 cookie，但不会在 403 时抛出 AuthError
  const { silentApiClient } = await import('@/api/client')

  // 尝试 qBittorrent
  try {
    const res = await silentApiClient.get('/api/v2/app/version', { validateStatus: () => true })
    if (res.status === 200 || res.status === 403) {
      const version = res.status === 200 ? String(res.data).trim() : 'unknown'
      const parsed = parseVersion(version)

      // 获取 API 版本（只有成功时才获取）
      let apiVersion: string | undefined
      if (res.status === 200) {
        try {
          const apiRes = await silentApiClient.get('/api/v2/app/webapiVersion')
          apiVersion = String(apiRes.data).trim()
        } catch {}
      }

      // 标记是否为未知版本
      const isUnknown = res.status === 403 || version === 'unknown'

      return {
        type: 'qbit',
        version,
        ...parsed,
        apiVersion,
        isUnknown
      } as BackendVersion & { isUnknown?: boolean }
    }
  } catch {}

  // 尝试 Transmission
  try {
    const res = await silentApiClient.post('/transmission/rpc', { method: 'session-get' }, {
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' }
    })

    if (res.status === 409 || res.status === 200) {
      let version = 'unknown'
      let rpcSemver: string | undefined

      if (res.status === 200 && res.data?.arguments) {
        version = res.data.arguments.version || 'unknown'
        rpcSemver = res.data.arguments['rpc-version-semver'] || res.data.arguments.rpcVersionSemver
      }

      const parsed = parseVersion(version)
      const isUnknown = res.status === 409 || version === 'unknown'

      return {
        type: 'trans',
        version,
        ...parsed,
        rpcSemver,
        isUnknown
      } as BackendVersion & { isUnknown?: boolean }
    }
  } catch {}

  // 保守策略：检测失败返回 qBittorrent v4
  const forced = getForcedBackend()
  return {
    type: forced || 'qbit',
    version: 'unknown',
    major: 4,
    minor: 0,
    patch: 0,
    isUnknown: true
  } as BackendVersion & { isUnknown?: boolean }
}

/**
 * 探测后端类型并获取版本信息
 */
export async function detectBackendWithVersion(timeout = 3000): Promise<BackendVersion> {
  const forced = getForcedBackend()
  const useProxy = shouldUseProxy()
  const baseURL = useProxy ? '' : getQbitBaseUrl()

  const detector = axios.create({ baseURL, timeout, withCredentials: false })

  // 尝试 qBittorrent
  try {
    const res = await detector.get('/api/v2/app/version', { validateStatus: () => true })
    if (res.status === 200 || res.status === 403) {
      const version = res.status === 200 ? String(res.data).trim() : 'unknown'
      const parsed = parseVersion(version)

      // 获取 API 版本（只有成功时才获取）
      let apiVersion: string | undefined
      if (res.status === 200) {
        try {
          const apiRes = await detector.get('/api/v2/app/webapiVersion')
          apiVersion = String(apiRes.data).trim()
        } catch {}
      }

      // 标记是否为未知版本（用于判断是否应该缓存）
      const isUnknown = res.status === 403 || version === 'unknown'

      return {
        type: 'qbit',
        version,
        ...parsed,
        apiVersion,
        isUnknown  // 添加标记，未认证时为 true
      } as BackendVersion & { isUnknown?: boolean }
    }
  } catch {}

  // 尝试 Transmission
  try {
    const res = await detector.post('/transmission/rpc', { method: 'session-get' }, {
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' }
    })

    if (res.status === 409 || res.status === 200) {
      let version = 'unknown'
      let rpcSemver: string | undefined

      if (res.status === 200 && res.data?.arguments) {
        version = res.data.arguments.version || 'unknown'
        rpcSemver = res.data.arguments['rpc-version-semver'] || res.data.arguments.rpcVersionSemver
      }

      const parsed = parseVersion(version)
      const isUnknown = res.status === 409 || version === 'unknown'

      return {
        type: 'trans',
        version,
        ...parsed,
        rpcSemver,
        isUnknown  // 添加标记
      } as BackendVersion & { isUnknown?: boolean }
    }
  } catch {}

  // 保守策略：检测失败返回 qBittorrent v4
  return {
    type: forced || 'qbit',
    version: 'unknown',
    major: 4,
    minor: 0,
    patch: 0,
    isUnknown: true  // 明确标记为未知
  } as BackendVersion & { isUnknown?: boolean }
}

/**
 * 解析版本字符串
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (match && match[1] && match[2] && match[3]) {
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10)
    }
  }
  return { major: 4, minor: 0, patch: 0 }
}

/**
 * 探测后端类型（保留向后兼容）
 */
export async function detectBackend(timeout = 3000): Promise<BackendType> {
  const result = await detectBackendWithVersion(timeout)
  return result.type
}
