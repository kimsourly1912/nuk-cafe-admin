import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { OrderStatus, OrderType, PaymentMethod } from '#shared/contracts/orders'
import type { OrderHistoryQuery } from '#shared/contracts/reports'
import { organization, user } from '../../db/tables'
import type { Db } from '../../utils/batch'
import { counterPayments, orderEvents, orderLines, orders } from './orders.schema'
import type { ItemTotalsRow } from './reports.rules'

/** The reports' SQL (step 8.1, D110). Money is summed as integers in SQL, never as floats. */

export async function findReportBranch(db: Db, id: string): Promise<{ id: string, name: string, timeZone: string } | undefined> {
  const [row] = await db.select({ id: organization.id, name: organization.name, timeZone: organization.timezone }).from(organization).where(eq(organization.id, id))
  return row
}

interface Range { branchId: string, start: Date, end: Date }

/** Payments collected in `[start, end)`. */
export async function paymentsCollected(db: Db, range: Range): Promise<{ method: PaymentMethod, amountMinor: number, amountKhr: number | null, collectedAt: Date }[]> {
  return db.select({ method: counterPayments.method, amountMinor: counterPayments.amountMinor, amountKhr: counterPayments.amountKhr, collectedAt: counterPayments.collectedAt })
    .from(counterPayments)
    .where(and(eq(counterPayments.branchId, range.branchId), gte(counterPayments.collectedAt, range.start), lt(counterPayments.collectedAt, range.end)))
}

