<script setup lang="ts">
/**
 * The pager of a paginated list (owner, 2026-10-02, D128): "Page [3] of 10 · Rows per page [20]" on
 * the left; first, previous, the page numbers ("1 2 3 … 8 9 10"), next and last on the right. Typing
 * a page and pressing Enter (or leaving the box) goes there, kept between 1 and the last page. A
 * new page size goes back to page 1 (`usePaginatedQuery` does it, and keeps both in the URL).
 * On phones: Previous, "Page [3] of 10" and Next in one row, rows per page under it.
 * Nothing shows while the whole list fits on the smallest page.
 *
 * @example
 * <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="data?.total ?? 0" />
 */

const props = defineProps<{ total: number }>()
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / pageSize.value)))
const shown = computed(() => props.total > PAGE_SIZES[0])
const sizes: { label: string, value: number }[] = PAGE_SIZES.map(size => ({ label: String(size), value: size }))

/** The page box's value, applied on Enter or leaving it, kept within the pages that exist. */
function goTo(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return
  page.value = Math.min(Math.max(1, Math.round(value)), pageCount.value)
}
</script>

<template>
  <nav
    v-if="shown"
    aria-label="Pagination"
    class="flex flex-col gap-3 rounded-lg border border-default px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4"
  >
    <div class="flex items-center justify-between gap-2 sm:justify-start sm:gap-4">
      <UButton
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        aria-label="Previous page"
        :disabled="page <= 1"
        class="sm:hidden"
        @click="goTo(page - 1)"
      />
      <div class="flex items-center gap-2 text-sm text-muted">
        <span>Page</span>
        <UInputNumber
          :model-value="page"
          :min="1"
          :max="pageCount"
          :increment="false"
          :decrement="false"
          aria-label="Page number"
          class="w-16"
          :ui="{ base: 'text-center' }"
          @update:model-value="goTo"
        />
        <span>of {{ pageCount }}</span>
      </div>
      <UButton
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="outline"
        aria-label="Next page"
        :disabled="page >= pageCount"
        class="sm:hidden"
        @click="goTo(page + 1)"
      />
      <USeparator
        orientation="vertical"
        class="h-5 max-sm:hidden"
      />
      <div class="flex items-center gap-2 text-sm text-muted max-sm:hidden">
        <span>Rows per page</span>
        <USelect
          v-model="pageSize"
          :items="sizes"
          aria-label="Rows per page"
          class="w-20"
        />
      </div>
    </div>

    <div class="flex items-center justify-center gap-2 text-sm text-muted sm:hidden">
      <span>Rows per page</span>
      <USelect
        v-model="pageSize"
        :items="sizes"
        aria-label="Rows per page"
        size="sm"
        class="w-20"
      />
    </div>

    <UPagination
      v-model:page="page"
      :total="total"
      :items-per-page="pageSize"
      show-edges
      :sibling-count="1"
      class="max-sm:hidden"
    />
  </nav>
</template>
