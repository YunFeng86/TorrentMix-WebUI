<script setup lang="ts">
import { computed } from 'vue'
import { escapeHtml } from '@/utils/security'

const props = withDefaults(defineProps<{
  text: unknown
  as?: string
}>(), {
  as: 'span',
})

const escaped = computed(() => escapeHtml(props.text))
</script>

<template>
  <component :is="as" v-bind="$attrs" v-html="escaped" />
</template>

