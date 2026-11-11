import type { CartLine } from '../utils/cart'
import { useBranchChoice, useCart } from './useShopMenu'

/** The menu's query that says it was opened from Explore's café, and which branch's (D275). */
export const FROM_EXPLORE_QUERY = 'explore'

/**
 * Opening a branch's menu from somewhere else in the cafe's site (Explore's counter and View menu,
 * D275 step E4): the branch is chosen as the customer would choose it, and the menu offers
 * **Back to café**. A table this tab scanned still wins (one tab, one table, D141): the menu then
 * shows the table's branch, with Switch to pickup as usual.
 */
export function useMenuHandoff() {
  const tenantPath = useTenantPath()
  const { chosen, choose } = useBranchChoice()
  return {
    /** The branch the customer last chose on the menu, if any (read from this browser after mounting). */
    chosenBranchId: chosen,
    openMenu: (branchId: string) => {
      choose(branchId)
      return navigateTo({ path: tenantPath('/'), query: { [FROM_EXPLORE_QUERY]: branchId } })
    },
  }
}

/** How many items one branch's order holds (Explore's HUD). Read only: the menu owns the order. */
export function useBranchOrderCount(branchId: MaybeRefOrGetter<string | undefined>) {
  const { lines } = useCart(computed(() => toValue(branchId)))
  return computed(() => lines.value.reduce((total: number, line: CartLine) => total + line.quantity, 0))
}
