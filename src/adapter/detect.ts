import axios from 'axios'
import { getQbitBaseUrl } from '@/api/client'

export type BackendType = 'qbit' | 'trans' | 'unknown'

/**
 * qBittorrent API 特性标志
 * 基于 WebAPI 版本和应用版本检测
 */
export interface QbitFeatures {
  // 基础端点（v4-v5 差异）
  pauseEndpoint: 'pause' | 'stop'
  resumeEndpoint: 'resume' | 'start'

  // 新增特性（按 API 版本）
  hasTorrentRename: boolean      // WebAPI v2.8.0+
  hasFileRename: boolean         // WebAPI v2.8.2+
  hasReannounceField: boolean    // WebAPI v2.9.3+ (torrents/info 返回 reannounce)
  hasShareLimit: boolean         // WebAPI v2.8.1+ (ratioLimit/seedingTimeLimit)

  // 实用标志
  isLegacy: boolean              // v4.x 或更早
}

export interface BackendVersion {
  type: BackendType
  version: string
  major: number
  minor: number
  patch: number
  apiVersion?: string
  rpcSemver?: string
  features?: QbitFeatures        // API 特性标志
  isUnknown?: boolean            // 版本是否未知（未认证/无权限/探测失败等）
}

function getEnv(): Record<string, any> {
  // Vite runtime
  const viteEnv = (import.meta as any).env
  if (viteEnv) return viteEnv as Record<string, any>

  // Non-Vite runtimes (e.g. Node tests)
  if (typeof process !== 'undefined' && (process as any).env) {
    return (process as any).env as Record<string, any>
  }

  return {}
}

// 从环境变量读取强制指定的后端类型
function getForcedBackend(): BackendType | null {
  const env = getEnv()
  const forced = String(env.VITE_BACKEND_TYPE ?? '').toLowerCase()
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

const BACKEND_TYPE_CACHE_DURATION = 3600000 // 1小时
type BackendTypeCache = { type: BackendType; timestamp: number }
let backendTypeCache: BackendTypeCache | null = null

/**
 * 探测后端类型（仅类型，不检测版本号，用于登录页）
 */
export async function detectBackendTypeOnly(timeout = 3000): Promise<BackendType> {
  // 强制覆盖：显式指定时不做探测（也覆盖缓存）
  const forced = getForcedBackend()
  if (forced) {
    backendTypeCache = { type: forced, timestamp: Date.now() }
    return forced
  }

  // 仅内存缓存：刷新页面即失效（按要求不使用 localStorage）
  if (backendTypeCache && Date.now() - backendTypeCache.timestamp < BACKEND_TYPE_CACHE_DURATION) {
    return backendTypeCache.type
  }

  // 缓存未命中或过期，重新检测
  const useProxy = shouldUseProxy()
  const baseURL = useProxy ? '' : getQbitBaseUrl()
  const detector = axios.create({ baseURL, timeout, withCredentials: false })

  // 尝试 qBittorrent
  try {
    const res = await detector.get('/api/v2/app/version', { validateStatus: () => true })
    if (res.status === 200 || res.status === 403) {
      backendTypeCache = { type: 'qbit', timestamp: Date.now() }
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
      backendTypeCache = { type: 'trans', timestamp: Date.now() }
      return 'trans'
    }
  } catch {}

  // 保守策略：默认 qBittorrent
  return 'qbit'
}

/**
 * 探测后端类型并获取版本信息（已认证版本）
 * 此函数会携带凭证，用于登录后获取真实版本号
 */
export async function detectBackendWithVersionAuth(_timeout = 3000): Promise<BackendVersion> {
  const forced = getForcedBackend()

  // 使用 silentApiClient 来携带已登录的 cookie，但不会在 403 时抛出 AuthError
  const { silentApiClient } = await import('@/api/client')

  // 强制 qBittorrent：只尝试 qB
  if (forced === 'qbit') {
    try {
      const res = await silentApiClient.get('/api/v2/app/version', { validateStatus: () => true })
      if (res.status === 200 || res.status === 403) {
        const version = res.status === 200 ? String(res.data).trim() : 'unknown'
        const parsed = parseVersion(version)

        let apiVersion: string | undefined
        if (res.status === 200) {
          try {
            const apiRes = await silentApiClient.get('/api/v2/app/webapiVersion')
            apiVersion = String(apiRes.data).trim()
          } catch {}
        }

        const isUnknown = res.status === 403 || version === 'unknown'

        return {
          type: 'qbit',
          version,
          ...parsed,
          apiVersion,
          features: isUnknown ? undefined : detectQbitFeatures(version, apiVersion),
          isUnknown
        }
      }
    } catch {}

    return {
      type: 'qbit',
      version: 'unknown',
      major: 4,
      minor: 0,
      patch: 0,
      isUnknown: true
    }
  }

  // 强制 Transmission：只尝试 TR
  if (forced === 'trans') {
    try {
      const { transClient } = await import('@/api/trans-client')
      const res = await transClient.post('', { method: 'session-get' })

      let version = 'unknown'
      let rpcSemver: string | undefined

      if (res.data?.arguments) {
        version = res.data.arguments.version || 'unknown'
        rpcSemver = res.data.arguments['rpc-version-semver'] || res.data.arguments.rpcVersionSemver
      }

      const parsed = parseVersion(version)
      const isUnknown = version === 'unknown'

      return {
        type: 'trans',
        version,
        ...parsed,
        rpcSemver,
        isUnknown
      }
    } catch {}

    return {
      type: 'trans',
      version: 'unknown',
      major: 0,
      minor: 0,
      patch: 0,
      isUnknown: true
    }
  }

  // 自动探测：优先尝试 qBittorrent
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
        features: isUnknown ? undefined : detectQbitFeatures(version, apiVersion),
        isUnknown
      }
    }
  } catch {}

  // 尝试 Transmission
  try {
    const { transClient } = await import('@/api/trans-client')
    const res = await transClient.post('', { method: 'session-get' })

    let version = 'unknown'
    let rpcSemver: string | undefined

    if (res.data?.arguments) {
      version = res.data.arguments.version || 'unknown'
      rpcSemver = res.data.arguments['rpc-version-semver'] || res.data.arguments.rpcVersionSemver
    }

    const parsed = parseVersion(version)
    const isUnknown = version === 'unknown'

    return {
      type: 'trans',
      version,
      ...parsed,
      rpcSemver,
      isUnknown
    }
  } catch {}

  // 保守策略：检测失败返回 qBittorrent v4
  return {
    type: 'qbit',
    version: 'unknown',
    major: 4,
    minor: 0,
    patch: 0,
    isUnknown: true
  }
}

