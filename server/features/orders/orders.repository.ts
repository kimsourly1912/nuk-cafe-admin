import { and, asc, count, desc, eq, exists, gt, gte, inArray, lte, ne, or, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { OrderSource } from '#shared/contracts/marketing'
import type { CancelReason, OrderStatus, OrderType, PaymentMethod, QuotedModifier, ReturnMethod } from '#shared/contracts/orders'
import { branches, user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { insertAll, readInChunks, requireAtMost } from '#server/utils/batch'
import type { PageQuery } from '#server/utils/query'
import { byId, firstRow, inTenant, readPage } from '#server/utils/query'
import { bakongTokens, counterPayments, exchangeRates, khqrSettings, orderEvents, orderLines, orders } from './orders.schema'

/**
 * Whether an order line of the cafe sold this menu item, correlated to the outer query's item
 * columns. Lines name items without a foreign key (they keep what was sold), so a permanent delete
 * must ask (D200). Uses `order_lines_item_idx`.
 */
export function itemOnAnOrder(db: Db, item: { tenantId: AnyColumn, id: AnyColumn }): SQL {
  return exists(db.select({ one: sql`1` }).from(orderLines).where(and(eq(orderLines.tenantId, item.tenantId), eq(orderLines.itemId, item.id))))
}

/**
 * Whether an order line of the cafe was sold under this menu category, correlated to the outer
 * query's category columns (D200). Lines keep the category as sold, without a foreign key. Uses
 * `order_lines_category_idx`.
 */
export function categoryOnAnOrder(db: Db, category: { tenantId: AnyColumn, id: AnyColumn }): SQL {
  return exists(db.select({ one: sql`1` }).from(orderLines).where(and(eq(orderLines.tenantId, category.tenantId), eq(orderLines.categoryId, category.id))))
}

/**
 * Whether an order of the cafe was placed at this dining table, correlated to the outer query's
 * table columns (D200). Orders keep the table's id and label, without a foreign key. Uses
 * `orders_table_idx`.
 */
export function tableOnAnOrder(db: Db, table: { tenantId: AnyColumn, id: AnyColumn }): SQL {
  return exists(db.select({ one: sql`1` }).from(orders).where(and(eq(orders.tenantId, table.tenantId), eq(orders.tableId, table.id))))
}

export interface NewOrder {
  id: string
  tenantId: string
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
  source: OrderSource | null
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
  regularUnitPriceMinor: number | null
  promotionId: string | null
  promotionName: string | null
  promotionLabel: string | null
}

/** An order line as stored. */
export type OrderLineRow = typeof orderLines.$inferSelect

/**
 * The order, with the next pickup number of its branch and business day computed **in the same
 * statement** (SQLite runs one write at a time, so two orders can't read the same maximum); the
 * unique index on the number is the final guard.
 */
export function insertOrderStatement(db: Db, order: NewOrder): Statement {
  const next = sql<number>`(select coalesce(max(${orders.pickupNumber}), 0) + 1 from ${orders} where ${inTenant(orders, order.tenantId, eq(orders.branchId, order.branchId), eq(orders.businessDate, order.businessDate))})`
  return db.insert(orders).values({ ...order, pickupNumber: next, status: 'awaiting_payment' })
}

/** The lines, in pieces small enough for D1's parameter limit (30 lines at most anyway). */
export function insertLinesStatements(db: Db, tenantId: string, orderId: string, lines: NewOrderLine[]): Statement[] {
  return insertAll(db, orderLines, lines.map(line => ({ ...line, tenantId, orderId })))
}

/**
 * A guard for the batch: the customer has at most `max` unpaid orders still due, counting the one
 * this batch inserts (put it after the insert). Concurrent placements can't both slip under it.
 * Uses `orders_tenant_customer_status_due_idx`, including the strict payment deadline range.
 */
export function requireUnpaidAtMost(db: Db, tenantId: string, customerId: string, now: Date, max: number): Statement {
  return requireAtMost(db, db.$count(orders, inTenant(orders, tenantId, eq(orders.customerId, customerId), eq(orders.status, 'awaiting_payment'), gt(orders.paymentDueAt, now))), max)
}

export interface OrderRow {
  id: string
  tenantId: string
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
  tenantId: orders.tenantId,
  branchId: orders.branchId,
  // D1 batch results are objects: repeated SQL names would collapse fields before Drizzle maps them.
  branchName: sql<string>`${branches.name}`.as('branch_name'),
  customerId: orders.customerId,
  customerName: sql<string>`${user.name}`.as('customer_name'),
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

/** Orders with their branch's and customer's names: the branch by the composite key, inside the cafe. */
const selectOrders = (db: Db) => db.select(orderColumns).from(orders)
  .innerJoin(branches, and(eq(branches.tenantId, orders.tenantId), eq(branches.id, orders.branchId)))
  .innerJoin(user, eq(user.id, orders.customerId))

/** The tenant's order; another tenant's is `undefined`, like an unknown id. */
export function findOrder(db: Db, tenantId: string, id: string): Promise<OrderRow | undefined> {
  return firstRow(selectOrders(db).where(byId(orders, tenantId, id)))
}

/**
 * The branch's orders still in play, oldest first: waiting for payment and not past their time
 * (an expired one is the expiry task's, 6.6), preparing, ready.
 */
const activeOrdersWhere = (tenantId: string, branchId: string, now: Date) => inTenant(
  orders,
  tenantId,
  eq(orders.branchId, branchId),
  // Fixed literals let SQLite prove this predicate matches the partial queue index.
  sql`${orders.status} in ('awaiting_payment', 'preparing', 'ready')`,
  or(ne(orders.status, 'awaiting_payment'), gt(orders.paymentDueAt, now)),
)

export interface CounterQueueRows {
  rows: OrderRow[]
  lines: OrderLineRow[]
  payments: PaymentRow[]
  finishedToday: number
}

/** One fresh snapshot of the queue and its details/count, without building an unbounded ID list. Uses `orders_active_queue_idx` for all three active reads. */
export async function counterQueueRows(db: Db, tenantId: string, branchId: string, businessDate: string, now: Date): Promise<CounterQueueRows> {
  const activeIds = db.select({ id: orders.id }).from(orders).where(activeOrdersWhere(tenantId, branchId, now))
  const [rows, lines, payments, [counted]] = await db.batch([
    selectOrders(db).where(activeOrdersWhere(tenantId, branchId, now)).orderBy(asc(orders.placedAt), asc(orders.id)),
    db.select().from(orderLines).where(inTenant(orderLines, tenantId, inArray(orderLines.orderId, activeIds)))
      .orderBy(asc(orderLines.orderId), asc(orderLines.position)),
    selectPayments(db).where(inTenant(counterPayments, tenantId, inArray(counterPayments.orderId, activeIds))),
    db.select({ n: count() }).from(orders)
      .where(inTenant(orders, tenantId, eq(orders.branchId, branchId), eq(orders.businessDate, businessDate), inArray(orders.status, ['completed', 'cancelled']))),
  ])
  return { rows, lines, payments, finishedToday: counted?.n ?? 0 }
}

/** When an order left the queue: completed or cancelled. */
const finishedAt = sql`coalesce(${orders.completedAt}, ${orders.cancelledAt})`

/** A business day's finished orders at a branch hold at most this many (a cafe's day is far fewer). */
export const FINISHED_LIMIT = 500

/**
 * A business day's orders that left the queue (step 10.2), the most recently finished first; the
 * id breaks ties. Uses `orders_branch_date_idx`.
 */
export function findFinishedOrders(db: Db, tenantId: string, branchId: string, businessDate: string): Promise<OrderRow[]> {
  return selectOrders(db)
    .where(inTenant(orders, tenantId, eq(orders.branchId, branchId), eq(orders.businessDate, businessDate), inArray(orders.status, ['completed', 'cancelled'])))
    .orderBy(desc(finishedAt), desc(orders.id))
    .limit(FINISHED_LIMIT)
}

// --- The customer's orders (6.5, D106) ---

const IN_PROGRESS: OrderStatus[] = ['awaiting_payment', 'preparing', 'ready']
const FINISHED: OrderStatus[] = ['completed', 'cancelled']
/** Newest first; the id breaks ties so pages never overlap. */
const newestFirst = [desc(orders.placedAt), desc(orders.id)]

/**
 * The customer's orders still in play, newest first (a few at most: two can be unpaid).
 * Uses `orders_tenant_customer_status_due_idx`; sorts only this cafe/customer's active rows.
 */
export function findCustomerOrdersInProgress(db: Db, tenantId: string, customerId: string, limit: number): Promise<OrderRow[]> {
  return selectOrders(db)
    .where(inTenant(orders, tenantId, eq(orders.customerId, customerId), inArray(orders.status, IN_PROGRESS)))
    .orderBy(...newestFirst)
    .limit(limit)
}

/** A page of the customer's completed and cancelled orders, newest first, and how many there are. */
export function findCustomerOrdersPast(db: Db, tenantId: string, customerId: string, page: PageQuery): Promise<{ rows: OrderRow[], total: number }> {
  const where = inTenant(orders, tenantId, eq(orders.customerId, customerId), inArray(orders.status, FINISHED))
  return readPage(db, selectOrders(db).where(where).orderBy(...newestFirst).$dynamic(), db.select({ total: count() }).from(orders).where(where), page)
}

/** Units per order (the sum of the lines' quantities). */
export async function itemCounts(db: Db, tenantId: string, orderIds: string[]): Promise<Map<string, number>> {
  const rows = await readInChunks(orderIds, ids => db
    .select({ orderId: orderLines.orderId, count: sql<number>`sum(${orderLines.quantity})`.mapWith(Number) })
    .from(orderLines)
    .where(inTenant(orderLines, tenantId, inArray(orderLines.orderId, ids)))
    .groupBy(orderLines.orderId))
  return new Map(rows.map(row => [row.orderId, row.count]))
}

/** The event that cancelled the order, if it was: who did it (`null`: the system) and why. */
export function cancelEventOf(db: Db, tenantId: string, orderId: string): Promise<{ actorId: string | null, reason: CancelReason | null } | undefined> {
  return firstRow(db.select({ actorId: orderEvents.actorId, reason: orderEvents.reason }).from(orderEvents)
    .where(inTenant(orderEvents, tenantId, eq(orderEvents.orderId, orderId), eq(orderEvents.toStatus, 'cancelled')))
    .orderBy(desc(orderEvents.toVersion)))
}

/** The order's lines, by position. */
export function linesOf(db: Db, tenantId: string, orderId: string): Promise<OrderLineRow[]> {
  return db.select().from(orderLines).where(inTenant(orderLines, tenantId, eq(orderLines.orderId, orderId))).orderBy(asc(orderLines.position))
}

/** The lines of many orders (in pieces for D1's parameter limit), by position. */
export async function linesOfOrders(db: Db, tenantId: string, orderIds: string[]): Promise<OrderLineRow[]> {
  const rows = await readInChunks(orderIds, ids => db.select().from(orderLines).where(inTenant(orderLines, tenantId, inArray(orderLines.orderId, ids))))
  return rows.sort((a, b) => a.position - b.position)
}

// --- The counter (6.3, D101) ---

export interface OrderChange {
  tenantId: string
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
    .where(inTenant(orders, change.tenantId, eq(orders.id, change.orderId), eq(orders.status, change.fromStatus), eq(orders.version, change.version)))
}

export function eventStatement(db: Db, event: { tenantId: string, orderId: string, toVersion: number, actorId: string | null, fromStatus: OrderStatus | null, toStatus: OrderStatus, reason?: CancelReason | null, note?: string | null, at: Date }): Statement {
  return db.insert(orderEvents).values(event)
}

export interface NewPayment {
  tenantId: string
  orderId: string
  branchId: string
  method: PaymentMethod
  amountMinor: number
  amountKhr: number | null
  khrPerUsd: number | null
  reference: string | null
  khqrChargeId?: string | null
  collectedBy: string
  collectedAt: Date
}

/** The payment; its unique order index is the final guard against paying twice. */
export function insertPaymentStatement(db: Db, payment: NewPayment): Statement {
  return db.insert(counterPayments).values(payment)
}

/** Records how the money of a cancelled paid order went back. */
export function returnPaymentStatement(db: Db, tenantId: string, orderId: string, returned: { returnMethod: ReturnMethod, returnedBy: string, returnedAt: Date }): Statement {
  return db.update(counterPayments).set(returned).where(inTenant(counterPayments, tenantId, eq(counterPayments.orderId, orderId)))
}

export interface PaymentRow {
  orderId: string
  method: PaymentMethod
  amountMinor: number
  amountKhr: number | null
  khrPerUsd: number | null
  reference: string | null
  khqrChargeId: string | null
  collectedAt: Date
  collectedByName: string
  returnMethod: ReturnMethod | null
  returnedAt: Date | null
}

function selectPayments(db: Db) {
  return db.select({
    orderId: counterPayments.orderId,
    method: counterPayments.method,
    amountMinor: counterPayments.amountMinor,
    amountKhr: counterPayments.amountKhr,
    khrPerUsd: counterPayments.khrPerUsd,
    reference: counterPayments.reference,
    khqrChargeId: counterPayments.khqrChargeId,
    collectedAt: counterPayments.collectedAt,
    collectedByName: user.name,
    returnMethod: counterPayments.returnMethod,
    returnedAt: counterPayments.returnedAt,
  }).from(counterPayments).innerJoin(user, eq(user.id, counterPayments.collectedBy))
}

/** The payments of these orders of the cafe (one at most per order). */
export function paymentsOf(db: Db, tenantId: string, orderIds: string[]): Promise<PaymentRow[]> {
  return readInChunks(orderIds, ids => selectPayments(db).where(inTenant(counterPayments, tenantId, inArray(counterPayments.orderId, ids))))
}

// --- The riel rate (6.3, D101) ---

export interface RateRow {
  perUsd: number
  effectiveFrom: Date
  setByName: string
}

const rateColumns = { perUsd: exchangeRates.perUsd, effectiveFrom: exchangeRates.effectiveFrom, setByName: user.name }

/** The tenant's rate in force at `now`: the latest set before it. */
function currentRateQuery(db: Db, tenantId: string, now: Date) {
  return db.select(rateColumns).from(exchangeRates).innerJoin(user, eq(user.id, exchangeRates.setBy))
    .where(inTenant(exchangeRates, tenantId, eq(exchangeRates.currency, 'KHR'), lte(exchangeRates.effectiveFrom, now)))
    .orderBy(desc(exchangeRates.effectiveFrom))
    .limit(1)
}

export async function currentRate(db: Db, tenantId: string, now: Date): Promise<RateRow | undefined> {
  const [row] = await currentRateQuery(db, tenantId, now)
  return row
}

export interface CounterContextRow {
  timeZone: string
  rate: RateRow | null
  khqr: { enabled: boolean, currencies: string } | null
  hasBakongToken: boolean
}

/** Branch clock, current rate and public KHQR capability in one read; sealed token data is never selected. */
export function counterContext(db: Db, tenantId: string, branchId: string, now: Date): Promise<CounterContextRow | undefined> {
  const rate = currentRateQuery(db, tenantId, now).as('current_rate')
  return firstRow(db.select({
    timeZone: branches.timezone,
    rate: { perUsd: rate.perUsd, effectiveFrom: rate.effectiveFrom, setByName: rate.setByName },
    khqr: { enabled: khqrSettings.enabled, currencies: khqrSettings.currencies },
    hasBakongToken: sql<boolean>`exists (select 1 from ${bakongTokens} where ${bakongTokens.tenantId} = ${tenantId})`.mapWith(Boolean),
  }).from(branches)
    .leftJoin(rate, sql`true`)
    .leftJoin(khqrSettings, eq(khqrSettings.tenantId, branches.tenantId))
    .where(and(eq(branches.tenantId, tenantId), eq(branches.id, branchId))))
}

export function rateHistory(db: Db, tenantId: string, limit: number): Promise<RateRow[]> {
  return db.select(rateColumns).from(exchangeRates).innerJoin(user, eq(user.id, exchangeRates.setBy))
    .where(inTenant(exchangeRates, tenantId, eq(exchangeRates.currency, 'KHR')))
    .orderBy(desc(exchangeRates.effectiveFrom))
    .limit(limit)
}

export function insertRateStatement(db: Db, rate: { tenantId: string, perUsd: number, effectiveFrom: Date, setBy: string }): Statement {
  return db.insert(exchangeRates).values({ ...rate, currency: 'KHR' })
}

/** Across cafes: unpaid orders whose time to pay is over (the expiry task, 6.6), oldest first. */
export function findExpiredUnpaid(db: Db, now: Date, limit: number): Promise<{ id: string, tenantId: string, version: number, branchId: string }[]> {
  return db.select({ id: orders.id, tenantId: orders.tenantId, version: orders.version, branchId: orders.branchId }).from(orders)
    .where(and(eq(orders.status, 'awaiting_payment'), lte(orders.paymentDueAt, now)))
    .orderBy(asc(orders.paymentDueAt))
    .limit(limit)
}

/**
 * Across cafes: per cafe, orders placed since `since`, and when the last one was placed (the
 * platform console's usage numbers, D142). Counts only: a super admin never sees the orders themselves.
 */
export function orderActivity(db: Db, tenantIds: string[], since: Date): Promise<{ tenantId: string, recent: number, lastPlacedAt: Date | null }[]> {
  return readInChunks(tenantIds, ids => db.select({
    tenantId: orders.tenantId,
    recent: sql<number>`sum(case when ${gte(orders.placedAt, since)} then 1 else 0 end)`.mapWith(Number),
    lastPlacedAt: sql<Date | null>`max(${orders.placedAt})`.mapWith(orders.placedAt),
  }).from(orders).where(inArray(orders.tenantId, ids)).groupBy(orders.tenantId))
}

/** Across cafes: of these cafes, those with an order placed at or after `since` (`orders_tenant_placed_idx`: a range per cafe). */
export async function tenantsWithOrdersSince(db: Db, tenantIds: string[], since: Date): Promise<string[]> {
  const rows = await readInChunks(tenantIds, ids => db.selectDistinct({ tenantId: orders.tenantId }).from(orders)
    .where(and(inArray(orders.tenantId, ids), gte(orders.placedAt, since))))
  return rows.map(row => row.tenantId)
}

/** Across cafes: every order of one customer handed to another (a guest's to their account, D156). */
export function moveOrdersStatement(db: Db, fromCustomerId: string, toCustomerId: string): Statement {
  return db.update(orders).set({ customerId: toCustomerId }).where(eq(orders.customerId, fromCustomerId))
}
