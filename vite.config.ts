import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
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
})
