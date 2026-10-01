import type { CancelOrderInput, CounterCommandInput, CounterFinishedOrders, CounterOrder, CounterOrderHistory, CounterQueue, ExchangeRate, ExchangeRates, OrderStatus, PayOrderInput, SetExchangeRateInput } from '#shared/contracts/orders'
import { toRiel } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import type { Actor, BranchActor } from '#server/features/identity'
import { auditStatement, outboxStatement } from '#server/features/platform'
import type { OrderStep } from './commands'
import { runOrderCommand } from './commands'
import { exchangeRateChanged, noExchangeRate, orderChanged, orderNotCancellable, orderNotFound, paymentExpired, returnMethodInvalid } from './orders.errors'
import { ORDER_EVENTS } from './orders.events'
import * as repo from './orders.repository'
import * as reportsRepo from './reports.repository'
import { businessDateAt, firstName } from './reports.rules'

/**
 * The counter (docs/server/data-model.md → Orders & payment, step 6.3, D101): the branch's queue
 * and the commands that move an order along:
 *
 * ```
 * awaiting_payment ──pay──► preparing ──ready──► ready ──complete──► completed
 *        └──────────────cancel───────┘ (a paid one records how the money went back, Q36)
 * ```
 *
 * Recording the payment starts preparation (D45: no accept step). Every command names the order's
 * `version`, and the change applies only if the order still has the status and version the screen
 * read (a guard in the batch), so two cashiers can't both pay, or pay and cancel, the same order:
 * the second gets 409 `ORDER_CHANGED` with the order's state now. Every command also takes an
 * `Idempotency-Key`: a retry after a lost answer returns the first answer and changes nothing.
 * The change, its event, the payment and the audit entry are one atomic batch.
 */

const toCounterOrder = (row: repo.OrderRow, lines: Awaited<ReturnType<typeof repo.linesOfOrders>>, payment: repo.PaymentRow | undefined): CounterOrder => ({
  id: row.id,
  version: row.version,
  pickupNumber: row.pickupNumber,
  businessDate: row.businessDate,
  status: row.status,
  orderType: row.orderType,
  table: row.tableLabel ? { label: row.tableLabel } : null,
  customer: { name: row.customerName },
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
  totalMinor: row.totalMinor,
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
        khrPerUsd: payment.khrPerUsd,
        reference: payment.reference,
        collectedAt: toIso(payment.collectedAt),
        collectedBy: { name: payment.collectedByName },
        returnMethod: payment.returnMethod,
        returnedAt: payment.returnedAt ? toIso(payment.returnedAt) : null,
      }
    : null,
})

async function withDetails(db: Db, rows: repo.OrderRow[]): Promise<CounterOrder[]> {
  if (!rows.length) return []
  const ids = rows.map(row => row.id)
  const [lines, payments] = await Promise.all([repo.linesOfOrders(db, ids), repo.paymentsOf(db, ids)])
  const paymentOf = new Map(payments.map(payment => [payment.orderId, payment]))
  return rows.map(row => toCounterOrder(row, lines.filter(line => line.orderId === row.id), paymentOf.get(row.id)))
}

const toRate = (row: repo.RateRow): ExchangeRate => ({ khrPerUsd: row.perUsd, effectiveFrom: toIso(row.effectiveFrom), setBy: { name: row.setByName } })

/** The branch's business day at `now` (it starts at 4:00 in the branch's time zone, D99). */
async function businessDateOf(db: Db, branchId: string, now: Date): Promise<string> {
  const branch = await reportsRepo.findReportBranch(db, branchId)
  if (!branch) throw orderNotFound()
  return businessDateAt(now, branch.timeZone)
}

/** The branch's orders still in play, the riel rate, the server's clock, and how many finished today. */
export async function listCounterQueue(db: Db, actor: BranchActor, now = new Date()): Promise<CounterQueue> {
  const [rows, rate, today] = await Promise.all([repo.findActiveOrders(db, actor.branchId, now), repo.currentRate(db, now), businessDateOf(db, actor.branchId, now)])
  const [orders, finishedToday] = await Promise.all([withDetails(db, rows), repo.countFinishedOrders(db, actor.branchId, today)])
  return { orders, khrRate: rate ? toRate(rate) : null, serverTime: now.toISOString(), finishedToday }
}

