import type { Page } from '#shared/contracts/common'
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import type { AdminSearchSource } from '~/types/admin-search'
import { ADMIN_SEARCH_LIMIT } from '~/types/admin-search'
import { ITEM_STATUS_LABELS } from './utils/item-display'

/** Menu items in the admin's search (D152): the server's own search, archived ones too, each opening its editor. */
export const menuItemsSearch: AdminSearchSource = {
  id: 'products',
  label: 'Menu items',
  async search(term) {
    const page = await apiFetch<Page<MenuItemSummary>>('/admin/menu/items', { query: { search: term, status: 'all', pageSize: ADMIN_SEARCH_LIMIT } })
    return page.items.map(item => ({
      id: item.id,
      label: item.name,
      suffix: [item.categoryName, ITEM_STATUS_LABELS[item.status]].filter(Boolean).join(' · '),
      icon: 'i-lucide-utensils',
      image: item.imageUrl,
      page: `/admin/products/${item.id}`,
    }))
  },
}
