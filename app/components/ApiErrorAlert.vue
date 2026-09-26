<script setup lang="ts">
/**
 * Inline error for failed loads (e.g. a list's `useAsyncData` error).
 *
 * @example
 * <ApiErrorAlert v-if="error" :error="error" title="Could not load categories" @retry="refresh()" />
 */
const props = defineProps<{
  error: unknown
  title?: string
}>()

const emit = defineEmits<{ retry: [] }>()

const apiError = computed(() => ApiError.from(props.error))
</script>

<template>
  <UAlert
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    :title="title ?? 'Could not load data'"
    :description="apiError.message"
    :actions="[{ label: 'Retry', icon: 'i-lucide-refresh-cw', onClick: () => emit('retry') }]"
  />
</template>
