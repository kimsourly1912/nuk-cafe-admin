import type { NavigationMenuItem } from '@nuxt/ui'

/** "Platform support": allow the platform team to look at the cafe, read-only (P5, D193). */
export const supportNavigation: NavigationMenuItem = {
  label: 'Platform support',
  icon: 'i-lucide-life-buoy',
  to: '/admin/support',
}
