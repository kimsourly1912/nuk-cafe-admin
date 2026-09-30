import type { NavigationMenuItem } from '@nuxt/ui'

/** Reports (step 8.1b, D111): admins only, like the whole admin workspace (R1). */
export const reportsNavigation: NavigationMenuItem[] = [
  { label: 'Summary', icon: 'i-lucide-chart-column', to: '/admin/reports/summary' },
  { label: 'Sales by item', icon: 'i-lucide-list-ordered', to: '/admin/reports/items' },
  { label: 'Order history', icon: 'i-lucide-receipt-text', to: '/admin/reports/orders' },
]
