<script setup lang="ts">
import { type Component as VueComponent, computed } from 'vue'
import * as Icons from 'lucide-vue-next'

// 将 kebab-case 转为 PascalCase
// 例如: "upload-cloud" -> "UploadCloud", "x" -> "X"
function toPascalCase(str: string): string {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

type IconName = keyof typeof Icons

// 图标颜色映射
const iconColors = {
  // 状态色
  blue: 'text-blue-500',
  cyan: 'text-cyan-500',
  green: 'text-green-500',
  gray: 'text-gray-400',
  purple: 'text-purple-500',
  red: 'text-red-500',
  yellow: 'text-yellow-500',
  orange: 'text-orange-500',
  // 特殊色
  white: 'text-white',
  // 默认
  default: 'text-current',
} as const

type IconColor = keyof typeof iconColors
type IconColorValue = IconColor | 'white'

interface Props {
  name: string
  size?: number
  color?: IconColorValue
  class?: string | Record<string, boolean>
}

const props = withDefaults(defineProps<Props>(), {
  size: 16,
  color: 'default',
})

// 转换图标名称为 PascalCase
const iconName = computed(() => toPascalCase(props.name) as IconName)
const iconComponent = computed(() => Icons[iconName.value] as VueComponent)
const colorClass = computed(() => iconColors[props.color as IconColor] || props.color || '')
</script>

<template>
  <component
    :is="iconComponent"
    :size="size"
    :class="[colorClass, props.class]"
  />
</template>
