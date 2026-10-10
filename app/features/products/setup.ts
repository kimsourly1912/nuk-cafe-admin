import type { Page } from '#shared/contracts/common'
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import type { AdminSetupStep } from '~/types/admin-setup'

/** The home page's setup step (D155): something on the customer menu. */
export const menuItemsSetup: AdminSetupStep = {
  id: 'menu-published',
  label: 'Publish your first menu item',
  description: 'Only published items are on the customer menu.',
  page: '/admin/products',
  async check() {
    const page = await apiFetch<Page<MenuItemSummary>>('/admin/menu/items', { query: { status: 'active', pageSize: 1 } })
    return page.total > 0
  },
}
