import type { PlaceOrderInput } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { getPublicMenu } from '#server/features/menu'
import { resolveTableToken } from '#server/features/branches'
import { orderingClosed, orderNotOrderable, pricesChanged, tableUnavailable } from './orders.errors'
import { quoteOrder } from './quote.rules'

/** Reuse the same business checks initially and after an in-batch guard refuses checkout. */
export async function validateCheckout(db: Db, tenantId: string, input: PlaceOrderInput, now: Date) {
  const menu = await getPublicMenu(db, tenantId, { branchId: input.branchId }, now, input.lines.map(line => line.itemId))
  const quote = quoteOrder(menu, input.lines)
  if (quote.problems[0]) throw orderingClosed(quote.problems[0].message)
  if (!quote.orderable) throw orderNotOrderable()
  if (quote.totalMinor !== input.expectedTotalMinor) throw pricesChanged()
  let table = null
  if (input.tableToken) {
    try {
      const found = await resolveTableToken(db, tenantId, input.tableToken)
      if (found.branch.id === menu.branch.id) table = found.table
    }
    catch {
      // Unknown, rotated or archived: never change dine-in to pickup (Q42).
    }
    if (!table) throw tableUnavailable()
  }
  return { menu, quote, table }
}

export class CheckoutChanged extends Error {}
