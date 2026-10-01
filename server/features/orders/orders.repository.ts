import { and, asc, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm'
import type { CancelReason, OrderStatus, OrderType, PaymentMethod, QuotedModifier, ReturnMethod } from '#shared/contracts/orders'
import { organization, user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { insertPieces, readInChunks, requireAtMost } from '#server/utils/batch'
import { counterPayments, exchangeRates, orderEvents, orderLines, orders } from './orders.schema'

/** All SQL of orders (docs/server/architecture.md → Repository). */

export interface NewOrder {
  id: string
  branchId: string
  customerId: string
  businessDate: string
  orderType: OrderType
  tableId: string | null
  tableLabel: string | null
  subtotalMinor: number
  totalMinor: number
  placedAt: Date
  paymentDueAt: Date
}

export interface NewOrderLine {
  position: number
  itemId: string
  variationId: string
  itemName: string
  categoryId: string | null
  categoryName: string | null
  detail: string
  modifiers: QuotedModifier[]
  unitPriceMinor: number
  quantity: number
  totalMinor: number
  note: string | null
}

/**
 * The order, with the next pickup number of its branch and business day computed **in the same
 * statement** (SQLite runs one write at a time, so two orders can't read the same maximum); the
 * unique index on the number is the final guard.
 */
export function insertOrderStatement(db: Db, order: NewOrder): Statement {
  const next = sql<number>`(select coalesce(max(${orders.pickupNumber}), 0) + 1 from ${orders} where ${orders.branchId} = ${order.branchId} and ${orders.businessDate} = ${order.businessDate})`
  return db.insert(orders).values({ ...order, pickupNumber: next, status: 'awaiting_payment' })
}

/** The lines, in pieces small enough for D1's parameter limit (30 lines at most anyway). */
export function insertLinesStatements(db: Db, orderId: string, lines: NewOrderLine[]): Statement[] {
  return insertPieces(orderLines, lines).map(piece => db.insert(orderLines).values(piece.map(line => ({ ...line, orderId }))))
}

/**
 * A guard for the batch: the customer has at most `max` unpaid orders still due, counting the one
 * this batch inserts (put it after the insert). Concurrent placements can't both slip under it.
 */
export function unpaidAtMostStatement(db: Db, customerId: string, now: Date, max: number): Statement {
  return requireAtMost(db, sql`select count(*) from ${orders} where ${orders.customerId} = ${customerId} and ${orders.status} = 'awaiting_payment' and ${orders.paymentDueAt} > ${now.getTime()}`, max)
}

export interface OrderRow {
  id: string
  branchId: string
  branchName: string
  customerId: string
  customerName: string
  pickupNumber: number
  businessDate: string
  status: OrderStatus
  orderType: OrderType
  tableLabel: string | null
  subtotalMinor: number
  totalMinor: number
  placedAt: Date
  paymentDueAt: Date
  paidAt: Date | null
  readyAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  version: number
}

const orderColumns = {
  id: orders.id,
  branchId: orders.branchId,
  branchName: organization.name,
  customerId: orders.customerId,
  customerName: user.name,
  pickupNumber: orders.pickupNumber,
  businessDate: orders.businessDate,
  status: orders.status,
  orderType: orders.orderType,
  tableLabel: orders.tableLabel,
  subtotalMinor: orders.subtotalMinor,
  totalMinor: orders.totalMinor,
  placedAt: orders.placedAt,
  paymentDueAt: orders.paymentDueAt,
  paidAt: orders.paidAt,
  readyAt: orders.readyAt,
  completedAt: orders.completedAt,
  cancelledAt: orders.cancelledAt,
  version: orders.version,
}

const selectOrders = (db: Db) => db.select(orderColumns).from(orders)
  .innerJoin(organization, eq(organization.id, orders.branchId))
  .innerJoin(user, eq(user.id, orders.customerId))

export async function findOrder(db: Db, id: string): Promise<OrderRow | undefined> {
  const [row] = await selectOrders(db).where(eq(orders.id, id))
  return row
}

/**
 * The branch's orders still in play, oldest first: waiting for payment and not past their time
 * (an expired one is the expiry task's, 6.6), preparing, ready.
 */
export async function findActiveOrders(db: Db, branchId: string, now: Date): Promise<OrderRow[]> {
  return selectOrders(db)
    .where(and(
      eq(orders.branchId, branchId),
      or(
        and(eq(orders.status, 'awaiting_payment'), gt(orders.paymentDueAt, now)),
        inArray(orders.status, ['preparing', 'ready']),
      ),
    ))
    .orderBy(asc(orders.placedAt))
}

/** When an order left the queue: completed or cancelled. */
const finishedAt = sql`coalesce(${orders.completedAt}, ${orders.cancelledAt})`

/** A business day's finished orders at a branch hold at most this many (a cafe's day is far fewer). */
export const FINISHED_LIMIT = 500

/**
 * A business day's orders that left the queue (step 10.2), the most recently finished first; the
 * id breaks ties. Uses `orders_branch_date_idx`.
 */
export async function findFinishedOrders(db: Db, branchId: string, businessDate: string): Promise<OrderRow[]> {
  return selectOrders(db)
    .where(and(eq(orders.branchId, branchId), eq(orders.businessDate, businessDate), inArray(orders.status, ['completed', 'cancelled'])))
    .orderBy(desc(finishedAt), desc(orders.id))
    .limit(FINISHED_LIMIT)
}

export async function countFinishedOrders(db: Db, branchId: string, businessDate: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(orders)
    .where(and(eq(orders.branchId, branchId), eq(orders.businessDate, businessDate), inArray(orders.status, ['completed', 'cancelled'])))
  return row?.n ?? 0
}

// --- The customer's orders (6.5, D106) ---

const IN_PROGRESS: OrderStatus[] = ['awaiting_payment', 'preparing', 'ready']
const FINISHED: OrderStatus[] = ['completed', 'cancelled']
/** Newest first; the id breaks ties so pages never overlap. */
const newestFirst = [desc(orders.placedAt), desc(orders.id)]

/** The customer's orders still in play, newest first (a few at most: two can be unpaid). */
export async function findCustomerOrdersInProgress(db: Db, customerId: string, limit: number): Promise<OrderRow[]> {
  return selectOrders(db)
    .where(and(eq(orders.customerId, customerId), inArray(orders.status, IN_PROGRESS)))
    .orderBy(...newestFirst)
    .limit(limit)
}

/** A page of the customer's completed and cancelled orders, newest first, and how many there are. */
export async function findCustomerOrdersPast(db: Db, customerId: string, page: { page: number, pageSize: number }): Promise<{ rows: OrderRow[], total: number }> {
  const where = and(eq(orders.customerId, customerId), inArray(orders.status, FINISHED))
  const [rows, [count]] = await Promise.all([
    selectOrders(db).where(where).orderBy(...newestFirst).limit(page.pageSize).offset((page.page - 1) * page.pageSize),
    db.select({ total: sql<number>`count(*)` }).from(orders).where(where),
  ])
  return { rows, total: count?.total ?? 0 }
}

/** Units per order (the sum of the lines' quantities). */
export async function itemCounts(db: Db, orderIds: string[]): Promise<Map<string, number>> {
  const rows: { orderId: string, count: number }[] = await readInChunks(orderIds, ids => db
    .select({ orderId: orderLines.orderId, count: sql<number>`sum(${orderLines.quantity})` })
    .from(orderLines).where(inArray(orderLines.orderId, ids)).groupBy(orderLines.orderId))
  return new Map(rows.map(row => [row.orderId, Number(row.count)]))
}

/** The event that cancelled the order, if it was: who did it (`null`: the system) and why. */
export async function cancelEventOf(db: Db, orderId: string): Promise<{ actorId: string | null, reason: CancelReason | null } | undefined> {
  const [row] = await db.select({ actorId: orderEvents.actorId, reason: orderEvents.reason }).from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.toStatus, 'cancelled')))
    .orderBy(desc(orderEvents.toVersion)).limit(1)
  return row
}

