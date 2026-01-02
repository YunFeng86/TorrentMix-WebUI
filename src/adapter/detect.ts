import axios from 'axios'
import { getQbitBaseUrl } from '@/api/client'

export type BackendType = 'qbit' | 'trans' | 'unknown'

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
 * 探测后端类型
 *
 * 探测策略：
 * - qBittorrent: GET /api/v2/app/version -> 200 (已登录) 或 403 (未登录但端点存在)
 * - Transmission: POST /transmission/rpc -> 409 (需要 Session ID)
 *
 * 并发探测两个端点，谁先有效响应就选谁。
 * 如果都失败，返回 'unknown'。
 *
 * @param timeout - 单个探测请求超时时间（毫秒）
 */
export async function detectBackend(
  timeout: number = 3000
): Promise<BackendType> {
  // 与 api/client.ts 保持一致的 baseURL 逻辑
  const useProxy = shouldUseProxy()
  const baseURL = useProxy ? '' : getQbitBaseUrl()

  // 创建临时 axios 实例，不触发全局拦截器
  const detector = axios.create({
    baseURL,
    timeout,
    withCredentials: false  // 探测阶段不携带凭证
  })

  const qbitPromise = detector
    .get('/api/v2/app/version', { validateStatus: () => true })
    .then(res => {
      // 200 或 403 都表示 qBittorrent 端点存在
      if (res.status === 200 || res.status === 403) {
        return 'qbit' as const
      }
      throw new Error('qBittorrent not found')
    })
    .catch(() => {
      throw new Error('qBittorrent not found')
    })

  const transPromise = detector
    .post(
      '/transmission/rpc',
      { method: 'session-get' },
      {
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' }
      }
    )
    .then(res => {
      // 409 表示需要 Session ID，说明是 Transmission
      // 200 表示已认证成功
      if (res.status === 409 || res.status === 200) {
        return 'trans' as const
      }
      throw new Error('Transmission not found')
    })
    .catch(() => {
      throw new Error('Transmission not found')
    })

  // 并发探测，qBittorrent 优先
  // 理由：快速检测，同时避免之前 race 的误判问题
  const results = await Promise.allSettled([qbitPromise, transPromise])

  const qbitSuccess = results[0].status === 'fulfilled' && results[0].value === 'qbit'
  const transSuccess = results[1].status === 'fulfilled' && results[1].value === 'trans'

  // qBittorrent 优先（如果同时存在）
  if (qbitSuccess) return 'qbit'
  if (transSuccess) return 'trans'
  return 'unknown'
}