/**
 * 探测后端类型并获取版本信息
 */
export async function detectBackendWithVersion(timeout = 3000): Promise<BackendVersion> {
  const forced = getForcedBackend()
  const useProxy = shouldUseProxy()
  const baseURL = useProxy ? '' : getQbitBaseUrl()

  const detector = axios.create({ baseURL, timeout, withCredentials: false })

  // 强制 qBittorrent：只尝试 qB
  if (forced === 'qbit') {
    try {
      const res = await detector.get('/api/v2/app/version', { validateStatus: () => true })
      if (res.status === 200 || res.status === 403) {
        const version = res.status === 200 ? String(res.data).trim() : 'unknown'
        const parsed = parseVersion(version)

        let apiVersion: string | undefined
        if (res.status === 200) {
          try {
            const apiRes = await detector.get('/api/v2/app/webapiVersion')
            apiVersion = String(apiRes.data).trim()
          } catch {}
        }

        const isUnknown = res.status === 403 || version === 'unknown'

        return {
          type: 'qbit',
          version,
          ...parsed,
          apiVersion,
          features: isUnknown ? undefined : detectQbitFeatures(version, apiVersion),
          isUnknown
        }
      }
    } catch {}

    return {
      type: 'qbit',
      version: 'unknown',
      major: 4,
      minor: 0,
      patch: 0,
      isUnknown: true
    }
  }

  // 强制 Transmission：只尝试 TR
  if (forced === 'trans') {
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
          isUnknown
        }
      }
    } catch {}

    return {
      type: 'trans',
      version: 'unknown',
      major: 0,
      minor: 0,
      patch: 0,
      isUnknown: true
    }
  }

  // 自动探测：尝试 qBittorrent
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
        features: isUnknown ? undefined : detectQbitFeatures(version, apiVersion),
        isUnknown  // 添加标记，未认证时为 true
      }
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
      }
    }
  } catch {}

  // 保守策略：检测失败返回 qBittorrent v4
  return {
    type: 'qbit',
    version: 'unknown',
    major: 4,
    minor: 0,
    patch: 0,
    isUnknown: true  // 明确标记为未知
  }
}

/**
 * 解析 WebAPI 版本 "2.11.3" → { major: 2, minor: 11, patch: 3 }
 */
function parseApiVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match || !match[1] || !match[2] || !match[3]) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  }
}

/**
 * 版本比较（用于检测特性支持）
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareApiVersions(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number }
): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/**
 * 检测 qBittorrent API 特性支持
 */
function detectQbitFeatures(
  appVersion: string,
  apiVersion?: string
): QbitFeatures {
  const parsed = parseVersion(appVersion)
  const apiVer = apiVersion ? parseApiVersion(apiVersion) : null

  // 如果没有 API 版本，使用保守估计（基于应用版本）
  if (!apiVer) {
    return {
      pauseEndpoint: parsed.major >= 5 ? 'stop' : 'pause',
      resumeEndpoint: parsed.major >= 5 ? 'start' : 'resume',
      // 无法获取 WebAPI 版本时尽量保守：仅对 v5 开启（端点变化已由 pause/resume 处理）
      hasTorrentRename: parsed.major >= 5,
      hasFileRename: parsed.major >= 5,
      hasReannounceField: parsed.major >= 5,
      hasShareLimit: parsed.major >= 5,
      isLegacy: parsed.major < 5
    }
  }

  // 有 API 版本时精确检测
  return {
    pauseEndpoint: parsed.major >= 5 ? 'stop' : 'pause',
    resumeEndpoint: parsed.major >= 5 ? 'start' : 'resume',
    hasTorrentRename: compareApiVersions(apiVer, { major: 2, minor: 8, patch: 0 }) >= 0,
    hasFileRename: compareApiVersions(apiVer, { major: 2, minor: 8, patch: 2 }) >= 0,
    hasReannounceField: compareApiVersions(apiVer, { major: 2, minor: 9, patch: 3 }) >= 0,
    hasShareLimit: compareApiVersions(apiVer, { major: 2, minor: 8, patch: 1 }) >= 0,
    isLegacy: parsed.major < 5
  }
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
