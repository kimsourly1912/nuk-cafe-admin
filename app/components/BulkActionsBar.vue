<script setup lang="ts">
/**
 * The Select mode bar (page-patterns §2, D89, D129): "3 selected · Select all" and the page's bulk
 * actions. A `BottomActionBar` named "Bulk actions": fixed to the bottom of the screen below `lg`,
 * inline where it's placed from `lg`. Render it while the page is in Select mode (`v-if`), so it also
 * shows with nothing selected yet. Supply the actions (disabled while `count` is 0).
 *
 * It carries actions only: Select mode is left from the toolbar button that started it (a toggle),
 * or with Escape. On phones the count takes its own line and the actions share the next one in equal
 * widths, so nothing wraps or overlaps.
 *
 * @example
 * <BulkActionsBar
 *   v-if="mode === 'select'"
 *   :count="selection.count"
 *   :all-selected="selection.allSelected"
 *   @toggle-all="selection.toggleAll(!selection.allSelected)"
 * >
 *   <UButton label="Archive selected" icon="i-lucide-archive" :disabled="!selection.count" @click="archiveSelected" />
 * </BulkActionsBar>
 */
defineProps<{
  count: number
  allSelected: boolean
}>()
const emit = defineEmits<{ 'toggle-all': [] }>()
</script>

<template>
  <BottomActionBar label="Bulk actions">
    <div class="flex w-full items-center gap-x-3 text-sm whitespace-nowrap sm:w-auto sm:flex-1">
      <span class="font-semibold text-highlighted">{{ count ? `${count} selected` : 'None selected' }}</span>
      <UButton
        :label="allSelected ? 'Unselect all' : 'Select all'"
        color="neutral"
        variant="link"
        class="px-0"
        @click="emit('toggle-all')"
      />
    </div>
    <!-- Phones: one row of equal-width actions; from sm: side by side at the end. -->
    <div class="grid w-full auto-cols-fr grid-flow-col gap-2 *:justify-center sm:flex sm:w-auto sm:justify-end">
      <slot />
    </div>
  </BottomActionBar>
</template>
