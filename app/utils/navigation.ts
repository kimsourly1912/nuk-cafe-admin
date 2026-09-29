import type { NavigationMenuItem } from '@nuxt/ui'
import { availabilityRulesNavigation } from '~/features/availability-rules'
import { branchesNavigation } from '~/features/branches'
import { categoriesNavigation } from '~/features/categories'
import { modifierGroupsNavigation } from '~/features/modifier-groups'
import { optionSetsNavigation } from '~/features/option-sets'
import { productsNavigation } from '~/features/products'
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
    optionSetsNavigation,
    modifierGroupsNavigation,
    availabilityRulesNavigation,
  ],
  [
    { label: 'Admin', type: 'label' },
    staffNavigation,
    branchesNavigation,
  ],
]
