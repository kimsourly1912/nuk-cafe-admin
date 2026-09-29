import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { ORDER_STATUSES, ORDER_TYPES } from '#shared/contracts/orders'
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
