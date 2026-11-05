import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { OrderSource } from '#shared/contracts/marketing'
import type { CancelReason, OrderStatus, OrderType, PaymentMethod } from '#shared/contracts/orders'
import type { OrderHistoryQuery } from '#shared/contracts/reports'
import { user } from '#server/db/tables'
import type { Db } from '#server/utils/batch'
import { firstRow, inTenant, readPage } from '#server/utils/query'
import { counterPayments, orderEvents, orderLines, orders } from './orders.schema'
import type { ItemTotalsRow } from './reports.rules'
import { orderDetailQueries } from './orders.repository'

/** The reports' SQL (step 8.1, D110). Money is summed as integers in SQL, never as floats. */

/** A cafe's branch and an instant range `[start, end)`. */
export interface Range { tenantId: string, branchId: string, start: Date, end: Date }

/** At most one row per method/window, independent of sales volume. One JSON bind respects D1's limit. */
function paymentsCollectedQuery(db: Db, range: Range, windows: { start: number, end: number }[]) {
  return db.select({
    method: counterPayments.method,
    amountMinor: sql<number>`sum(${counterPayments.amountMinor})`,
    amountKhr: sql<number | null>`sum(${counterPayments.amountKhr})`,
    collectedAt: sql<Date>`min(${counterPayments.collectedAt})`.mapWith(value => new Date(Number(value))),
    orders: count(),
  })
    .from(counterPayments)
    .innerJoin(sql`json_each(${JSON.stringify(windows)}) as bucket`, sql`${counterPayments.collectedAt} >= json_extract(bucket.value, '$.start') and ${counterPayments.collectedAt} < json_extract(bucket.value, '$.end')`)
    .where(inTenant(counterPayments, range.tenantId, eq(counterPayments.branchId, range.branchId), gte(counterPayments.collectedAt, range.start), lt(counterPayments.collectedAt, range.end)))
    .groupBy(counterPayments.method, sql`bucket.key`)
}

export function paymentsCollected(db: Db, range: Range, windows: { start: number, end: number }[]) {
  return paymentsCollectedQuery(db, range, windows)
}

/** Paid sales in `[start, end)` as one sum (the previous period's, for comparison). */
function paidSalesTotalQuery(db: Db, range: Range) {
  return db.select({ total: sql<number>`coalesce(sum(${counterPayments.amountMinor}), 0)` })
    .from(counterPayments)
    .where(inTenant(counterPayments, range.tenantId, eq(counterPayments.branchId, range.branchId), gte(counterPayments.collectedAt, range.start), lt(counterPayments.collectedAt, range.end)))
}

function refundsReturnedQuery(db: Db, range: Range) {
  return db.select({ amountMinor: sql<number>`coalesce(sum(${counterPayments.amountMinor}), 0)`, orders: count() })
    .from(counterPayments)
    .where(inTenant(counterPayments, range.tenantId, eq(counterPayments.branchId, range.branchId), gte(counterPayments.returnedAt, range.start), lt(counterPayments.returnedAt, range.end)))
}

/**
 * Line totals per item of the orders whose payment was collected (`at` = collected_at) or returned
 * (`at` = returned_at) in `[start, end)`. SQLite takes the bare name and category columns from the
 * row holding `max(placed_at)`: the item's latest sale.
 */
function itemTotalsQuery(db: Db, range: Range, at: 'collected' | 'returned') {
  const time = at === 'collected' ? counterPayments.collectedAt : counterPayments.returnedAt
  return db.select({
    itemId: orderLines.itemId,
    lastAt: sql<number>`max(${orders.placedAt})`,
    name: orderLines.itemName,
    categoryId: orderLines.categoryId,
    categoryName: orderLines.categoryName,
    quantity: sql<number>`sum(${orderLines.quantity})`,
    totalMinor: sql<number>`sum(${orderLines.totalMinor})`,
  })
    .from(orderLines)
    .innerJoin(counterPayments, and(eq(counterPayments.tenantId, orderLines.tenantId), eq(counterPayments.orderId, orderLines.orderId)))
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(inTenant(counterPayments, range.tenantId, eq(counterPayments.branchId, range.branchId), gte(time, range.start), lt(time, range.end)))
    .groupBy(orderLines.itemId)
}

/** A cafe's branch and business dates `from`–`to`, both included. */
export interface DateRange { tenantId: string, branchId: string, from: string, to: string }
const placedIn = (range: DateRange) => inTenant(orders, range.tenantId, eq(orders.branchId, range.branchId), gte(orders.businessDate, range.from), lte(orders.businessDate, range.to))

/** Orders placed in the business dates, any outcome. */
function ordersPlacedQuery(db: Db, range: DateRange) {
  return db.select({ n: count() }).from(orders).where(placedIn(range))
}

