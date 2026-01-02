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

      // 获取 API 版本
      let apiVersion: string | undefined
      if (res.status === 200) {
        try {
          const apiRes = await detector.get('/api/v2/app/webapiVersion')
          apiVersion = String(apiRes.data).trim()
        } catch {}
      }

      return {
        type: 'qbit',
        version,
        ...parsed,
        apiVersion
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
      return {
        type: 'trans',
        version,
        ...parsed,
        rpcSemver
      }
    }
  } catch {}

  // 保守策略：检测失败返回 qBittorrent v4
  return {
    type: forced || 'qbit',
    version: 'unknown',
    major: 4,
    minor: 0,
    patch: 0
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
