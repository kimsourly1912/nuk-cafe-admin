import { branchesSetup } from '~/features/branches'
import { cafeSetup } from '~/features/cafe'
import { khqrSetup, rielRateSetup } from '~/features/exchange-rates'
import { telegramSetup } from '~/features/notifications'
import { menuItemsSetup, menuPhotosSetup } from '~/features/products'
import { staffSetup } from '~/features/staff'
import type { AdminSetupStep } from '~/types/admin-setup'

/**
 * The home page's "Set up your cafe" steps (D155), in the order a new cafe does them. Each feature
 * exports its own step from its index.ts; this file only decides which and in what order.
 */
export function adminSetupSteps(): AdminSetupStep[] {
  return [branchesSetup, menuItemsSetup, rielRateSetup, khqrSetup, menuPhotosSetup, telegramSetup, staffSetup, cafeSetup]
}