/**
 * Orders placed in the business dates and cancelled without a payment, by who cancelled: nobody
 * (the 30-minute expiry), the customer, or someone at the cafe.
 */
function cancelledUnpaidQuery(db: Db, range: DateRange) {
  const by = sql<'system' | 'customer' | 'cafe'>`case when ${orderEvents.actorId} is null then 'system' when ${orderEvents.actorId} = ${orders.customerId} then 'customer' else 'cafe' end`
  return db.select({ by, n: count() })
    .from(orders)
    .innerJoin(orderEvents, and(eq(orderEvents.tenantId, orders.tenantId), eq(orderEvents.orderId, orders.id), eq(orderEvents.toStatus, 'cancelled')))
    .leftJoin(counterPayments, and(eq(counterPayments.tenantId, orders.tenantId), eq(counterPayments.orderId, orders.id)))
    .where(and(placedIn(range), eq(orders.status, 'cancelled'), isNull(counterPayments.id)))
    .groupBy(by)
}

/** Live counts of the branch's orders in play (waiting ones only while still due). */
function currentCountsQuery(db: Db, tenantId: string, branchId: string, now: Date, enabled = true) {
  return db.select({ status: orders.status, n: count() })
    .from(orders)
    .where(inTenant(
      orders,
      tenantId,
      eq(orders.branchId, branchId),
      enabled ? undefined : sql`0`,
      or(inArray(orders.status, ['preparing', 'ready']), and(eq(orders.status, 'awaiting_payment'), gt(orders.paymentDueAt, now))),
    ))
    .groupBy(orders.status)
}

/** One transactional read of every monetary/count input to a summary. Uses the payment date indexes. */
export async function summaryRows(db: Db, range: Range, windows: { start: number, end: number }[], previous: Range, dates: DateRange, currentAt: Date | null) {
  const [payments, [refunds], [previousPaid], paidItems, [placed], cancelled, current] = await db.batch([
    paymentsCollectedQuery(db, range, windows),
    refundsReturnedQuery(db, range),
    paidSalesTotalQuery(db, previous),
    itemTotalsQuery(db, range, 'collected'),
    ordersPlacedQuery(db, dates),
    cancelledUnpaidQuery(db, dates),
    currentCountsQuery(db, range.tenantId, range.branchId, currentAt ?? range.start, currentAt !== null),
  ])
  return { payments, refunds: refunds ?? { amountMinor: 0, orders: 0 }, previousPaidSalesMinor: previousPaid?.total ?? 0, paidItems, placed: placed?.n ?? 0, cancelled, current: currentAt ? current : null }
}

/** Collected and returned item totals in one snapshot, shared by page, CSV and Telegram. */
export async function itemSalesSnapshot(db: Db, range: Range): Promise<[ItemTotalsRow[], ItemTotalsRow[]]> {
  return db.batch([itemTotalsQuery(db, range, 'collected'), itemTotalsQuery(db, range, 'returned')])
}

// --- Order history ---

export interface HistoryRow {
  id: string
  pickupNumber: number
  businessDate: string
  placedAt: Date
  orderType: OrderType
  tableLabel: string | null
  status: OrderStatus
  totalMinor: number
  method: PaymentMethod | null
  paymentId: string | null
  returnedAt: Date | null
}

/** Whether the history's filters read the payment (the total then joins it too). */
const filtersPayment = (query: OrderHistoryQuery) => Boolean(query.method || query.payment)

function historyWhere(tenantId: string, query: OrderHistoryQuery): SQL {
  const conditions: (SQL | undefined)[] = [placedIn({ tenantId, ...query })]
  if (query.search) conditions.push(eq(orders.pickupNumber, Number(query.search)))
  if (query.type) conditions.push(eq(orders.orderType, query.type))
  if (query.progress) conditions.push(eq(orders.status, query.progress))
  if (query.method) conditions.push(eq(counterPayments.method, query.method))
  if (query.payment === 'paid') conditions.push(and(isNotNull(counterPayments.id), isNull(counterPayments.returnedAt)))
  if (query.payment === 'refunded') conditions.push(isNotNull(counterPayments.returnedAt))
  if (query.payment === 'unpaid') conditions.push(and(isNull(counterPayments.id), eq(orders.status, 'awaiting_payment')))
  if (query.payment === 'not_paid') conditions.push(and(isNull(counterPayments.id), eq(orders.status, 'cancelled')))
  return and(...conditions)!
}