export async function linesOf(db: Db, orderId: string) {
  return db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.position))
}

/** The lines of many orders (in pieces for D1's parameter limit), by position. */
export async function linesOfOrders(db: Db, orderIds: string[]) {
  const rows = await readInChunks(orderIds, ids => db.select().from(orderLines).where(inArray(orderLines.orderId, ids)))
  return rows.sort((a, b) => a.position - b.position)
}

// --- The counter (6.3, D101) ---

export interface OrderChange {
  orderId: string
  fromStatus: OrderStatus
  toStatus: OrderStatus
  /** The version the command read: the update applies only if it's still current. */
  version: number
  at: Date
}

const stamp: Partial<Record<OrderStatus, 'paidAt' | 'readyAt' | 'completedAt' | 'cancelledAt'>> = {
  preparing: 'paidAt',
  ready: 'readyAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
}

/**
 * Moves the order to its next status **only if** it still has the status and version the command
 * read; follow it with `requireOneChange`, so a change made meanwhile stops the whole batch.
 */
export function transitionStatement(db: Db, change: OrderChange): Statement {
  const at = stamp[change.toStatus]
  return db.update(orders)
    .set({ status: change.toStatus, version: change.version + 1, updatedAt: change.at, ...(at ? { [at]: change.at } : {}) })
    .where(and(eq(orders.id, change.orderId), eq(orders.status, change.fromStatus), eq(orders.version, change.version)))
}

