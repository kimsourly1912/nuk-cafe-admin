<script setup lang="ts">
/**
 * Empty table content (`UTable`'s `#empty` slot). Tells "nothing exists yet" (offer to create)
 * apart from "filters hide everything" (offer to clear them).
 *
 * @example
 * <template #empty>
 *   <ListEmptyState noun="categories" :filtered="isFiltered" create-label="New category"
 *                   @create="openForm()" @clear="clearFilters()" />
 * </template>
 */
defineProps<{
  /** Plural, lower case: "categories". */
  noun: string
  /** Whether filters are active (`usePaginatedQuery().isFiltered`). */
  filtered: boolean
  /** Label of the create button. Omit for lists where users can't create. */
  createLabel?: string
}>()

const emit = defineEmits<{ create: [], clear: [] }>()
</script>

<template>
  <div class="flex flex-col items-center gap-2 py-10 text-center">
    <UIcon
      :name="filtered ? 'i-lucide-search-x' : 'i-lucide-inbox'"
      class="size-10 text-dimmed"
    />
    <p class="font-medium text-highlighted">
      {{ filtered ? `No ${noun} match your filters` : `No ${noun} yet` }}
    </p>
    <p class="text-sm text-muted">
      {{ filtered ? 'Try a different search, or clear the filters.' : `${noun[0]?.toUpperCase()}${noun.slice(1)} you add will show up here.` }}
    </p>
    <UButton
      v-if="filtered"
      class="mt-2"
      label="Clear filters"
      color="neutral"
      variant="outline"
      @click="emit('clear')"
    />
    <UButton
      v-else-if="createLabel"
      class="mt-2"
      :label="createLabel"
      icon="i-lucide-plus"
      @click="emit('create')"
    />
  </div>
</template>