/** A page of the orders placed in the business dates, filtered and sorted, and how many match. */
export function orderHistory(db: Db, tenantId: string, query: OrderHistoryQuery): Promise<{ rows: HistoryRow[], total: number }> {
  const where = historyWhere(tenantId, query)
  const direction = query.direction === 'asc' ? asc : desc
  const order = query.sort === 'total'
    ? [direction(orders.totalMinor), direction(orders.placedAt)]
    : query.sort === 'number'
      ? [direction(orders.businessDate), direction(orders.pickupNumber)]
      : [direction(orders.placedAt)]
  const payment = and(eq(counterPayments.tenantId, orders.tenantId), eq(counterPayments.orderId, orders.id))
  const total = filtersPayment(query)
    ? db.select({ total: count() }).from(orders).leftJoin(counterPayments, payment).where(where)
    : db.select({ total: count() }).from(orders).where(where)
  return readPage(db, db.select({
    id: orders.id,
    pickupNumber: orders.pickupNumber,
    businessDate: orders.businessDate,
    placedAt: orders.placedAt,
    orderType: orders.orderType,
    tableLabel: orders.tableLabel,
    status: orders.status,
    totalMinor: orders.totalMinor,
    method: counterPayments.method,
    // Read in one D1 batch: the payment's id needs its own SQL name, or it replaces the order's (D170).
    paymentId: sql<string | null>`${counterPayments.id}`.as('payment_id'),
    returnedAt: counterPayments.returnedAt,
  })
    .from(orders)
    .leftJoin(counterPayments, payment)
    .where(where)
    .orderBy(...order, asc(orders.id))
    .$dynamic(), total, query)
}

export interface EventRow {
  at: Date
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  actorId: string | null
  actorName: string | null
  reason: CancelReason | null
  note: string | null
}

/** An order's steps, oldest first, with who took each (null: the system). */
function eventsQuery(db: Db, tenantId: string, orderId: string) {
  return db.select({
    at: orderEvents.at,
    fromStatus: orderEvents.fromStatus,
    toStatus: orderEvents.toStatus,
    actorId: orderEvents.actorId,
    actorName: user.name,
    reason: orderEvents.reason,
    note: orderEvents.note,
  })
    .from(orderEvents)
    .leftJoin(user, eq(user.id, orderEvents.actorId))
    .where(inTenant(orderEvents, tenantId, eq(orderEvents.orderId, orderId)))
    .orderBy(asc(orderEvents.toVersion))
}

/** Who returned an order's money, when it was. */
function returnedByQuery(db: Db, tenantId: string, orderId: string) {
  return db.select({ name: user.name }).from(counterPayments)
    .innerJoin(user, eq(user.id, counterPayments.returnedBy))
    .where(inTenant(counterPayments, tenantId, eq(counterPayments.orderId, orderId))).limit(1)
}

export function eventsOf(db: Db, tenantId: string, orderId: string): Promise<EventRow[]> {
  return eventsQuery(db, tenantId, orderId)
}

export async function returnedByName(db: Db, tenantId: string, orderId: string): Promise<string | null> {
  return (await returnedByQuery(db, tenantId, orderId))[0]?.name ?? null
}

/** One scoped snapshot for customer tracking, counter history and report detail. */
export async function orderDetailRows(db: Db, tenantId: string, orderId: string, scope: { customerId?: string, branchId?: string } = {}) {
  const [rows, lines, payments, events, returned] = await db.batch([
    ...orderDetailQueries(db, tenantId, orderId, scope),
    eventsQuery(db, tenantId, orderId),
    returnedByQuery(db, tenantId, orderId),
  ])
  return { order: rows[0], lines, payment: payments[0], events, returnedBy: returned[0]?.name ?? null }
}

/**
 * A promotion's results (M1, D163): the lines sold at its price on orders paid and not cancelled
 * (preparing, ready or completed). Discount = (price before − price paid) × quantity, per line.
 */
export async function promotionTotals(db: Db, tenantId: string, promotionId: string): Promise<{ orders: number, units: number, discountMinor: number, salesMinor: number, bySource: Record<OrderSource, number> }> {
  const row = await firstRow(db.select({
    orders: sql<number>`count(distinct ${orderLines.orderId})`,
    units: sql<number>`coalesce(sum(${orderLines.quantity}), 0)`,
    discountMinor: sql<number>`coalesce(sum((${orderLines.regularUnitPriceMinor} - ${orderLines.unitPriceMinor}) * ${orderLines.quantity}), 0)`,
    salesMinor: sql<number>`coalesce(sum(${orderLines.totalMinor}), 0)`,
    telegram: sql<number>`count(distinct case when ${orders.source} = 'telegram' then ${orderLines.orderId} end)`,
    facebook: sql<number>`count(distinct case when ${orders.source} = 'facebook' then ${orderLines.orderId} end)`,
  })
    .from(orderLines)
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(inTenant(orderLines, tenantId, eq(orderLines.promotionId, promotionId), inArray(orders.status, ['preparing', 'ready', 'completed']))))
  return { orders: row?.orders ?? 0, units: row?.units ?? 0, discountMinor: row?.discountMinor ?? 0, salesMinor: row?.salesMinor ?? 0, bySource: { telegram: row?.telegram ?? 0, facebook: row?.facebook ?? 0 } }
}
