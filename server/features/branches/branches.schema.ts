import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { DINING_TABLE_STATUSES } from '#shared/contracts/branches'
import { newId } from '#server/utils/ids'

/**
 * Branch settings and dining tables (docs/server/data-model.md → Branches, step 5.1, D91). A branch
 * is a Better Auth organization; its details (timezone, address, phone, version) are additional
 * fields there. Registered with NuxtHub through the `hub:db:schema:extend` hook.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })
// '#auth/schema' declares only the core tables by name; its `schema` object holds every one.
const branchId = () => text().notNull().references(() => authSchema!.organization.id, { onDelete: 'restrict' })

/**
 * When the branch is open: weekly windows in its local time, like the menu's availability windows
 * (ISO `weekday`, minutes after midnight, an end before the start runs past midnight). Replaced
 * whole when the branch's hours are saved; none: never open (orders need it open, D45).
 */
export const branchHours = sqliteTable('branch_hours', {
  branchId: branchId(),
  weekday: integer().notNull(),
  startMinute: integer().notNull(),
  endMinute: integer().notNull(),
}, t => [
  // Windows don't overlap (checked by the service), so none share a start.
  primaryKey({ columns: [t.branchId, t.weekday, t.startMinute] }),
  check('branch_hours_range_check', sql`${t.weekday} between 1 and 7 and ${t.startMinute} between 0 and 1439 and ${t.endMinute} between 1 and 1440 and ${t.endMinute} <> ${t.startMinute}`),
])

/**
 * A table customers sit at, with the QR code printed on it. The QR's token is rebuilt from the
 * server's secret, the table id and `qrVersion` (D91), so only its hash is stored: a leaked
 * database reveals no working QR. Rotating increments `qrVersion`. Archived, never deleted: orders
 * will reference tables.
 */
export const diningTables = sqliteTable('dining_tables', {
  id: text().primaryKey().$defaultFn(() => newId()),
  branchId: branchId(),
  label: text().notNull(),
  area: text(),
  status: text({ enum: DINING_TABLE_STATUSES }).notNull().default('active'),
  qrVersion: integer().notNull().default(1),
  qrTokenHash: text().notNull(),
  qrRotatedAt: instant().notNull().default(nowMs),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('dining_tables_status_check', sql`${t.status} in ('active', 'archived')`),
  uniqueIndex('dining_tables_qr_token_hash_idx').on(t.qrTokenHash),
  // Labels are unique among a branch's active tables, ignoring case ("Table 1" and "table 1").
  uniqueIndex('dining_tables_active_label_idx').on(t.branchId, sql`lower(${t.label})`).where(sql`${t.status} = 'active'`),
  index('dining_tables_branch_idx').on(t.branchId),
])
