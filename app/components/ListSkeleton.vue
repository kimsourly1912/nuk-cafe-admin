<script setup lang="ts">
/**
 * Placeholder while a list loads for the first time: rows or cards shaped like the real ones,
 * so nothing jumps when the data arrives (instead of "Loading…" text). The label is for screen
 * readers.
 *
 * @example
 * <ListSkeleton v-if="loading" label="Loading menu items…" variant="card" />
 */
withDefaults(defineProps<{
  label: string
  variant?: 'row' | 'card'
  count?: number
}>(), { variant: 'row', count: 5 })
</script>

<template>
  <div
    role="status"
    :aria-label="label"
  >
    <span class="sr-only">{{ label }}</span>
    <div
      v-if="variant === 'card'"
      class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4"
    >
      <div
        v-for="i in count"
        :key="i"
        class="overflow-hidden rounded-lg border border-default"
      >
        <USkeleton class="aspect-4/3 w-full rounded-none" />
        <div class="space-y-2 p-3">
          <USkeleton class="h-4 w-3/4" />
          <USkeleton class="h-3 w-1/3" />
        </div>
      </div>
    </div>
    <div
      v-else
      class="divide-y divide-default"
    >
      <div
        v-for="i in count"
        :key="i"
        class="flex items-center gap-4 py-4"
      >
        <USkeleton class="size-4 rounded" />
        <USkeleton class="size-10 rounded-md" />
        <div class="flex-1 space-y-2">
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-3 w-1/2" />
        </div>
        <USkeleton class="h-5 w-16 rounded-full" />
      </div>
    </div>
  </div>
</template>
