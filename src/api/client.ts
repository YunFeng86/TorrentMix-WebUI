import axios from 'axios'

function getConfiguredQbitBaseUrl(): string {
  return (import.meta.env.VITE_QB_URL ?? '').trim()
}

function isSameOrigin(baseUrl: string): boolean {
  if (!baseUrl) return true
  if (typeof window === 'undefined') return true
  try {
    const resolved = new URL(baseUrl, window.location.href)
    return resolved.origin === window.location.origin
  } catch {
    return false
  }
}

export function getQbitBaseUrl(): string {
  return getConfiguredQbitBaseUrl()
}

const baseURL = getConfiguredQbitBaseUrl()
const allowCrossOrigin = import.meta.env.VITE_ALLOW_CROSS_ORIGIN === 'true'
const sameOrigin = isSameOrigin(baseURL)
const withCredentials = sameOrigin || (allowCrossOrigin && baseURL.length > 0)

if (!sameOrigin && !allowCrossOrigin && baseURL.length > 0) {
  console.warn(
    '[Network] VITE_QB_URL is cross-origin; disabling withCredentials. Set VITE_ALLOW_CROSS_ORIGIN=true to override.'
  )
}

export const apiClient = axios.create({
  baseURL,
  timeout: 10000,
  withCredentials  // 默认仅同源携带 cookie，避免跨域凭证风险
})

// 内部标记：用于静默验证，不触发登录跳转
const SILENT_CHECK_FLAG = '__silent_check__'

// 响应拦截器：403 自动跳转登录
apiClient.interceptors.response.use(
  response => response,
  error => {
    // 静默验证请求不触发跳转，让调用方处理
    if (error.config?.headers?.[SILENT_CHECK_FLAG]) {
      return Promise.reject(error)
    }
    if (error.response?.status === 403) {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// 创建一个用于静默验证的客户端（不触发 403 跳转）
export const silentApiClient = axios.create({
  baseURL,
  timeout: 5000,  // 验证请求超时时间更短
  withCredentials
})

// 给静默请求加标记
silentApiClient.interceptors.request.use(config => {
  config.headers = config.headers || {}
  config.headers[SILENT_CHECK_FLAG] = 'true'
  return config
})
