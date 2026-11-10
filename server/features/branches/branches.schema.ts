import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { DINING_TABLE_STATUSES } from '#shared/contracts/branches'
import { BUILT_IN_LOOK_IDS } from '#shared/contracts/shop-layout'
import type { FloorGeometry } from '#shared/contracts/shop-layout'
import { BRANCH_ROLES } from '#shared/contracts/staff'
import { newId } from '#server/utils/ids'

/**
 * Branches, their staff, hours and dining tables (docs/server/data-model.md → Branches, step 5.1,
 * D91, D134). A branch belongs to a tenant (a Better Auth organization); every row here carries the
 * tenant, and links between them are composite foreign keys `(tenant_id, …)`, so the database
 * refuses a link into another tenant. Registered with NuxtHub through the `hub:db:schema:extend`
 * hook.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })
// '#auth/schema' declares only the core tables by name; its `schema` object holds every one.
export const tenantId = () => text().notNull().references(() => authSchema!.organization.id, { onDelete: 'restrict' })

export const BRANCH_STATUSES = ['active', 'archived'] as const

/**
 * A branch of a tenant (D134; before it, a Better Auth organization, whose ids it kept). Archived,
 * never deleted: orders and reports reference it.
 */
export const branches = sqliteTable('branches', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  name: text().notNull(),
  timezone: text().notNull(),
  currency: text().notNull().default('USD'),
  address: text(),
  phone: text(),
  status: text({ enum: BRANCH_STATUSES }).notNull().default('active'),
  // The lock for the branch's settings and hours (D41, D91): every save names it.
  version: integer().notNull().default(1),
  // Online orders paused until then (D199): a state set by the counter, outside `version` (like
  // sold out), so an owner's settings save never conflicts with it. Past means not paused.
  pausedUntil: instant(),
  pausedBy: text().references(() => authSchema!.user.id, { onDelete: 'set null' }),
  pauseReason: text(),
  createdAt: instant().notNull().default(nowMs),
}, t => [
  check('branches_status_check', sql`${t.status} in ('active', 'archived')`),
  // The target of every `(tenant_id, branch_id)` foreign key.
  unique('branches_tenant_id_unique').on(t.tenantId, t.id),
  // Names are unique among a cafe's active branches, ignoring case (D197).
  uniqueIndex('branches_active_name_idx').on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.status} = 'active'`),
])

/**
 * Who works at a branch, and as what (D134): `manager` or `staff`. A tenant's owners need no row:
 * they act in every branch. Each person here is also a member of the tenant (Better Auth's
 * `member`, role `member` or `owner`).
 */
export const branchStaff = sqliteTable('branch_staff', {
  tenantId: tenantId(),
  branchId: text().notNull(),
  userId: text().notNull().references(() => authSchema!.user.id, { onDelete: 'cascade' }),
  role: text({ enum: BRANCH_ROLES }).notNull(),
  createdAt: instant().notNull().default(nowMs),
}, t => [
  primaryKey({ columns: [t.branchId, t.userId] }),
  foreignKey({ name: 'branch_staff_branch_fk', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('cascade'),
  check('branch_staff_role_check', sql`${t.role} in ('manager', 'staff')`),
  index('branch_staff_user_idx').on(t.userId),
])

/**
 * When the branch is open: weekly windows in its local time, like the menu's availability windows
 * (ISO `weekday`, minutes after midnight, an end before the start runs past midnight). Replaced
 * whole when the branch's hours are saved; none: never open (orders need it open, D45).
 */
export const branchHours = sqliteTable('branch_hours', {
  tenantId: tenantId(),
  branchId: text().notNull(),
  weekday: integer().notNull(),
  startMinute: integer().notNull(),
  endMinute: integer().notNull(),
}, t => [
  // Windows don't overlap (checked by the service), so none share a start.
  primaryKey({ columns: [t.branchId, t.weekday, t.startMinute] }),
  foreignKey({ name: 'branch_hours_branch_fk', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('restrict'),
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
  tenantId: tenantId(),
  branchId: text().notNull(),
  label: text().notNull(),
  area: text(),
  // How many people sit at it (D273): the 3D view draws as many chairs. Between 1 and 20.
  seats: integer().notNull().default(2),
  status: text({ enum: DINING_TABLE_STATUSES }).notNull().default('active'),
  qrVersion: integer().notNull().default(1),
  qrTokenHash: text().notNull(),
  qrRotatedAt: instant().notNull().default(nowMs),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  foreignKey({ name: 'dining_tables_branch_fk', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('restrict'),
  check('dining_tables_status_check', sql`${t.status} in ('active', 'archived')`),
  uniqueIndex('dining_tables_qr_token_hash_idx').on(t.qrTokenHash),
  // Labels are unique among a branch's active tables, ignoring case ("Table 1" and "table 1").
  uniqueIndex('dining_tables_active_label_idx').on(t.branchId, sql`lower(${t.label})`).where(sql`${t.status} = 'active'`),
  index('dining_tables_branch_idx').on(t.branchId),
  check('dining_tables_seats_check', sql`${t.seats} between 1 and 20`),
  // The target of a placement's foreign key: a table placed in its own cafe and branch only (D273).
  uniqueIndex('dining_tables_branch_id_idx').on(t.tenantId, t.branchId, t.id),
])

/**
 * A branch's shop layout (D273, docs/plans/shop-designer.md): one row per branch that has saved
 * one, holding the lock for the whole layout (D41): every save names `version`, so two owners
 * editing at once can't overwrite each other unseen. No row: an empty layout at version 0.
 */
export const branchLayouts = sqliteTable('branch_layouts', {
  tenantId: tenantId(),
  branchId: text().notNull(),
  version: integer().notNull().default(1),
  updatedAt: instant().notNull().default(nowMs),
  updatedBy: text().references(() => authSchema!.user.id, { onDelete: 'set null' }),
}, t => [
  primaryKey({ columns: [t.tenantId, t.branchId] }),
  foreignKey({ name: 'branch_layouts_branch_fk', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('restrict'),
])

/**
 * A floor of the layout, bottom first (`position` 0 is the ground floor). Its drawing (outline,
 * edges with doors and windows, inside walls, furniture) is one JSON value, checked by the shared
 * `floorSchema` and at most `LAYOUT_MAX_FLOOR_BYTES`. Its id is the editor's, unique in its layout
 * only, so the key names the branch. Replaced whole on every save.
 */
export const branchLayoutFloors = sqliteTable('branch_layout_floors', {
  tenantId: tenantId(),
  branchId: text().notNull(),
  id: text().notNull(),
  position: integer().notNull(),
  name: text().notNull(),
  heightCm: integer().notNull(),
  hasRoof: integer({ mode: 'boolean' }).notNull(),
  geometry: text({ mode: 'json' }).$type<FloorGeometry>().notNull(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.branchId, t.id] }),
  foreignKey({ name: 'branch_layout_floors_layout_fk', columns: [t.tenantId, t.branchId], foreignColumns: [branchLayouts.tenantId, branchLayouts.branchId] }).onDelete('cascade'),
  uniqueIndex('branch_layout_floors_position_idx').on(t.tenantId, t.branchId, t.position),
  check('branch_layout_floors_check', sql`${t.position} between 0 and 9 and ${t.heightCm} between 200 and 800`),
])

/**
 * Where a real dining table stands (D273). The table's label, seats and QR stay on
 * `dining_tables`; moving it here never changes its QR. A table is placed at most once (the key),
 * only in its own cafe and branch (the composite foreign key), and leaves the plan when it is
 * deleted, its floor is removed (cascade) or it is archived (the archive's batch).
 */
export const branchLayoutPlacements = sqliteTable('branch_layout_placements', {
  tableId: text().primaryKey(),
  tenantId: tenantId(),
  branchId: text().notNull(),
  floorId: text().notNull(),
  xCm: integer().notNull(),
  yCm: integer().notNull(),
  rotation: integer().notNull(),
  widthCm: integer().notNull(),
  depthCm: integer().notNull(),
  /** A built-in look's key, checked by the shared contract; custom looks come in step 3a. */
  look: text({ enum: BUILT_IN_LOOK_IDS }).notNull(),
}, t => [
  foreignKey({ name: 'branch_layout_placements_table_fk', columns: [t.tenantId, t.branchId, t.tableId], foreignColumns: [diningTables.tenantId, diningTables.branchId, diningTables.id] }).onDelete('cascade'),
  foreignKey({ name: 'branch_layout_placements_floor_fk', columns: [t.tenantId, t.branchId, t.floorId], foreignColumns: [branchLayoutFloors.tenantId, branchLayoutFloors.branchId, branchLayoutFloors.id] }).onDelete('cascade'),
  index('branch_layout_placements_floor_idx').on(t.tenantId, t.branchId, t.floorId),
  check('branch_layout_placements_check', sql`${t.rotation} between 0 and 359 and ${t.widthCm} between 40 and 600 and ${t.depthCm} between 40 and 600`),
])
