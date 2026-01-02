<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'

const router = useRouter()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')

async function handleSubmit() {
  try {
    await authStore.login(username.value, password.value)
    router.push('/')
  } catch {
    error.value = '登录失败，请检查用户名和密码'
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="max-w-md w-full bg-white p-8 rounded-lg shadow">
      <h1 class="text-2xl font-bold mb-6">qBittorrent WebUI</h1>
      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">用户名</label>
          <input v-model="username" type="text" class="w-full border rounded px-3 py-2" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">密码</label>
          <input v-model="password" type="password" class="w-full border rounded px-3 py-2" required>
        </div>
        <p v-if="error" class="text-red-500 text-sm">{{ error }}</p>
        <button type="submit" class="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600">
          登录
        </button>
      </form>
    </div>
  </div>
</template>
