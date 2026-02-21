import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // 生产构建使用相对 base，保证部署在子路径（例如 /transmission/web/）也能正确加载静态资源。
  base: command === 'build' ? './' : '/',
  plugins: [vue()],
  build: {
    // 生成 Vite manifest，供发布脚本稳定解析入口产物（避免对 index.html 结构产生隐式依赖）。
    manifest: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    proxy: {
      // qBittorrent WebAPI
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
      // Transmission RPC
      '/transmission': {
        target: 'http://localhost:9091',
        changeOrigin: true,
        // 不重写路径，因为 trans-client 直接请求 /transmission/rpc
        rewrite: undefined
      }
    }
  }
}))
