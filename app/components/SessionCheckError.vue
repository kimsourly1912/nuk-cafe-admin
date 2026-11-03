<script setup lang="ts">
defineProps<{ error: ApiError }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <TaskFrame>
    <template
      v-if="$slots.aside"
      #aside
    >
      <slot name="aside" />
    </template>
    <template #header>
      <h1 class="text-xl font-semibold text-highlighted">
        Could not check your session
      </h1>
    </template>
    <ApiErrorAlert
      :error="error"
      title="Try checking your session again"
      @retry="$emit('retry')"
    />
  </TaskFrame>
</template>
