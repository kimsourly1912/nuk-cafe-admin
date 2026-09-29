import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { CANCEL_REASONS, ORDER_STATUSES, ORDER_TYPES, PAYMENT_METHODS, RETURN_METHODS } from '#shared/contracts/orders'
import { newId } from '../../utils/ids'

/**
 * Orders (docs/server/data-model.md → Orders, step 6.2, D99). An order is a **snapshot**: its
 * lines keep the names, choices and prices as they were when it was placed, so a later menu edit,
 * archive or sample-data reset never changes it. Menu ids are kept for reports, without foreign
 * keys (menu records can be reset in test environments, D94). Registered with NuxtHub through the
 * `hub:db:schema:extend` hook.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })

export const orders = sqliteTable('orders', {
  id: text().primaryKey().$defaultFn(() => newId()),
  // Branches and accounts are archived or disabled, never deleted while orders point at them.
  branchId: text().notNull().references(() => authSchema!.organization.id, { onDelete: 'restrict' }),
  customerId: text().notNull().references(() => authSchema!.user.id, { onDelete: 'restrict' }),
  /** The branch's business day (`YYYY-MM-DD`, starting at 4:00 local time, D99). */
  businessDate: text().notNull(),
  /** 1, 2, 3 … per branch and business day; shown as "042". */
  pickupNumber: integer().notNull(),
  status: text({ enum: ORDER_STATUSES }).notNull().default('awaiting_payment'),
  orderType: text({ enum: ORDER_TYPES }).notNull(),
  /**
   * Dine-in only: a `dining_tables` id (the branches feature owns that table, and archives tables,
   * never deletes them; like the menu's image ids, no cross-feature foreign key). Its label is kept
   * too, as it was.
   */
  tableId: text(),
  tableLabel: text(),
  subtotalMinor: integer().notNull(),
  totalMinor: integer().notNull(),
  currency: text().notNull().default('USD'),
  placedAt: instant().notNull(),
  /** Unpaid after this: cancelled (the expiry task, step 6.6). */
  paymentDueAt: instant().notNull(),
  /** When the counter recorded the payment, which started preparation (6.3, D101). */
  paidAt: instant(),
  readyAt: instant(),
  completedAt: instant(),
  cancelledAt: instant(),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('orders_status_check', sql`${t.status} in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled')`),
  check('orders_type_check', sql`(${t.orderType} = 'pickup' and ${t.tableId} is null) or (${t.orderType} = 'dine_in' and ${t.tableId} is not null)`),
  check('orders_amounts_check', sql`${t.subtotalMinor} >= 0 and ${t.totalMinor} >= 0 and ${t.pickupNumber} >= 1`),
  // The final guard against two orders sharing a number on a busy day.
  uniqueIndex('orders_pickup_number_idx').on(t.branchId, t.businessDate, t.pickupNumber),
  index('orders_customer_idx').on(t.customerId, t.placedAt),
  index('orders_branch_status_idx').on(t.branchId, t.status),
])

/** One line of an order, as it was priced when placed. */
export const orderLines = sqliteTable('order_lines', {
  id: text().primaryKey().$defaultFn(() => newId()),
  orderId: text().notNull().references(() => orders.id, { onDelete: 'cascade' }),
  /** 0, 1, 2 … in the order the customer listed them. */
  position: integer().notNull(),
  itemId: text().notNull(),
  variationId: text().notNull(),
  itemName: text().notNull(),
  /** "Large, Iced · Oat milk, Extra shot". */
  detail: text().notNull(),
  /** The add-ons as priced: `[{ id, name, priceDeltaMinor }]`. */
  modifiers: text({ mode: 'json' }).$type<{ id: string, name: string, priceDeltaMinor: number }[]>().notNull(),
  unitPriceMinor: integer().notNull(),
  quantity: integer().notNull(),
  totalMinor: integer().notNull(),
  note: text(),
}, t => [
  check('order_lines_amounts_check', sql`${t.quantity} between 1 and 20 and ${t.unitPriceMinor} >= 0 and ${t.totalMinor} = ${t.unitPriceMinor} * ${t.quantity}`),
  uniqueIndex('order_lines_position_idx').on(t.orderId, t.position),
])

