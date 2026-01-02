<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'

const router = useRouter()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  loading.value = true
  error.value = ''
  try {
    await authStore.login(username.value, password.value)
    password.value = ''
    router.push('/')
  } catch {
    error.value = '登录失败，请检查用户名和密码'
    password.value = ''
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm">
      <!-- Logo 区域 -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-12 h-12 bg-black rounded-xl mb-4">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" />
          </svg>
        </div>
        <h1 class="text-2xl font-semibold text-gray-900 mb-2">登录</h1>
        <p class="text-gray-500 text-sm">访问种子管理系统</p>
      </div>

      <!-- 登录表单 -->
      <div class="card p-6">
        <form @submit.prevent="handleSubmit" class="space-y-4">
          <!-- 用户名 -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-700">
              用户名
            </label>
            <input
              v-model="username"
              type="text"
              class="input"
              placeholder="输入用户名"
              required
              autocomplete="username"
            />
          </div>

          <!-- 密码 -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-700">
              密码
            </label>
            <input
              v-model="password"
              type="password"
              class="input"
              placeholder="输入密码"
              required
              autocomplete="current-password"
            />
          </div>

          <!-- 错误提示 -->
          <div v-if="error" class="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p class="text-sm text-red-500 font-medium">{{ error }}</p>
            </div>
          </div>

          <!-- 登录按钮 -->
          <button
            type="submit"
            :disabled="loading"
            class="btn-primary w-full py-2.5 font-medium"
          >
            <div class="flex items-center justify-center gap-2">
              <svg v-if="loading" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ loading ? '登录中...' : '登录' }}
            </div>
          </button>
        </form>
      </div>

      <!-- 底部信息 -->
      <div class="text-center mt-8">
        <p class="text-xs text-gray-400">
          由 qBittorrent WebUI 提供支持
        </p>
      </div>
    </div>
  </div>
</template>
