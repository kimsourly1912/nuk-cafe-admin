import type { CancelledBy, CancelMyOrderInput, CancelReason, OrderCancellation, CustomerOrders, CustomerOrdersQuery, Order, OrderSummary, PlaceOrderInput } from '#shared/contracts/orders'
import type { PublicMenuCategory } from '#shared/contracts/public-menu'
import { totalPages } from '#shared/contracts/common'
import { MAX_UNPAID_ORDERS, PAYMENT_WINDOW_MINUTES } from '#shared/contracts/orders'
import { ORDER_EVENTS } from './orders.events'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import { resolveTableToken } from '#server/features/branches'
import type { Actor } from '#server/features/identity'
import { getPublicMenu } from '#server/features/menu'
import { outboxStatement, withIdempotency } from '#server/features/platform'
import { runOrderCommand } from './commands'
import { cannotCancelNow, orderingClosed, orderNotFound, orderNotOrderable, pricesChanged, tableUnavailable, tooManyUnpaidOrders } from './orders.errors'
import * as repo from './orders.repository'
import { quoteOrder } from './quote.rules'
import { businessDateAt } from './reports.rules'

/**
 * Placing and reading orders (docs/server/data-model.md → Orders, step 6.2, D99). The lines are
 * priced again from the menu as it is now (the quote's rules, D98); the page's total must match,
 * so nothing is charged unseen. Placing is idempotent per `Idempotency-Key`: a retry, however many,
 * gives the same order. Payment happens at the counter (6.3, 6.4); unpaid orders expire (6.6).
 */

const MINUTE = 60_000

/** The branch's business day at an instant: the local date, the day starting at 4:00 (Q39). */
export { businessDateAt }

/** The table a QR token names, if it's an active table of this branch. */
async function tableFor(db: Db, tenantId: string, branchId: string, token: string | null) {
  if (!token) return null
  try {
    const found = await resolveTableToken(db, tenantId, token)
    if (found.branch.id === branchId) return found.table
  }
  catch {
    // Unknown or archived: refused below, never switched to pickup silently (Q42).
  }
  throw tableUnavailable()
}

/** Each item's category on the menu (its sub-category when it has one), kept on the line as sold (D110). */
function categoriesOfItems(categories: PublicMenuCategory[]): Map<string, { id: string, name: string }> {
  const byItem = new Map<string, { id: string, name: string }>()
  for (const category of categories) {
    for (const item of category.items) byItem.set(item.id, { id: category.id, name: category.name })
    for (const [id, found] of categoriesOfItems(category.categories)) byItem.set(id, found)
  }
  return byItem
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
      const menu = await getPublicMenu(db, actor.tenantId, { branchId: input.branchId }, now)
      const quote = quoteOrder(menu, input.lines)
      if (quote.problems[0]) throw orderingClosed(quote.problems[0].message)
      if (!quote.orderable) throw orderNotOrderable()
      if (quote.totalMinor !== input.expectedTotalMinor) throw pricesChanged()
      const table = await tableFor(db, actor.tenantId, menu.branch.id, input.tableToken)

      const orderId = newId()
      const order: repo.NewOrder = {
        id: orderId,
        tenantId: actor.tenantId,
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
      const categories = categoriesOfItems(menu.categories)
      const lines = quote.lines.map((line, position): repo.NewOrderLine => ({
        position,
        itemId: line.itemId,
        variationId: line.variationId,
        itemName: line.name!,
        categoryId: categories.get(line.itemId)?.id ?? null,
        categoryName: categories.get(line.itemId)?.name ?? null,
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
          ...repo.insertLinesStatements(db, actor.tenantId, orderId, lines),
          repo.eventStatement(db, { tenantId: actor.tenantId, orderId, toVersion: 1, actorId: actor.userId, fromStatus: null, toStatus: 'awaiting_payment', at: now }),
          repo.unpaidAtMostStatement(db, actor.tenantId, actor.userId, now, MAX_UNPAID_ORDERS),
          // A neutral event for whoever listens (the Telegram alerts, D113): orders don't know them.
          outboxStatement(db, ORDER_EVENTS.placed, { orderId }),
        ],
        response: { orderId },
      }
    },
    { onStale: tooManyUnpaidOrders, now },
  )
  return { orderId: response.orderId, replayed }
}

/**
 * Who cancelled, as the customer is told: the system (no actor), themselves, or the cafe (any
 * staff), with the cafe's reason. A staff member cancelling their own order counts as the customer.
 */
