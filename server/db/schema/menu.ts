import { sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAt, id, status, updatedAt, version } from '../columns'
import { mediaAssets } from './media'

const statusCheck = (name: string, column: AnySQLiteColumn) => check(name, sql`${column} in ('ACTIVE', 'INACTIVE')`)

/**
 * Main categories (`parentId` null) and their sub-categories. Two levels only; the service
 * enforces the depth (a parent must be a main category) and ordering per parent.
 */
export const menuCategories = sqliteTable('menu_categories', {
  id: id(),
  name: text().notNull(),
  parentId: text().references((): AnySQLiteColumn => menuCategories.id, { onDelete: 'restrict' }),
  status: status(),
  sortOrder: integer().notNull().default(0),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  statusCheck('menu_categories_status_check', t.status),
  index('menu_categories_parent_sort_idx').on(t.parentId, t.sortOrder),
])

/**
 * Weekly availability: `days` is a bitmask (Monday = 1 … Sunday = 64) and the times are minutes
 * after midnight, in the schedule's own IANA `timeZone` (local wall time, D41). Overnight ranges
 * are not accepted until their rule is decided.
 */
export const menuSchedules = sqliteTable('menu_schedules', {
  id: id(),
  name: text().notNull(),
  description: text().notNull().default(''),
  days: integer().notNull(),
  startMinute: integer().notNull(),
  endMinute: integer().notNull(),
  timeZone: text().notNull(),
  status: status(),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  statusCheck('menu_schedules_status_check', t.status),
  check('menu_schedules_days_check', sql`${t.days} between 1 and 127`),
  check('menu_schedules_time_check', sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1439 and ${t.startMinute} < ${t.endMinute}`),
])

/** A menu item. Prices are integer cents of `currencyCode` (USD only at launch). */
export const menuProducts = sqliteTable('menu_products', {
  id: id(),
  categoryId: text().notNull().references(() => menuCategories.id, { onDelete: 'restrict' }),
  name: text().notNull(),
  description: text().notNull().default(''),
  priceMinor: integer().notNull(),
  currencyCode: text().notNull().default('USD'),
  imageAssetId: text().references(() => mediaAssets.id, { onDelete: 'set null' }),
  status: status(),
  sortOrder: integer().notNull().default(0),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  statusCheck('menu_products_status_check', t.status),
  check('menu_products_price_check', sql`${t.priceMinor} >= 0`),
  check('menu_products_currency_check', sql`${t.currencyCode} = 'USD'`),
  index('menu_products_category_idx').on(t.categoryId, t.status, t.sortOrder),
])

/**
 * A choice group of a menu item. `minSelect` 0 = optional; `maxSelect` null = no upper limit.
 * The admin form edits "required" (min 1) and "pick several" (no max) only.
 */
export const productVariantGroups = sqliteTable('product_variant_groups', {
  id: id(),
  productId: text().notNull().references(() => menuProducts.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  minSelect: integer().notNull().default(0),
  maxSelect: integer(),
  sortOrder: integer().notNull().default(0),
}, t => [
  check('product_variant_groups_select_check', sql`${t.minSelect} >= 0 and (${t.maxSelect} is null or (${t.maxSelect} >= 1 and ${t.maxSelect} >= ${t.minSelect}))`),
  index('product_variant_groups_product_idx').on(t.productId, t.sortOrder),
])

export const productVariantOptions = sqliteTable('product_variant_options', {
  id: id(),
  groupId: text().notNull().references(() => productVariantGroups.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  priceDeltaMinor: integer().notNull().default(0),
  sortOrder: integer().notNull().default(0),
}, t => [
  check('product_variant_options_price_check', sql`${t.priceDeltaMinor} >= 0`),
  index('product_variant_options_group_idx').on(t.groupId, t.sortOrder),
])

/**
 * Which schedules a menu item follows: the only place the link is stored. A schedule in use
 * can't be deleted (`restrict`); deleting a menu item removes its links.
 */
export const productSchedules = sqliteTable('product_schedules', {
  productId: text().notNull().references(() => menuProducts.id, { onDelete: 'cascade' }),
  scheduleId: text().notNull().references(() => menuSchedules.id, { onDelete: 'restrict' }),
}, t => [
  primaryKey({ columns: [t.productId, t.scheduleId] }),
  index('product_schedules_schedule_idx').on(t.scheduleId),
])
