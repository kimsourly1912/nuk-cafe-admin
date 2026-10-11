import type { NavigationMenuItem } from '@nuxt/ui'

/** Promotions (M1, D163): discounts on the menu, with their posters. */
export const promotionsNavigation: NavigationMenuItem = {
  label: 'Promotions',
  icon: 'i-lucide-badge-percent',
  to: '/admin/promotions',
}
