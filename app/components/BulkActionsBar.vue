<script setup lang="ts">
/**
 * The bulk bar while rows are selected: "5 selected · <actions> · Clear". A `BottomActionBar`
 * (pinned to the bottom of the screen on phones and tablets, of the panel from `lg`): place it last
 * in the page body. Escape clears the selection.
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
  <BottomActionBar
    label="Bulk actions"
    :open="count > 0"
    expanded="pinned"
    @keydown.esc="emit('clear')"
  >
    <span class="px-1 text-sm font-medium">{{ count }} selected</span>
    <USeparator
      orientation="vertical"
      class="h-5"
    />
    <slot />
    <UButton
      label="Clear"
      color="neutral"
      variant="ghost"
      class="ms-auto lg:ms-0"
      @click="emit('clear')"
    />
  </BottomActionBar>
</template>
