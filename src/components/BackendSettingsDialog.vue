<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useBackendStore } from '@/store/backend'
import Icon from '@/components/Icon.vue'
import type { TransferSettings } from '@/adapter/interface'

interface Props {
  open: boolean
}

interface Emits {
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const backendStore = useBackendStore()
const adapter = computed(() => backendStore.adapter!)

const loading = ref(false)
const saving = ref(false)
const error = ref('')

const form = ref({
  downloadKbps: 0,
  uploadKbps: 0,
  altEnabled: false,
  altDownloadKbps: 0,
  altUploadKbps: 0,
})

function toKbps(bytesPerSecond: number) {
  return Math.max(0, Math.round(bytesPerSecond / 1024))
}

function toBps(kbps: number) {
  return Math.max(0, Math.round(kbps)) * 1024
}

async function load() {
  if (!props.open) return
  loading.value = true
  error.value = ''
  try {
    const settings = await adapter.value.getTransferSettings()
    form.value = {
      downloadKbps: toKbps(settings.downloadLimit),
      uploadKbps: toKbps(settings.uploadLimit),
      altEnabled: settings.altEnabled,
      altDownloadKbps: toKbps(settings.altDownloadLimit),
      altUploadKbps: toKbps(settings.altUploadLimit),
    }
  } catch (e) {
    console.error('[BackendSettingsDialog] Load failed:', e)
    error.value = e instanceof Error ? e.message : '加载设置失败'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const patch: Partial<TransferSettings> = {
      downloadLimit: toBps(form.value.downloadKbps),
      uploadLimit: toBps(form.value.uploadKbps),
      altEnabled: form.value.altEnabled,
      altDownloadLimit: toBps(form.value.altDownloadKbps),
      altUploadLimit: toBps(form.value.altUploadKbps),
    }
    await adapter.value.setTransferSettings(patch)
    emit('close')
  } catch (e) {
    console.error('[BackendSettingsDialog] Save failed:', e)
    error.value = e instanceof Error ? e.message : '保存设置失败'
  } finally {
    saving.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) load()
})

onMounted(() => {
  if (props.open) load()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="emit('close')"
    >
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <div class="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 flex items-center justify-between">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-gray-900">后端设置</h2>
            <p class="text-xs text-gray-500 mt-0.5">
              {{ backendStore.isQbit ? 'qBittorrent' : 'Transmission' }}
            </p>
          </div>
          <button class="icon-btn" title="关闭" @click="emit('close')">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="flex-1 overflow-auto p-4 sm:p-6">
          <div v-if="loading" class="text-sm text-gray-500">加载中...</div>
          <div v-else class="space-y-5">
            <div v-if="error" class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {{ error }}
            </div>

            <div class="card p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="text-sm font-medium text-gray-900">全局限速</div>
                <div class="text-xs text-gray-500">单位：KB/s（0 表示不限制）</div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <label class="space-y-1">
                  <span class="text-xs text-gray-500">下载</span>
                  <input v-model.number="form.downloadKbps" type="number" min="0" class="input" />
                </label>
                <label class="space-y-1">
                  <span class="text-xs text-gray-500">上传</span>
                  <input v-model.number="form.uploadKbps" type="number" min="0" class="input" />
                </label>
              </div>
            </div>

            <div class="card p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="text-sm font-medium text-gray-900">备用限速（ALT）</div>
                <label class="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input v-model="form.altEnabled" type="checkbox" class="rounded border-gray-300 text-blue-500 focus:ring-blue-500/20" />
                  启用
                </label>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <label class="space-y-1">
                  <span class="text-xs text-gray-500">下载</span>
                  <input v-model.number="form.altDownloadKbps" type="number" min="0" class="input" />
                </label>
                <label class="space-y-1">
                  <span class="text-xs text-gray-500">上传</span>
                  <input v-model.number="form.altUploadKbps" type="number" min="0" class="input" />
                </label>
              </div>
              <p class="text-[11px] text-gray-400 mt-3">
                部分后端可能不支持设置备用限速数值；若保存失败请查看后端版本/权限。
              </p>
            </div>
          </div>
        </div>

        <div class="border-t border-gray-200 p-3 sm:p-4 flex items-center justify-end gap-2 bg-gray-50">
          <button class="btn" :disabled="saving" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="saving || loading" @click="save">
            <span v-if="saving">保存中...</span>
            <span v-else>保存</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
