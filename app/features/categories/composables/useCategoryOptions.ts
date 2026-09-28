import type { MenuCategory } from '#shared/contracts/menu-categories'

/**
 * Every category, archived ones included, as one shared query: the Categories tree and every
 * `CategorySelect` read the same data, so a page with both makes one request and refreshes once.
 * No `default`: the tree tells "not loaded yet" (`loading`) from "no categories" (feature
 * standard §4), and every caller of this key must pass the same options.
 */
export function useAllCategories() {
  return useApiQuery('categories:all', () => apiFetch<MenuCategory[]>('/admin/menu/categories', { query: { status: 'all' } }))
}

/**
 * PUBLIC. Every category, archived ones included (a record may still use one, and its name must
 * show), for pickers; `[]` until loaded. The picker decides what's selectable (`CategorySelect`).
 */
export function useCategoryOptions() {
  const query = useAllCategories()
  return { ...query, data: computed<MenuCategory[]>(() => query.data.value ?? []) }
}
