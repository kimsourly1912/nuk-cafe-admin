import type { Category } from '#shared/contracts/menu'

export interface LegacyCategoryOptionsFilter {
  /** Only main categories, or only sub-categories. */
  level?: 'main' | 'sub'
}

/**
 * TEMPORARY (removed in 3.8b part 3b): legacy `/api/v1` categories for the old Menu items screen.
 * Every category for pickers (e.g. `level: 'main'` for parent selects).
 * Keyed per filter so different pickers don't overwrite each other.
 */
export function useLegacyCategoryOptions(filter: MaybeRefOrGetter<LegacyCategoryOptionsFilter> = {}) {
  return useApiQuery(
    () => `categories:legacy-options:${toValue(filter).level ?? 'all'}`,
    () => apiFetch<Category[]>('/v1/admin/categories', { query: { level: toValue(filter).level } }),
    { default: () => [] },
  )
}
