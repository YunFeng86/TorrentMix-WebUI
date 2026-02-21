import axios from 'axios'

/**
 * Transmission RPC 客户端
 *
 * 特殊处理：
 * - 自动处理 409 Conflict，提取 X-Transmission-Session-Id 并重试
 * - Session ID 存在 axios instance 上（当前导出为单例）
 */

// TODO: 若未来需要同时管理多个 Transmission 实例，请将 transClient 改为工厂函数，确保 Session-Id / auth 按后端隔离。

function getConfiguredTransBaseUrl(): string {
  // `import.meta.env` is Vite-specific; guard it for non-Vite runtimes (e.g. Node tests).
  const env = (import.meta as any).env ?? {}

  // 开发环境走 Vite 代理
  if (env.DEV) return '/transmission/rpc'

  // 生产环境默认同源（推荐），不再默认指向浏览器的 localhost（远程访问会直接翻车）
  const configured = String(env.VITE_TR_URL ?? '').trim()
  return configured || '/transmission/rpc'
}

const baseURL = getConfiguredTransBaseUrl()

export const transClient = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 响应拦截器：处理 409 Conflict
transClient.interceptors.response.use(
  response => response,
  async error => {
    const is409 = error.response?.status === 409
    const hasSessionIdHeader = error.response?.headers?.['x-transmission-session-id']

    if (is409 && hasSessionIdHeader) {
      // 提取新的 Session ID
      transClient.defaults.headers['X-Transmission-Session-Id'] = String(
        error.response.headers['x-transmission-session-id'],
      )

      // 重试原请求
      return transClient.request(error.config)
    }

    return Promise.reject(error)
  }
)
