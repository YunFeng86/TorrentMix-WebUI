import axios from 'axios'

/**
 * Transmission RPC 客户端
 *
 * 特殊处理：
 * - 自动处理 409 Conflict，提取 X-Transmission-Session-Id 并重试
 * - Session ID 按实例隔离
 */

// Session ID 存储（按实例作用域隔离）
let sessionId = ''

export const transClient = axios.create({
  baseURL: import.meta.env.VITE_TR_URL || 'http://localhost:9091/transmission/rpc',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

/**
 * 设置 Session ID
 * 用于从外部（如探测逻辑）设置已获取的 Session ID
 */
export function setTransmissionSessionId(id: string) {
  sessionId = id
  transClient.defaults.headers['X-Transmission-Session-Id'] = id
}

// 响应拦截器：处理 409 Conflict
transClient.interceptors.response.use(
  response => response,
  async error => {
    const is409 = error.response?.status === 409
    const hasSessionIdHeader = error.response?.headers?.['x-transmission-session-id']

    if (is409 && hasSessionIdHeader) {
      // 提取新的 Session ID
      sessionId = error.response.headers['x-transmission-session-id']
      transClient.defaults.headers['X-Transmission-Session-Id'] = sessionId

      // 重试原请求
      return transClient.request(error.config)
    }

    return Promise.reject(error)
  }
)
