<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useBackendStore } from '@/store/backend'
import type { TransferSettings, BackendPreferences } from '@/adapter/interface'

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

// 当前激活的 Tab
type TabId = 'transfer' | 'connection' | 'queue' | 'port' | 'protocol'
const activeTab = ref<TabId>('transfer')

const loading = ref(false)
const saving = ref(false)
const error = ref('')

// 传输设置表单（使用 TransferSettings）
const transferForm = ref({
  downloadKbps: 0,
  uploadKbps: 0,
  altEnabled: false,
  altDownloadKbps: 0,
  altUploadKbps: 0,
})

// 偏好设置表单（使用 BackendPreferences）
const prefsForm = ref<BackendPreferences>({})

// qB 的队列开关是全局的（同时影响下载/做种队列）；保持表单字段同步，避免 UI 产生矛盾状态
watch(() => prefsForm.value.queueDownloadEnabled, (val) => {
  if (!backendStore.isQbit) return
  if (val === undefined) return
  if (prefsForm.value.queueSeedEnabled !== val) {
    prefsForm.value.queueSeedEnabled = val
  }
})

// Tab 配置
const tabs = computed(() => {
  return [
    { id: 'transfer' as TabId, label: '带宽', visible: true },
    { id: 'connection' as TabId, label: '连接', visible: true },
    { id: 'queue' as TabId, label: '队列', visible: true },
    { id: 'port' as TabId, label: '端口', visible: true },
    { id: 'protocol' as TabId, label: '协议', visible: true },
  ].filter(t => t.visible)
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
    // 并行加载传输设置和偏好设置
    const [transferSettings, preferences] = await Promise.all([
      adapter.value.getTransferSettings(),
      adapter.value.getPreferences()
    ])

    transferForm.value = {
      downloadKbps: toKbps(transferSettings.downloadLimit),
      uploadKbps: toKbps(transferSettings.uploadLimit),
      altEnabled: transferSettings.altEnabled,
      altDownloadKbps: toKbps(transferSettings.altDownloadLimit),
      altUploadKbps: toKbps(transferSettings.altUploadLimit),
    }

    prefsForm.value = preferences
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
    // 保存传输设置
    const transferPatch: Partial<TransferSettings> = {
      downloadLimit: toBps(transferForm.value.downloadKbps),
      uploadLimit: toBps(transferForm.value.uploadKbps),
      altEnabled: transferForm.value.altEnabled,
      altDownloadLimit: toBps(transferForm.value.altDownloadKbps),
      altUploadLimit: toBps(transferForm.value.altUploadKbps),
    }
    await adapter.value.setTransferSettings(transferPatch)

    // 保存偏好设置
    await adapter.value.setPreferences(prefsForm.value)

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
      <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <!-- 头部 -->
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-semibold">后端设置</h2>
          <p class="text-xs text-gray-500">{{ backendStore.backendName }}</p>
        </div>

        <!-- Tab 导航 -->
        <div class="border-b border-gray-200 px-6">
          <nav class="flex gap-6 -mb-px">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="activeTab = tab.id"
              :class="`px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`"
            >
              {{ tab.label }}
            </button>
          </nav>
        </div>

        <!-- 内容区 -->
        <div class="flex-1 overflow-auto p-6">
          <div v-if="loading" class="text-sm text-gray-500">加载中...</div>

          <div v-else class="space-y-4">
            <div v-if="error" class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {{ error }}
            </div>

            <!-- 带宽 Tab -->
            <div v-if="activeTab === 'transfer'" class="space-y-4">
              <div class="card p-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="text-sm font-medium text-gray-900">全局限速</div>
                  <div class="text-xs text-gray-500">单位：KB/s（0 表示不限制）</div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">下载</span>
                    <input v-model.number="transferForm.downloadKbps" type="number" min="0" class="input" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">上传</span>
                    <input v-model.number="transferForm.uploadKbps" type="number" min="0" class="input" />
                  </label>
                </div>
              </div>

              <div class="card p-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="text-sm font-medium text-gray-900">备用限速（ALT）</div>
                  <label class="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input v-model="transferForm.altEnabled" type="checkbox" class="rounded border-gray-300 text-blue-500 focus:ring-blue-500/20" />
                    启用
                  </label>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">下载</span>
                    <input v-model.number="transferForm.altDownloadKbps" type="number" min="0" class="input" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">上传</span>
                    <input v-model.number="transferForm.altUploadKbps" type="number" min="0" class="input" />
                  </label>
                </div>
              </div>
            </div>

            <!-- 连接 Tab -->
            <div v-if="activeTab === 'connection'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">连接限制</h3>
                <div class="grid grid-cols-2 gap-4">
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">全局最大连接数</span>
                    <input v-model.number="prefsForm.maxConnections" type="number" min="0" class="input" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">单种子最大连接数</span>
                    <input v-model.number="prefsForm.maxConnectionsPerTorrent" type="number" min="0" class="input" />
                  </label>
                </div>
              </div>
            </div>

            <!-- 队列 Tab -->
            <div v-if="activeTab === 'queue'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">下载队列</h3>
                <div class="space-y-3">
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.queueDownloadEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">{{ backendStore.isQbit ? '启用队列（下载/做种）' : '启用下载队列' }}</span>
                  </label>
                  <label v-if="prefsForm.queueDownloadEnabled" class="space-y-1">
                    <span class="text-xs text-gray-500">同时下载数</span>
                    <input v-model.number="prefsForm.queueDownloadMax" type="number" min="1" class="input" />
                  </label>
                </div>
              </div>

              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">做种队列</h3>
                <div class="space-y-3">
                  <label class="flex items-center gap-2">
                    <input
                      v-if="backendStore.isQbit"
                      :checked="prefsForm.queueDownloadEnabled"
                      type="checkbox"
                      class="rounded"
                      disabled
                    />
                    <input
                      v-else
                      v-model="prefsForm.queueSeedEnabled"
                      type="checkbox"
                      class="rounded"
                    />
                    <span class="text-sm">启用做种队列</span>
                    <span v-if="backendStore.isQbit" class="text-xs text-gray-500">（由全局队列开关控制）</span>
                  </label>
                  <label v-if="prefsForm.queueSeedEnabled" class="space-y-1">
                    <span class="text-xs text-gray-500">同时做种数</span>
                    <input v-model.number="prefsForm.queueSeedMax" type="number" min="1" class="input" />
                  </label>
                </div>
              </div>
            </div>

            <!-- 端口 Tab -->
            <div v-if="activeTab === 'port'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">监听端口</h3>
                <div class="space-y-3">
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.randomPort" type="checkbox" class="rounded" />
                    <span class="text-sm">随机端口</span>
                  </label>
                  <label v-if="!prefsForm.randomPort" class="space-y-1">
                    <span class="text-xs text-gray-500">端口号（1-65535）</span>
                    <input v-model.number="prefsForm.listenPort" type="number" min="1" max="65535" class="input" />
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.upnpEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">UPnP 端口映射</span>
                  </label>
                </div>
              </div>
            </div>

            <!-- 协议 Tab（qB 专属） -->
            <div v-if="activeTab === 'protocol'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">协议支持</h3>
                <div class="space-y-2">
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.dhtEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">启用 DHT</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.pexEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">启用 PeX</span>
                  </label>
                  <label v-if="backendStore.isQbit" class="flex items-center gap-2">
                    <input v-model="prefsForm.lsdEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">启用 LSD</span>
                  </label>
                </div>
              </div>

              <div v-if="backendStore.isQbit" class="card p-4">
                <h3 class="text-sm font-medium mb-3">加密模式</h3>
                <div class="space-y-2">
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.encryption" type="radio" value="prefer" class="rounded" />
                    <span class="text-sm">优先加密（允许回退）</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.encryption" type="radio" value="require" class="rounded" />
                    <span class="text-sm">强制加密</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.encryption" type="radio" value="disable" class="rounded" />
                    <span class="text-sm">禁用加密</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="border-t border-gray-200 p-4 bg-gray-50 flex justify-end gap-2">
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
