import type { PublicMenu } from '#shared/contracts/public-menu'
import type { PastLine } from '../utils/cart'
import { reorderLines } from '../utils/cart'
import { menuItems, menuSections } from '../utils/menu'
import { useCart, useShopBranch } from './useShopMenu'

/**
 * Order again (step 6.5b, D114): the lines of an earlier order that are still on its branch's menu
 * go into the order in this browser for that branch, and the menu shows that branch next. The
 * table isn't carried over: the new order is pickup unless this tab scanned the table's QR.
 * Returns how many units were added and the names skipped; throws `ApiError` if the menu can't be
 * read.
 */
export function useOrderAgain() {
  const branchId = ref<string>()
  const cart = useCart(branchId)
  const { choose } = useShopBranch()

  async function orderAgain(order: { branchId: string, lines: PastLine[] }) {
    const menu = await apiFetch<PublicMenu>('/public/menu', { query: { branchId: order.branchId } })
    const result = reorderLines(order.lines, menuItems(menuSections(menu)))
    branchId.value = order.branchId
    for (const line of result.lines) cart.add(line)
    choose(order.branchId)
    return { added: result.lines.reduce((sum, line) => sum + line.quantity, 0), skipped: result.skipped }
  }

  return { orderAgain }
}