/**
 * What happened to an order, one row per version (6.3, D101): placed, paid, ready, completed,
 * cancelled; who did it and, for a cancellation, why. Written in the same batch as the change.
 */
export const orderEvents = sqliteTable('order_events', {
  id: text().primaryKey().$defaultFn(() => newId()),
  orderId: text().notNull().references(() => orders.id, { onDelete: 'cascade' }),
  /** The order's version after this change: 1 when placed. */
  toVersion: integer().notNull(),
  /** `null`: the system (the unpaid-order expiry, 6.6). */
  actorId: text().references(() => authSchema!.user.id, { onDelete: 'restrict' }),
  fromStatus: text({ enum: ORDER_STATUSES }),
  toStatus: text({ enum: ORDER_STATUSES }).notNull(),
  reason: text({ enum: CANCEL_REASONS }),
  note: text(),
  at: instant().notNull(),
}, t => [
  check('order_events_status_check', sql`${t.toStatus} in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled') and (${t.fromStatus} is null or ${t.fromStatus} in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled'))`),
  check('order_events_reason_check', sql`${t.reason} is null or ${t.reason} in ('customer_changed_mind', 'item_unavailable', 'other')`),
  uniqueIndex('order_events_version_idx').on(t.orderId, t.toVersion),
])

/**
 * The payment taken at the counter (6.3, D101): **one per order** (unique), and recording it
 * starts preparation. The amount is the order's total; cash in riel keeps the riel asked for and
 * the rate used. A paid order cancelled before it was ready records how the money went back.
 */
export const counterPayments = sqliteTable('counter_payments', {
  id: text().primaryKey().$defaultFn(() => newId()),
  orderId: text().notNull().references(() => orders.id, { onDelete: 'restrict' }),
  branchId: text().notNull().references(() => authSchema!.organization.id, { onDelete: 'restrict' }),
  method: text({ enum: PAYMENT_METHODS }).notNull(),
  amountMinor: integer().notNull(),
  amountKhr: integer(),
  khrPerUsd: integer(),
  reference: text(),
  collectedBy: text().notNull().references(() => authSchema!.user.id, { onDelete: 'restrict' }),
  collectedAt: instant().notNull(),
  returnMethod: text({ enum: RETURN_METHODS }),
  returnedBy: text().references(() => authSchema!.user.id, { onDelete: 'restrict' }),
  returnedAt: instant(),
}, t => [
  check('counter_payments_method_check', sql`${t.method} in ('cash_usd', 'cash_khr', 'khqr') and ${t.amountMinor} >= 0`),
  check('counter_payments_khr_check', sql`(${t.method} = 'cash_khr') = (${t.amountKhr} is not null and ${t.khrPerUsd} is not null)`),
  check('counter_payments_return_check', sql`(${t.returnMethod} is null and ${t.returnedAt} is null and ${t.returnedBy} is null) or (${t.returnMethod} in ('cash', 'khqr') and ${t.returnedAt} is not null and ${t.returnedBy} is not null)`),
  uniqueIndex('counter_payments_order_idx').on(t.orderId),
  index('counter_payments_branch_idx').on(t.branchId, t.collectedAt),
])

/** The riel rate an admin set, from `effectiveFrom` on (append-only; 6.3, D101). */
export const exchangeRates = sqliteTable('exchange_rates', {
  id: text().primaryKey().$defaultFn(() => newId()),
  currency: text().notNull().default('KHR'),
  perUsd: integer().notNull(),
  effectiveFrom: instant().notNull(),
  setBy: text().notNull().references(() => authSchema!.user.id, { onDelete: 'restrict' }),
}, t => [
  check('exchange_rates_check', sql`${t.currency} = 'KHR' and ${t.perUsd} between 1000 and 10000`),
  index('exchange_rates_effective_idx').on(t.currency, t.effectiveFrom),
])
