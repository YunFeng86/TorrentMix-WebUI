import axios from 'axios'

// 开发环境使用相对路径走 Vite 代理，生产环境使用完整 URL
const isDev = import.meta.env.DEV
export const apiClient = axios.create({
  baseURL: isDev ? '' : (import.meta.env.VITE_QB_URL || 'http://localhost:8080'),
  timeout: 10000,
  withCredentials: true  // 携带 SID cookie
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
  baseURL: isDev ? '' : (import.meta.env.VITE_QB_URL || 'http://localhost:8080'),
  timeout: 5000,  // 验证请求超时时间更短
  withCredentials: true
})

// 给静默请求加标记
silentApiClient.interceptors.request.use(config => {
  config.headers = config.headers || {}
  config.headers[SILENT_CHECK_FLAG] = 'true'
  return config
})
