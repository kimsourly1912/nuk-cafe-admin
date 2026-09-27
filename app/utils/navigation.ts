import type { NavigationMenuItem } from '@nuxt/ui'
import { categoriesNavigation } from '~/features/categories'
import { productsNavigation } from '~/features/products'
import { schedulesNavigation } from '~/features/schedules'
import { staffNavigation } from '~/features/staff'

/**
 * Sidebar, grouped by area. Each feature exports its own entry from its index.ts;
 * this file only decides grouping and order.
 */
export const navigationItems: NavigationMenuItem[][] = [
  [
    { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  ],
  [
    { label: 'Menu', type: 'label' },
    productsNavigation,
    categoriesNavigation,
    schedulesNavigation,
  ],
  [
    { label: 'Admin', type: 'label' },
    staffNavigation,
  ],
]
