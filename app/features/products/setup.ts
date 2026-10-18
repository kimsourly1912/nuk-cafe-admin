import type { ItemCounts } from '#shared/contracts/menu-items'
import type { AdminSetupStep } from '~/types/admin-setup'

/** The home page's setup step (D155): something on the customer menu. */
export const menuItemsSetup: AdminSetupStep = {
  id: 'menu-published',
  label: 'Publish your first menu item',
  description: 'Only published items are on the customer menu.',
  page: '/admin/products',
  async check() {
    const counts = await apiFetch<ItemCounts>('/admin/menu/items/counts')
    return counts.active.items > 0
  },
}

/**
 * Photos on the menu (D160): done once every published item has one. Optional: a cafe takes orders
 * without photos, but customers choose items with one more often.
 */
export const menuPhotosSetup: AdminSetupStep = {
  id: 'menu-photos',
  label: 'Add a photo to each published item',
  description: 'Customers choose items with a photo more often.',
  page: '/admin/products?status=active&photo=missing',
  optional: true,
  async check() {
    const { active } = await apiFetch<ItemCounts>('/admin/menu/items/counts')
    return active.items > 0 && active.withoutPhoto === 0
  },
}
