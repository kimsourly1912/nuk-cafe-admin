import { categoriesSearch } from '~/features/categories'
import { modifierGroupsSearch } from '~/features/modifier-groups'
import { optionSetsSearch } from '~/features/option-sets'
import { menuItemsSearch } from '~/features/products'
import type { AdminSearchSource } from '~/types/admin-search'

/**
 * What the admin's search looks in (Ctrl/⌘+K, D152), in this order. Each feature exports its own
 * source from its index.ts; this file only decides which and in what order, like the sidebar.
 */
export function adminSearchSources(): AdminSearchSource[] {
  return [menuItemsSearch, categoriesSearch, optionSetsSearch, modifierGroupsSearch]
}