function cancellation(event: { actorId: string | null, reason: CancelReason | null }, customerId: string): OrderCancellation {
  const by: CancelledBy = event.actorId === null ? 'system' : event.actorId === customerId ? 'customer' : 'cafe'
  return { by, reason: by === 'cafe' ? event.reason : null }
}

/**
 * An order as its customer sees it, with what tracking needs (step 6.5, D106): the times of each
 * step, the payment, and who cancelled it and why. Someone else's is 404, like an unknown id.
 */
export async function getOrder(db: Db, actor: Actor, id: string): Promise<Order> {
  const row = await repo.findOrder(db, actor.tenantId, id)
  if (!row || row.customerId !== actor.userId) throw orderNotFound()
  const [lines, [payment], cancel] = await Promise.all([
    repo.linesOf(db, id),
    repo.paymentsOf(db, [id]),
    row.status === 'cancelled' ? repo.cancelEventOf(db, id) : undefined,
  ])
  return {
    id: row.id,
    version: row.version,
    branch: { id: row.branchId, name: row.branchName },
    pickupNumber: row.pickupNumber,
    businessDate: row.businessDate,
    status: row.status,
    orderType: row.orderType,
    table: row.tableLabel ? { label: row.tableLabel } : null,
    lines: lines.map(line => ({
      itemId: line.itemId,
      variationId: line.variationId,
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
    paidAt: row.paidAt ? toIso(row.paidAt) : null,
    readyAt: row.readyAt ? toIso(row.readyAt) : null,
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    cancelledAt: row.cancelledAt ? toIso(row.cancelledAt) : null,
    payment: payment
      ? {
          method: payment.method,
          amountMinor: payment.amountMinor,
          amountKhr: payment.amountKhr,
          collectedAt: toIso(payment.collectedAt),
          returnMethod: payment.returnMethod,
          returnedAt: payment.returnedAt ? toIso(payment.returnedAt) : null,
        }
      : null,
    cancellation: cancel ? cancellation(cancel, row.customerId) : null,
  }
}

/** Orders still in play shown at once: more than a customer can have in practice (two unpaid). */
const IN_PROGRESS_LIMIT = 50

/**
 * The signed-in customer's orders (step 6.5, D106): everything still in play, and a page of the
 * finished ones, both newest first.
 */
export async function listMyOrders(db: Db, actor: Actor, query: CustomerOrdersQuery): Promise<CustomerOrders> {
  const [inProgress, past] = await Promise.all([
    repo.findCustomerOrdersInProgress(db, actor.tenantId, actor.userId, IN_PROGRESS_LIMIT),
    repo.findCustomerOrdersPast(db, actor.tenantId, actor.userId, query),
  ])
  const counts = await repo.itemCounts(db, [...inProgress, ...past.rows].map(row => row.id))
  const summary = (row: repo.OrderRow): OrderSummary => ({
    id: row.id,
    branch: { id: row.branchId, name: row.branchName },
    pickupNumber: row.pickupNumber,
    businessDate: row.businessDate,
    status: row.status,
    orderType: row.orderType,
    table: row.tableLabel ? { label: row.tableLabel } : null,
    itemCount: counts.get(row.id) ?? 0,
    totalMinor: row.totalMinor,
    placedAt: toIso(row.placedAt),
    paymentDueAt: toIso(row.paymentDueAt),
  })
  return {
    inProgress: inProgress.map(summary),
    past: { items: past.rows.map(summary), page: query.page, pageSize: query.pageSize, total: past.total, totalPages: totalPages(past.total, query.pageSize) },
  }
}

/**
 * The customer cancels their own order while it's unpaid (D45, step 6.5, D106): guarded by status
 * and version like the counter's commands, so a payment recorded at the same moment wins (the
 * customer is told to ask at the counter), and idempotent per `Idempotency-Key`. The event
 * records the customer as the actor and "changed their mind" as the reason.
 */
export async function cancelMyOrder(db: Db, actor: Actor, orderId: string, input: CancelMyOrderInput, key: string, now = new Date()): Promise<Order> {
  await runOrderCommand(db, {
    actor,
    orderId,
    key,
    operation: 'customer_cancel',
    version: input.version,
    request: { ...input },
    now,
    owns: order => order.customerId === actor.userId,
    changed: order => cannotCancelNow(order.pickupNumber, order.status),
  }, (order) => {
    if (order.status !== 'awaiting_payment') throw cannotCancelNow(order.pickupNumber, order.status)
    return { to: 'cancelled', reason: { reason: 'customer_changed_mind', note: null }, metadata: { by: 'customer' } }
  })
  return getOrder(db, actor, orderId)
}
