import type { UnwrapRef } from 'vue'

/**
 * Filter + pagination state for list pages, kept in the URL (`/admin/categories?search=tea&page=2`),
 * so reload, back/forward and shared links keep the user's place.
 * - `page` is 1-based, as in UPagination and the API; `query` adds it and `pageSize` to the filters.
 * - Changing any filter resets to page 1.
 * - `ANY` / '' filter values are dropped from `query`; default values are left out of the URL.
 * - The URL is updated with `router.replace` (filter changes don't add history entries). Changing
 *   the URL (sidebar link to the bare list, back/forward) updates the filters.
 *
 * @example
 * const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({ search: '', status: ANY as string })
 * const { data } = useScheduleList(query)
 */
export function usePaginatedQuery<T extends Record<string, unknown>>(
  initialFilters: T,
  options: { pageSize?: number, syncUrl?: boolean } = {},
) {
  const { pageSize = 20, syncUrl = true } = options
  const defaults = { ...initialFilters }
  const page = ref(1)
  const filters = reactive({ ...initialFilters })

  // Sync watcher so a change applied from the URL (which also sets the page) can be told apart.
  let applyingUrl = false
  watch(filters, () => {
    if (!applyingUrl) page.value = 1
  }, { deep: true, flush: 'sync' })

  if (syncUrl) {
    const route = useRoute()
    const router = useRouter()
    // Only this page's URL: during navigation away, the route already points elsewhere.
    const path = route.path
    const onThisPage = () => router.currentRoute.value.path === path

    const applyUrl = () => {
      const state = fromUrlQuery(route.query, defaults)
      applyingUrl = true
      Object.assign(filters, state.filters)
      page.value = state.page
      applyingUrl = false
    }
    applyUrl()
    watch(() => route.query, () => {
      if (onThisPage()) applyUrl()
    })

    watch([filters, page], () => {
      if (!onThisPage()) return
      const current = router.currentRoute.value.query
      const own = toUrlQuery(filters, defaults, page.value)
      // Keep query params this composable doesn't own.
      const others = Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'page' && !(key in defaults)))
      const next = { ...others, ...own }
      if (JSON.stringify(next) !== JSON.stringify(current)) router.replace({ query: next })
    }, { deep: true })
  }

  const query = computed(() => ({
    ...toApiQuery(filters as UnwrapRef<T>),
    page: page.value,
    pageSize,
  }))

  /** Whether any filter differs from its default (for "No results" vs "Nothing here yet"). */
  const isFiltered = computed(() => Object.keys(defaults).some(key => (filters as Record<string, unknown>)[key] !== defaults[key]))

  function clearFilters() {
    Object.assign(filters, defaults)
  }

  return { page, pageSize, filters, query, isFiltered, clearFilters }
}
