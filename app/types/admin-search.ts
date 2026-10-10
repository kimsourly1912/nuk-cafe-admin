/**
 * The admin's search (Ctrl/⌘+K, D152): each feature that has records worth jumping to exports one
 * source from its `index.ts`; `utils/admin-search.ts` lists them, like the sidebar's navigation.
 */
export interface AdminSearchResult {
  id: string
  label: string
  /** A short second line: the category, the status. */
  suffix?: string
  icon?: string
  /** A photo, when the record has one. */
  image?: string | null
  /** The page inside the cafe (`/admin/products/<id>`); the shell adds the cafe's address. */
  page: string
}

export interface AdminSearchSource {
  id: string
  /** The group's heading ("Menu items"). */
  label: string
  /** At most a handful of matches for what was typed (2 characters or more). */
  search: (term: string) => Promise<AdminSearchResult[]>
}

/** The search results each source shows at most. */
export const ADMIN_SEARCH_LIMIT = 6

/** Whether `name` contains what was typed, ignoring case and accents. */
export function matchesSearch(name: string, term: string) {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return fold(name).includes(fold(term.trim()))
}