/**
 * Today's orders that left the queue (step 10.2, D117): completed or cancelled, of the business day
 * they were placed in, the most recently finished first. Read only: the counter looks an order up
 * ("I paid, why was it cancelled?"), it doesn't change it. Older days are in the admin's Reports.
 */
export async function listFinishedToday(db: Db, actor: BranchActor, now = new Date()): Promise<CounterFinishedOrders> {
  const businessDate = await businessDateOf(db, actor.branchId, now)
  return { businessDate, orders: await withDetails(db, await repo.findFinishedOrders(db, actor.branchId, businessDate)) }
}

/**
 * One of the branch's orders with every step and who took it (step 10.2): the system (the expiry),
 * the customer (their first name), or a staff member (their name). The staff's own cancel note is
 * shown here, never to the customer (D106).
 */
export async function getCounterOrderHistory(db: Db, actor: BranchActor, orderId: string): Promise<CounterOrderHistory> {
  const row = await repo.findOrder(db, orderId)
  if (!row || row.branchId !== actor.branchId) throw orderNotFound()
  const [[order], events, returnedBy] = await Promise.all([withDetails(db, [row]), reportsRepo.eventsOf(db, orderId), reportsRepo.returnedByName(db, orderId)])
  return {
    order: order!,
    timeline: events.map(event => ({
      at: toIso(event.at),
      toStatus: event.toStatus,
      by: event.actorId === null
        ? { kind: 'system' as const, name: null }
        : event.actorId === row.customerId
          ? { kind: 'customer' as const, name: firstName(row.customerName) }
          : { kind: 'staff' as const, name: event.actorName },
      reason: event.reason,
      note: event.note,
    })),
    returnedBy,
  }
}

/** One of the branch's orders, whatever its status. Another branch's is 404, like an unknown id. */
export async function getCounterOrder(db: Db, actor: BranchActor, orderId: string): Promise<CounterOrder> {
  const row = await repo.findOrder(db, orderId)
  if (!row || row.branchId !== actor.branchId) throw orderNotFound()
  const [order] = await withDetails(db, [row])
  return order!
}

/**
 * Runs one counter command on one of the branch's orders (`runOrderCommand`: guarded by status
 * and version, one batch, idempotent), then reads it back as the counter sees it.
 */
async function runCommand(
  db: Db,
  actor: BranchActor,
  orderId: string,
  key: string,
  command: { operation: string, input: CounterCommandInput, request: object, now: Date },
  plan: (order: repo.OrderRow) => OrderStep | Promise<OrderStep>,
): Promise<CounterOrder> {
  await runOrderCommand(db, {
    actor,
    orderId,
    key,
    operation: command.operation,
    version: command.input.version,
    request: { branchId: actor.branchId, ...command.request },
    now: command.now,
    owns: order => order.branchId === actor.branchId,
    changed: order => orderChanged(order.pickupNumber, order.status),
  }, plan)
  return getCounterOrder(db, actor, orderId)
}

/** Refuses unless the order is in one of `allowed`. */
function requireStatus(order: repo.OrderRow, allowed: OrderStatus[]) {
  if (!allowed.includes(order.status)) throw orderChanged(order.pickupNumber, order.status)
}

/**
 * Records the payment (`payment: ['collect']`), which starts preparation. The amount is the order's
 * total; cash in riel uses the rate in force, which must be the one the screen showed. Refused
 * once the 30 minutes to pay are over.
 */
