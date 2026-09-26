<script setup lang="ts">
/**
 * Shown when table rows are selected: "5 selected · <actions> · Clear".
 *
 * @example
 * <BulkActionsBar :count="selection.count" @clear="selection.clear()">
 *   <UButton label="Delete" color="error" variant="subtle" icon="i-lucide-trash-2" @click="removeSelected" />
 * </BulkActionsBar>
 */
defineProps<{ count: number }>()
const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div
    v-if="count > 0"
    class="flex items-center gap-2"
  >
    <span class="text-sm text-muted">{{ count }} selected</span>
    <slot />
    <UButton
      label="Clear"
      color="neutral"
      variant="ghost"
      @click="emit('clear')"
    />
  </div>
</template>