/** Paid sales in `[start, end)` as one sum (the previous period's, for comparison). */
export async function paidSalesTotal(db: Db, range: Range): Promise<number> {
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${counterPayments.amountMinor}), 0)` })
    .from(counterPayments)
    .where(and(eq(counterPayments.branchId, range.branchId), gte(counterPayments.collectedAt, range.start), lt(counterPayments.collectedAt, range.end)))
  return row?.total ?? 0
}

/** Money returned in `[start, end)`: the full payment of each refunded order. */
export async function refundsReturned(db: Db, range: Range): Promise<{ amountMinor: number, orders: number }> {
  const [row] = await db.select({ amountMinor: sql<number>`coalesce(sum(${counterPayments.amountMinor}), 0)`, orders: count() })
    .from(counterPayments)
    .where(and(eq(counterPayments.branchId, range.branchId), gte(counterPayments.returnedAt, range.start), lt(counterPayments.returnedAt, range.end)))
  return { amountMinor: row?.amountMinor ?? 0, orders: row?.orders ?? 0 }
}

/**
 * Line totals per item of the orders whose payment was collected (`at` = collected_at) or returned
 * (`at` = returned_at) in `[start, end)`. SQLite takes the bare name and category columns from the
 * row holding `max(placed_at)`: the item's latest sale.
 */
export async function itemTotals(db: Db, range: Range, at: 'collected' | 'returned'): Promise<ItemTotalsRow[]> {
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
    .innerJoin(counterPayments, eq(counterPayments.orderId, orderLines.orderId))
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(counterPayments.branchId, range.branchId), gte(time, range.start), lt(time, range.end)))
    .groupBy(orderLines.itemId)
}

interface DateRange { branchId: string, from: string, to: string }
const placedIn = (range: DateRange) => and(eq(orders.branchId, range.branchId), gte(orders.businessDate, range.from), sql`${orders.businessDate} <= ${range.to}`)

/** Orders placed in the business dates, any outcome. */
export async function ordersPlaced(db: Db, range: DateRange): Promise<number> {
  const [row] = await db.select({ n: count() }).from(orders).where(placedIn(range))
  return row?.n ?? 0
}

/**
 * Orders placed in the business dates and cancelled without a payment, by who cancelled: nobody
 * (the 30-minute expiry), the customer, or someone at the cafe.
 */
export async function cancelledUnpaid(db: Db, range: DateRange): Promise<{ by: 'system' | 'customer' | 'cafe', n: number }[]> {
  const by = sql<'system' | 'customer' | 'cafe'>`case when ${orderEvents.actorId} is null then 'system' when ${orderEvents.actorId} = ${orders.customerId} then 'customer' else 'cafe' end`
  return db.select({ by, n: count() })
    .from(orders)
    .innerJoin(orderEvents, and(eq(orderEvents.orderId, orders.id), eq(orderEvents.toStatus, 'cancelled')))
    .leftJoin(counterPayments, eq(counterPayments.orderId, orders.id))
    .where(and(placedIn(range), eq(orders.status, 'cancelled'), isNull(counterPayments.id)))
    .groupBy(by)
}

/** Live counts of the branch's orders in play (waiting ones only while still due). */
export async function currentCounts(db: Db, branchId: string, now: Date): Promise<{ status: OrderStatus, n: number }[]> {
  return db.select({ status: orders.status, n: count() })
    .from(orders)
    .where(and(
      eq(orders.branchId, branchId),
      sql`(${orders.status} in ('preparing', 'ready') or (${orders.status} = 'awaiting_payment' and ${orders.paymentDueAt} > ${now.getTime()}))`,
    ))
    .groupBy(orders.status)
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

function historyWhere(query: OrderHistoryQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [placedIn(query)]
  if (query.search) conditions.push(eq(orders.pickupNumber, Number(query.search)))
  if (query.type) conditions.push(eq(orders.orderType, query.type))
  if (query.progress) conditions.push(eq(orders.status, query.progress))
  if (query.method) conditions.push(eq(counterPayments.method, query.method))
  if (query.payment === 'paid') conditions.push(and(isNotNull(counterPayments.id), isNull(counterPayments.returnedAt)))
  if (query.payment === 'refunded') conditions.push(isNotNull(counterPayments.returnedAt))
  if (query.payment === 'unpaid') conditions.push(and(isNull(counterPayments.id), eq(orders.status, 'awaiting_payment')))
  if (query.payment === 'not_paid') conditions.push(and(isNull(counterPayments.id), eq(orders.status, 'cancelled')))
  return and(...conditions)
}

/** A page of the orders placed in the business dates, filtered and sorted, and how many match. */
export async function orderHistory(db: Db, query: OrderHistoryQuery): Promise<{ rows: HistoryRow[], total: number }> {
  const where = historyWhere(query)
  const direction = query.direction === 'asc' ? asc : desc
  const order = query.sort === 'total'
    ? [direction(orders.totalMinor), direction(orders.placedAt)]
    : query.sort === 'number'
      ? [direction(orders.businessDate), direction(orders.pickupNumber)]
      : [direction(orders.placedAt)]
  const [rows, [counted]] = await Promise.all([
    db.select({
      id: orders.id,
      pickupNumber: orders.pickupNumber,
      businessDate: orders.businessDate,
      placedAt: orders.placedAt,
      orderType: orders.orderType,
      tableLabel: orders.tableLabel,
      status: orders.status,
      totalMinor: orders.totalMinor,
      method: counterPayments.method,
      paymentId: counterPayments.id,
      returnedAt: counterPayments.returnedAt,
    })
      .from(orders)
      .leftJoin(counterPayments, eq(counterPayments.orderId, orders.id))
      .where(where)
      .orderBy(...order, asc(orders.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ n: count() }).from(orders).leftJoin(counterPayments, eq(counterPayments.orderId, orders.id)).where(where),
  ])
  return { rows, total: counted?.n ?? 0 }
}

/** An order's steps, oldest first, with who took each (null: the system). */
export async function eventsOf(db: Db, orderId: string) {
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
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.toVersion))
}

/** Who returned an order's money, when it was. */
export async function returnedByName(db: Db, orderId: string): Promise<string | null> {
  const [row] = await db.select({ name: user.name }).from(counterPayments).innerJoin(user, eq(user.id, counterPayments.returnedBy)).where(eq(counterPayments.orderId, orderId))
  return row?.name ?? null
}
