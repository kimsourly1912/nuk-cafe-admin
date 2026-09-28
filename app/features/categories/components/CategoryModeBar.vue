<script setup lang="ts">
/**
 * The bar of a page mode (selection, reorder): above the tree from `md`, fixed to the bottom of
 * the screen on small ones (in thumb reach, above the home indicator: safe-area padding). The
 * page adds bottom padding on small screens so the bar never covers the last rows (D72).
 *
 * @example
 * <CategoryModeBar label="Bulk actions">
 *   <span>2 selected</span>
 *   <template #actions><UButton label="Archive selected" /></template>
 * </CategoryModeBar>
 */
defineProps<{ label: string }>()
</script>

<template>
  <div
    role="toolbar"
    :aria-label="label"
    class="fixed inset-x-0 bottom-0 z-30 max-md:mb-0 border-t border-default bg-default/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-lg backdrop-blur md:static md:z-auto md:rounded-lg md:border md:bg-elevated/40 md:py-2 md:shadow-none md:backdrop-blur-none"
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="min-w-0 flex-1 text-sm">
        <slot />
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
