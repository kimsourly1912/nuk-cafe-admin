import type { UnwrapRef } from 'vue'

/**
 * Filter + pagination state for list pages.
 * - `page` is 1-based (for UPagination); `query` converts it to the API's 0-based `page` + `size`.
 * - Changing any filter resets to page 1.
 * - `ANY` / '' filter values are dropped from `query`.
 *
 * @example
 * const { page, pageSize, filters, query } = usePaginatedQuery({ search: '', status: ANY as Status | Any })
 * const { data } = useCategoryList(query)
 */
export function usePaginatedQuery<T extends Record<string, unknown>>(initialFilters: T, options: { pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 20
  const page = ref(1)
  const filters = reactive({ ...initialFilters })

  watch(filters, () => {
    page.value = 1
  }, { deep: true })

  const query = computed(() => ({
    ...toApiQuery(filters as UnwrapRef<T>),
    page: page.value - 1,
    size: pageSize,
  }))

  return { page, pageSize, filters, query }
}
