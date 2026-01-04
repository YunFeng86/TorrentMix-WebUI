<script setup lang="ts">
import type { ColumnState } from '@/composables/useTableColumns/types'
import Icon from '@/components/Icon.vue'

interface Props {
  open: boolean
  columns: ColumnState[]
}

interface Emits {
  (e: 'close'): void
  (e: 'toggleVisibility', columnId: string): void
  (e: 'reset'): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

function handleReset() {
  if (confirm('确定要重置所有列宽和可见性为默认设置吗?')) {
    emit('reset')
  }
}
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
          <h2 class="text-lg font-semibold text-gray-900">列设置</h2>
          <button class="icon-btn" title="关闭" @click="emit('close')">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="flex-1 overflow-auto p-4 sm:p-6">
          <div class="text-xs font-medium text-gray-500 mb-2">显示列</div>
          <label
            v-for="column in columns"
            :key="column.id"
            class="flex items-center gap-2 px-2 py-2 hover:bg-gray-50 cursor-pointer rounded text-sm transition-colors duration-150"
            :class="{ 'opacity-50 cursor-not-allowed': column.visible && columns.filter(c => c.visible).length <= 1 }"
          >
            <input
              type="checkbox"
              :checked="column.visible"
              :disabled="column.visible && columns.filter(c => c.visible).length <= 1"
              @change="emit('toggleVisibility', column.id)"
              class="rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
            />
            <span class="flex-1">{{ column.label || '(空列)' }}</span>
          </label>

          <div class="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
            <button class="btn" @click="handleReset">重置为默认</button>
            <button class="btn btn-primary" @click="emit('close')">完成</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
