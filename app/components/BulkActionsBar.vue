<script setup lang="ts">
/**
 * The Select mode bar (page-patterns §2, D89): "3 selected · Select all · <actions> · ✕". A
 * `BottomActionBar` named "Bulk actions": fixed to the bottom of the screen below `lg`, inline where
 * it's placed from `lg`. Render it while the page is in Select mode (`v-if`), so it also shows with
 * nothing selected yet; the ✕ leaves the mode. Supply the actions (disabled while `count` is 0).
 *
 * @example
 * <BulkActionsBar
 *   v-if="mode === 'select'"
 *   :count="selection.count"
 *   :all-selected="selection.allSelected"
 *   @toggle-all="selection.toggleAll(!selection.allSelected)"
 *   @exit="exitSelect()"
 * >
 *   <UButton label="Archive selected" icon="i-lucide-archive" :disabled="!selection.count" @click="archiveSelected" />
 * </BulkActionsBar>
 */
defineProps<{
  count: number
  allSelected: boolean
}>()
const emit = defineEmits<{ 'toggle-all': [], 'exit': [] }>()
</script>

<template>
  <BottomActionBar label="Bulk actions">
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 text-sm">
      <span class="font-semibold text-highlighted">{{ count }} selected</span>
      <UButton
        :label="allSelected ? 'Unselect all' : 'Select all'"
        color="neutral"
        variant="link"
        class="px-0"
        @click="emit('toggle-all')"
      />
    </div>
    <div class="flex flex-wrap items-center justify-end gap-2">
      <slot />
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Exit selection"
        @click="emit('exit')"
      />
    </div>
  </BottomActionBar>
</template>
