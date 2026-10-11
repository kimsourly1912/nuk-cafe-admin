import type { NavigationMenuItem } from '@nuxt/ui'

/** Channels (M2a, D164): the cafe's social channels that promotions are posted to. */
export const marketingNavigation: NavigationMenuItem = {
  label: 'Channels',
  icon: 'i-lucide-megaphone',
  to: '/admin/channels',
}
