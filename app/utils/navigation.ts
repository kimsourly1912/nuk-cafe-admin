import type { NavigationMenuItem } from '@nuxt/ui'
import { availabilityRulesNavigation } from '~/features/availability-rules'
import { branchesNavigation } from '~/features/branches'
import { categoriesNavigation } from '~/features/categories'
import { exchangeRatesNavigation } from '~/features/exchange-rates'
import { modifierGroupsNavigation } from '~/features/modifier-groups'
import { optionSetsNavigation } from '~/features/option-sets'
import { productsNavigation } from '~/features/products'
import { reportsNavigation } from '~/features/reports'
import { sampleDataNavigation } from '~/features/sample-data'
import { staffNavigation } from '~/features/staff'

/**
 * Sidebar, grouped by area. Each feature exports its own entry from its index.ts;
 * this file only decides grouping and order. `sampleData`: the environment turns the Sample data
 * page on (local and staging, D94).
 */
export function navigationItems(options: { sampleData: boolean }): NavigationMenuItem[][] {
  return [
    [
      { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/admin' },
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
      { label: 'Reports', type: 'label' },
      ...reportsNavigation,
    ],
    [
      { label: 'Admin', type: 'label' },
      staffNavigation,
      branchesNavigation,
      exchangeRatesNavigation,
      ...(options.sampleData ? [sampleDataNavigation] : []),
    ],
  ]
}
