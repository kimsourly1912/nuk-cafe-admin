import type { NavigationMenuItem } from '@nuxt/ui'

/** "Payments": the riel rate for cash payments (D102). */
export const exchangeRatesNavigation: NavigationMenuItem = {
  label: 'Payments',
  icon: 'i-lucide-banknote',
  to: '/admin/payments',
}
