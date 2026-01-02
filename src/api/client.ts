import axios from 'axios'

// 开发环境使用相对路径走 Vite 代理，生产环境使用完整 URL
const isDev = import.meta.env.DEV
export const apiClient = axios.create({
  baseURL: isDev ? '' : (import.meta.env.VITE_QB_URL || 'http://localhost:8080'),
  timeout: 10000,
  withCredentials: true  // 携带 SID cookie
})

// 响应拦截器：403 自动跳转登录
apiClient.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 403) {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
