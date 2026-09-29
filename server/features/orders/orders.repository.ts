import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { OrderStatus, OrderType, QuotedModifier } from '#shared/contracts/orders'
import { organization } from '../../db/tables'
import type { Db, Statement } from '../../utils/batch'
import { insertPieces, requireAtMost } from '../../utils/batch'
import { orderLines, orders } from './orders.schema'

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
  pickupNumber: number
  businessDate: string
  status: OrderStatus
  orderType: OrderType
  tableLabel: string | null
  subtotalMinor: number
  totalMinor: number
  placedAt: Date
  paymentDueAt: Date
  cancelledAt: Date | null
}

export async function findOrder(db: Db, id: string): Promise<OrderRow | undefined> {
  const [row] = await db.select({
    id: orders.id,
    branchId: orders.branchId,
    branchName: organization.name,
    customerId: orders.customerId,
    pickupNumber: orders.pickupNumber,
    businessDate: orders.businessDate,
    status: orders.status,
    orderType: orders.orderType,
    tableLabel: orders.tableLabel,
    subtotalMinor: orders.subtotalMinor,
    totalMinor: orders.totalMinor,
    placedAt: orders.placedAt,
    paymentDueAt: orders.paymentDueAt,
    cancelledAt: orders.cancelledAt,
  }).from(orders).innerJoin(organization, eq(organization.id, orders.branchId)).where(eq(orders.id, id))
  return row
}

export async function linesOf(db: Db, orderId: string) {
  return db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.position))
}

/** Unpaid orders still due, for tests and the expiry task (6.6). */
export async function unpaidCount(db: Db, customerId: string, now: Date): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.status, 'awaiting_payment'), gt(orders.paymentDueAt, now)))
  return row?.count ?? 0
}
