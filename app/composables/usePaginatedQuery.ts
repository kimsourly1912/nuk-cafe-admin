import type { UnwrapRef } from 'vue'

/** The rows-per-page choices (D128); the API takes up to `MAX_PAGE_SIZE` (100). */
export const PAGE_SIZES = [10, 20, 50, 100] as const

/** `?pageSize=` read back: one of the choices, else the default. */
function pageSizeFrom(raw: unknown, fallback: number): number {
  const size = Number(raw)
  return (PAGE_SIZES as readonly number[]).includes(size) ? size : fallback
}

/**
 * Filter + pagination state for list pages, kept in the URL (`/admin/categories?search=tea&page=2`),
 * so reload, back/forward and shared links keep the user's place.
 * - `page` is 1-based, as in UPagination and the API; `query` adds it and `pageSize` to the filters.
 * - `pageSize` (rows per page, one of `PAGE_SIZES`) is kept in the URL too when it isn't the default
 *   (`?pageSize=50`, D128); changing it goes back to page 1.
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
  const { pageSize: defaultPageSize = 20, syncUrl = true } = options
  const defaults = { ...initialFilters }
  const page = ref(1)
  const pageSize = ref(defaultPageSize)
  const filters = reactive({ ...initialFilters })

  // Sync watcher so a change applied from the URL (which also sets the page) can be told apart.
  let applyingUrl = false
  watch(filters, () => {
    if (!applyingUrl) page.value = 1
  }, { deep: true, flush: 'sync' })
  // Another page size: the old page may not exist any more.
  watch(pageSize, () => {
    if (!applyingUrl) page.value = 1
  }, { flush: 'sync' })

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
      pageSize.value = pageSizeFrom(route.query.pageSize, defaultPageSize)
      page.value = state.page
      applyingUrl = false
    }
    applyUrl()
    watch(() => route.query, () => {
      if (onThisPage()) applyUrl()
    })

    watch([filters, page, pageSize], () => {
      if (!onThisPage()) return
      const current = router.currentRoute.value.query
      const own: Record<string, string> = toUrlQuery(filters, defaults, page.value)
      if (pageSize.value !== defaultPageSize) own.pageSize = String(pageSize.value)
      // Keep query params this composable doesn't own.
      const others = Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'page' && key !== 'pageSize' && !(key in defaults)))
      const next = { ...others, ...own }
      if (JSON.stringify(next) !== JSON.stringify(current)) router.replace({ query: next })
    }, { deep: true })
  }

  const query = computed(() => ({
    ...toApiQuery(filters as UnwrapRef<T>),
    page: page.value,
    pageSize: pageSize.value,
  }))

  /** Whether any filter differs from its default (for "No results" vs "Nothing here yet"). */
  const isFiltered = computed(() => Object.keys(defaults).some(key => (filters as Record<string, unknown>)[key] !== defaults[key]))

  function clearFilters() {
    Object.assign(filters, defaults)
  }

  return { page, pageSize, filters, query, isFiltered, clearFilters }
}