export async function payOrder(db: Db, actor: BranchActor, orderId: string, input: PayOrderInput, key: string, now = new Date()): Promise<CounterOrder> {
  return runCommand(db, actor, orderId, key, { operation: 'pay', input, request: input, now }, async (order) => {
    requireStatus(order, ['awaiting_payment'])
    if (order.paymentDueAt.getTime() <= now.getTime()) throw paymentExpired()
    const rate = input.method === 'cash_khr' ? await repo.currentRate(db, now) : undefined
    if (input.method === 'cash_khr') {
      if (!rate) throw noExchangeRate()
      if (rate.perUsd !== input.khrPerUsd) throw exchangeRateChanged(rate.perUsd)
    }
    const amountKhr = rate ? toRiel(order.totalMinor, rate.perUsd) : null
    return {
      to: 'preparing',
      statements: [repo.insertPaymentStatement(db, {
        orderId,
        branchId: actor.branchId,
        method: input.method,
        amountMinor: order.totalMinor,
        amountKhr,
        khrPerUsd: rate?.perUsd ?? null,
        reference: input.method === 'khqr' ? input.reference : null,
        collectedBy: actor.userId,
        collectedAt: now,
      }), outboxStatement(db, ORDER_EVENTS.paid, { orderId })],
      metadata: { method: input.method, amountMinor: order.totalMinor, amountKhr },
    }
  })
}

/** Preparing → ready (`order: ['ready']`). */
export async function markOrderReady(db: Db, actor: BranchActor, orderId: string, input: CounterCommandInput, key: string, now = new Date()): Promise<CounterOrder> {
  return runCommand(db, actor, orderId, key, { operation: 'ready', input, request: input, now }, (order) => {
    requireStatus(order, ['preparing'])
    return { to: 'ready' }
  })
}

/** Ready → completed, handed to the customer (`order: ['complete']`). Points are earned here in 7.1. */
export async function completeOrder(db: Db, actor: BranchActor, orderId: string, input: CounterCommandInput, key: string, now = new Date()): Promise<CounterOrder> {
  return runCommand(db, actor, orderId, key, { operation: 'complete', input, request: input, now }, (order) => {
    requireStatus(order, ['ready'])
    return { to: 'completed' }
  })
}

/**
 * Cancels an order that isn't ready yet (`order: ['cancel']`), with a reason. A paid one (being
 * prepared) records how the money went back (owner, 2026-09-29, Q36); a ready or completed one
 * needs an admin refund.
 */
export async function cancelOrderAtCounter(db: Db, actor: BranchActor, orderId: string, input: CancelOrderInput, key: string, now = new Date()): Promise<CounterOrder> {
  return runCommand(db, actor, orderId, key, { operation: 'cancel', input, request: input, now }, (order) => {
    if (order.status === 'ready' || order.status === 'completed') throw orderNotCancellable()
    requireStatus(order, ['awaiting_payment', 'preparing'])
    const paid = order.status === 'preparing'
    if (paid !== Boolean(input.returnMethod)) throw returnMethodInvalid(paid)
    return {
      to: 'cancelled',
      reason: { reason: input.reason, note: input.note },
      statements: paid ? [repo.returnPaymentStatement(db, orderId, { returnMethod: input.returnMethod!, returnedBy: actor.userId, returnedAt: now })] : [],
      metadata: { reason: input.reason, returnMethod: input.returnMethod },
    }
  })
}

// --- The riel rate (admin, `settings: ['manage']`) ---

const HISTORY = 20

export async function getExchangeRates(db: Db, now = new Date()): Promise<ExchangeRates> {
  const [current, history] = await Promise.all([repo.currentRate(db, now), repo.rateHistory(db, HISTORY)])
  return { current: current ? toRate(current) : null, history: history.map(toRate) }
}

/** A new rate from now on; the history keeps every earlier one. Setting the current rate again changes nothing. */
export async function setExchangeRate(db: Db, actor: Actor, input: SetExchangeRateInput, now = new Date()): Promise<ExchangeRates> {
  const current = await repo.currentRate(db, now)
  if (current?.perUsd !== input.khrPerUsd) {
    await db.batch([
      repo.insertRateStatement(db, { perUsd: input.khrPerUsd, effectiveFrom: now, setBy: actor.userId }),
      auditStatement(db, actor, { action: 'orders.exchange_rate.set', targetType: 'exchange_rate', metadata: { from: current?.perUsd ?? null, to: input.khrPerUsd } }),
    ])
  }
  return getExchangeRates(db, now)
}