export function eventStatement(db: Db, event: { orderId: string, toVersion: number, actorId: string | null, fromStatus: OrderStatus | null, toStatus: OrderStatus, reason?: CancelReason | null, note?: string | null, at: Date }): Statement {
  return db.insert(orderEvents).values(event)
}

export interface NewPayment {
  orderId: string
  branchId: string
  method: PaymentMethod
  amountMinor: number
  amountKhr: number | null
  khrPerUsd: number | null
  reference: string | null
  collectedBy: string
  collectedAt: Date
}

/** The payment; its unique order index is the final guard against paying twice. */
export function insertPaymentStatement(db: Db, payment: NewPayment): Statement {
  return db.insert(counterPayments).values(payment)
}

/** Records how the money of a cancelled paid order went back. */
export function returnPaymentStatement(db: Db, orderId: string, returned: { returnMethod: ReturnMethod, returnedBy: string, returnedAt: Date }): Statement {
  return db.update(counterPayments).set(returned).where(eq(counterPayments.orderId, orderId))
}

export interface PaymentRow {
  orderId: string
  method: PaymentMethod
  amountMinor: number
  amountKhr: number | null
  khrPerUsd: number | null
  reference: string | null
  collectedAt: Date
  collectedByName: string
  returnMethod: ReturnMethod | null
  returnedAt: Date | null
}

export async function paymentsOf(db: Db, orderIds: string[]): Promise<PaymentRow[]> {
  return readInChunks(orderIds, ids => db.select({
    orderId: counterPayments.orderId,
    method: counterPayments.method,
    amountMinor: counterPayments.amountMinor,
    amountKhr: counterPayments.amountKhr,
    khrPerUsd: counterPayments.khrPerUsd,
    reference: counterPayments.reference,
    collectedAt: counterPayments.collectedAt,
    collectedByName: user.name,
    returnMethod: counterPayments.returnMethod,
    returnedAt: counterPayments.returnedAt,
  }).from(counterPayments).innerJoin(user, eq(user.id, counterPayments.collectedBy)).where(inArray(counterPayments.orderId, ids)))
}

// --- The riel rate (6.3, D101) ---

export interface RateRow {
  perUsd: number
  effectiveFrom: Date
  setByName: string
}

const rateColumns = { perUsd: exchangeRates.perUsd, effectiveFrom: exchangeRates.effectiveFrom, setByName: user.name }

/** The rate in force at `now`: the latest set before it. */
export async function currentRate(db: Db, now: Date): Promise<RateRow | undefined> {
  const [row] = await db.select(rateColumns).from(exchangeRates).innerJoin(user, eq(user.id, exchangeRates.setBy))
    .where(and(eq(exchangeRates.currency, 'KHR'), lte(exchangeRates.effectiveFrom, now)))
    .orderBy(desc(exchangeRates.effectiveFrom)).limit(1)
  return row
}

export async function rateHistory(db: Db, limit: number): Promise<RateRow[]> {
  return db.select(rateColumns).from(exchangeRates).innerJoin(user, eq(user.id, exchangeRates.setBy))
    .where(eq(exchangeRates.currency, 'KHR'))
    .orderBy(desc(exchangeRates.effectiveFrom)).limit(limit)
}

export function insertRateStatement(db: Db, rate: { perUsd: number, effectiveFrom: Date, setBy: string }): Statement {
  return db.insert(exchangeRates).values({ ...rate, currency: 'KHR' })
}

/** Unpaid orders still due, for tests and the expiry task (6.6). */
/** Unpaid orders whose time to pay is over (the expiry task, 6.6), oldest first. */
export async function findExpiredUnpaid(db: Db, now: Date, limit: number): Promise<{ id: string, version: number, branchId: string }[]> {
  return db.select({ id: orders.id, version: orders.version, branchId: orders.branchId }).from(orders)
    .where(and(eq(orders.status, 'awaiting_payment'), lte(orders.paymentDueAt, now)))
    .orderBy(asc(orders.paymentDueAt))
    .limit(limit)
}

export async function unpaidCount(db: Db, customerId: string, now: Date): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.status, 'awaiting_payment'), gt(orders.paymentDueAt, now)))
  return row?.count ?? 0
}
