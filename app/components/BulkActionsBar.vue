<script setup lang="ts">
/**
 * Floating bar at the bottom of the list while rows are selected: "5 selected · <actions> · Clear".
 * Place it anywhere in the page body; it's positioned over the panel (Linear-style), so it stays
 * in reach however long the list is. Escape clears the selection.
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
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="translate-y-4 opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="translate-y-4 opacity-0"
  >
    <div
      v-if="count > 0"
      role="toolbar"
      aria-label="Bulk actions"
      class="sticky bottom-4 z-20 mx-auto mt-4 flex w-fit items-center gap-2 rounded-lg border border-default bg-default/95 px-3 py-2 shadow-lg backdrop-blur"
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
        @click="emit('clear')"
      />
    </div>
  </Transition>
</template>
