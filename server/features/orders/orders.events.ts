import type { OrderStatus, OrderType, PaymentMethod } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { firstName } from './reports.rules'
import * as repo from './orders.repository'

/**
 * What orders tell the rest of the server (D113): neutral outbox events written in the same batch as
 * the change, delivered at least once. Orders don't know who listens (the Telegram alerts do).
 */
export const ORDER_EVENTS = {
  /** A customer placed an order: `{ orderId }`. */
  placed: 'orders.placed',
  /** The counter took its payment: `{ orderId }`. */
  paid: 'orders.paid',
} as const

/**
 * An order as an alert shows it: the customer's **first name only**, never an email or member code
 * (R3); the lines as sold with their notes; the payment when there is one.
 */
export interface OrderAlert {
  orderId: string
  branch: { id: string, name: string }
  pickupNumber: number
  orderType: OrderType
  tableLabel: string | null
  customerFirstName: string
  status: OrderStatus
  lines: { quantity: number, itemName: string, detail: string, modifiers: string[], note: string | null }[]
  totalMinor: number
  payment: { method: PaymentMethod, amountMinor: number, amountKhr: number | null } | null
}

/** The tenant's order, as an alert; `null` when it doesn't exist (an event for a deleted test order). */
export async function orderAlert(db: Db, tenantId: string, orderId: string): Promise<OrderAlert | null> {
  const row = await repo.findOrder(db, tenantId, orderId)
  if (!row) return null
  const [lines, [payment]] = await Promise.all([repo.linesOf(db, orderId), repo.paymentsOf(db, [orderId])])
  return {
    orderId,
    branch: { id: row.branchId, name: row.branchName },
    pickupNumber: row.pickupNumber,
    orderType: row.orderType,
    tableLabel: row.tableLabel,
    customerFirstName: firstName(row.customerName),
    status: row.status,
    lines: lines.map(line => ({ quantity: line.quantity, itemName: line.itemName, detail: line.detail, modifiers: line.modifiers.map(m => m.name), note: line.note })),
    totalMinor: row.totalMinor,
    payment: payment ? { method: payment.method, amountMinor: payment.amountMinor, amountKhr: payment.amountKhr } : null,
  }
}
