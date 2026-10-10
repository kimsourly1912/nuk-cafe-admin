import type { MenuCategory } from '#shared/contracts/menu-categories'
import type { AdminSearchSource } from '~/types/admin-search'
import { ADMIN_SEARCH_LIMIT, matchesSearch } from '~/types/admin-search'

/** Categories in the admin's search (D152): the Categories page searching for it, every status. */
export const categoriesSearch: AdminSearchSource = {
  id: 'categories',
  label: 'Categories',
  async search(term) {
    const all = await apiFetch<MenuCategory[]>('/admin/menu/categories', { query: { status: 'all' } })
    return all.filter(category => matchesSearch(category.name, term)).slice(0, ADMIN_SEARCH_LIMIT).map(category => ({
      id: category.id,
      label: category.name,
      suffix: category.status === 'archived' ? 'Archived' : undefined,
      icon: 'i-lucide-tags',
      page: `/admin/categories?search=${encodeURIComponent(category.name)}&status=all`,
    }))
  },
}
