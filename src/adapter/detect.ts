import axios from 'axios'

export type BackendType = 'qbit' | 'trans' | 'unknown'

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
 * @param baseUrl - 后端基础 URL，如 'http://localhost:8080'
 * @param timeout - 单个探测请求超时时间（毫秒）
 */
export async function detectBackend(
  baseUrl: string = '',
  timeout: number = 3000
): Promise<BackendType> {
  // 创建临时 axios 实例，不触发全局拦截器
  const detector = axios.create({
    baseURL: baseUrl,
    timeout,
    // 不携带凭证，避免 403 触发登录跳转
    withCredentials: false
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

  try {
    // 并发探测，谁先响应就选谁
    const result = await Promise.race([
      qbitPromise,
      transPromise,
      // 两个都超时的情况
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Detection timeout')), timeout + 500)
      )
    ])
    return result
  } catch {
    // 如果一个失败，尝试另一个
    try {
      return await qbitPromise
    } catch {
      try {
        return await transPromise
      } catch {
        return 'unknown'
      }
    }
  }
}
