import type { Category } from '#shared/contracts/menu'

export interface CategoryOptionsFilter {
  /** Only main categories, or only sub-categories. */
  level?: 'main' | 'sub'
}

/**
 * PUBLIC. Every category for pickers (e.g. `level: 'main'` for parent selects).
 * Keyed per filter so different pickers don't overwrite each other.
 */
export function useCategoryOptions(filter: MaybeRefOrGetter<CategoryOptionsFilter> = {}) {
  return useApiQuery(
    () => `categories:options:${toValue(filter).level ?? 'all'}`,
    () => apiFetch<Category[]>('/v1/admin/categories', { query: { level: toValue(filter).level } }),
    { default: () => [] },
  )
}
