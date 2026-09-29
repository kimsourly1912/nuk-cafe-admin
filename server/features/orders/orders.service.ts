import type { Order, PlaceOrderInput } from '#shared/contracts/orders'
import { BUSINESS_DAY_START_MINUTE, MAX_UNPAID_ORDERS, PAYMENT_WINDOW_MINUTES } from '#shared/contracts/orders'
import type { Db } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { toIso } from '../../utils/time'
import { localDate } from '../../utils/weekly-windows'
import { resolveTableToken } from '../branches'
import type { Actor } from '../identity'
import { getPublicMenu } from '../menu'
import { withIdempotency } from '../platform'
import { orderingClosed, orderNotFound, orderNotOrderable, pricesChanged, tableUnavailable, tooManyUnpaidOrders } from './orders.errors'
import * as repo from './orders.repository'
import { quoteOrder } from './quote.rules'

/**
 * Placing and reading orders (docs/server/data-model.md → Orders, step 6.2, D99). The lines are
 * priced again from the menu as it is now (the quote's rules, D98); the page's total must match,
 * so nothing is charged unseen. Placing is idempotent per `Idempotency-Key`: a retry, however many,
 * gives the same order. Payment happens at the counter (6.3, 6.4); unpaid orders expire (6.6).
 */

const MINUTE = 60_000

/** The branch's business day at `now`: the local date, the day starting at 4:00 (Q39). */
export function businessDateAt(now: Date, timezone: string): string {
  return localDate(new Date(now.getTime() - BUSINESS_DAY_START_MINUTE * MINUTE), timezone)
}

/** The table a QR token names, if it's an active table of this branch. */
async function tableFor(db: Db, branchId: string, token: string | null) {
  if (!token) return null
  try {
    const found = await resolveTableToken(db, token)
    if (found.branch.id === branchId) return found.table
  }
  catch {
    // Unknown or archived: refused below, never switched to pickup silently (Q42).
  }
  throw tableUnavailable()
}

/**
 * Places the order for a signed-in, verified customer (`requireCustomer`). Refuses, in this order:
 * a closed branch or last orders passed; a line that can't be ordered; a total other than the one
 * shown; a table that doesn't work; a third unpaid order (a guard in the batch, so two orders
 * placed at once can't both pass). Returns the new order's id: its pickup number is computed in
 * the insert, so the order is read back (`getOrder`).
 */
export async function placeOrder(db: Db, actor: Actor, input: PlaceOrderInput, idempotencyKey: string, now = new Date()): Promise<{ orderId: string, replayed: boolean }> {
  const { response, replayed } = await withIdempotency(
    db,
    { actorId: actor.userId, operation: 'orders.place', key: idempotencyKey },
    input,
    async () => {
      const menu = await getPublicMenu(db, { branchId: input.branchId }, now)
      const quote = quoteOrder(menu, input.lines)
      if (quote.problems[0]) throw orderingClosed(quote.problems[0].message)
      if (!quote.orderable) throw orderNotOrderable()
      if (quote.totalMinor !== input.expectedTotalMinor) throw pricesChanged()
      const table = await tableFor(db, menu.branch.id, input.tableToken)

      const orderId = newId()
      const order: repo.NewOrder = {
        id: orderId,
        branchId: menu.branch.id,
        customerId: actor.userId,
        businessDate: businessDateAt(now, menu.branch.timezone),
        orderType: table ? 'dine_in' : 'pickup',
        tableId: table?.id ?? null,
        tableLabel: table?.label ?? null,
        subtotalMinor: quote.subtotalMinor,
        totalMinor: quote.totalMinor,
        placedAt: now,
        paymentDueAt: new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * MINUTE),
      }
      const lines = quote.lines.map((line, position): repo.NewOrderLine => ({
        position,
        itemId: line.itemId,
        variationId: line.variationId,
        itemName: line.name!,
        detail: line.detail,
        modifiers: line.modifiers,
        unitPriceMinor: line.unitPriceMinor!,
        quantity: line.quantity,
        totalMinor: line.totalMinor!,
        note: line.note,
      }))
      return {
        statements: [
          repo.insertOrderStatement(db, order),
          ...repo.insertLinesStatements(db, orderId, lines),
          repo.eventStatement(db, { orderId, toVersion: 1, actorId: actor.userId, fromStatus: null, toStatus: 'awaiting_payment', at: now }),
          repo.unpaidAtMostStatement(db, actor.userId, now, MAX_UNPAID_ORDERS),
        ],
        response: { orderId },
      }
    },
    { onStale: tooManyUnpaidOrders, now },
  )
  return { orderId: response.orderId, replayed }
}

/** An order as its customer sees it. Someone else's is 404, like an unknown id. */
export async function getOrder(db: Db, actor: Actor, id: string): Promise<Order> {
  const row = await repo.findOrder(db, id)
  if (!row || row.customerId !== actor.userId) throw orderNotFound()
  const lines = await repo.linesOf(db, id)
  return {
    id: row.id,
    branch: { id: row.branchId, name: row.branchName },
    pickupNumber: row.pickupNumber,
    businessDate: row.businessDate,
    status: row.status,
    orderType: row.orderType,
    table: row.tableLabel ? { label: row.tableLabel } : null,
    lines: lines.map(line => ({
      itemId: line.itemId,
      itemName: line.itemName,
      detail: line.detail,
      modifiers: line.modifiers,
      unitPriceMinor: line.unitPriceMinor,
      quantity: line.quantity,
      totalMinor: line.totalMinor,
      note: line.note,
    })),
    subtotalMinor: row.subtotalMinor,
    totalMinor: row.totalMinor,
    currency: 'USD',
    placedAt: toIso(row.placedAt),
    paymentDueAt: toIso(row.paymentDueAt),
    cancelledAt: row.cancelledAt ? toIso(row.cancelledAt) : null,
  }
}
