<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import { useBackendStore } from '@/store/backend'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const authStore = useAuthStore()
const backendStore = useBackendStore()

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
          <Icon name="download-cloud" :size="24" class="text-white" />
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
              <Icon name="alert-triangle" color="red" :size="16" />
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
              <Icon v-if="loading" name="loader-2" :size="16" class="animate-spin text-white" />
              {{ loading ? '登录中...' : '登录' }}
            </div>
          </button>
        </form>
      </div>

      <!-- 底部信息 -->
      <div class="text-center mt-8">
        <p class="text-xs text-gray-400">
          {{ backendStore.backendName }} WebUI
        </p>
      </div>
    </div>
  </div>
</template>
