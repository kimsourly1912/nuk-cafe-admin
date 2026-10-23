import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { DiningTableStatus } from '#shared/contracts/branches'
import type { WeeklyWindow } from '#shared/contracts/common'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks, replaceAll, requireAtMost, updateAtVersion } from '#server/utils/batch'
import { byId, firstRow, hasAny, inTenant, withStatus } from '#server/utils/query'
import { organization, user } from '#server/db/tables'
import { branches, branchHours, diningTables } from './branches.schema'

// --- Row types ---

export interface BranchRow {
  id: string
  name: string
  timezone: string
  address: string | null
  phone: string | null
  status: string | null
  version: number | null
  /** Online orders paused until then (D199); past or `null`: not paused. */
  pausedUntil: Date | null
}

export interface PauseRow {
  pausedUntil: Date | null
  reason: string | null
  pausedByName: string | null
}

export interface BranchOptionRow {
  id: string
  name: string
  timezone: string
}

export interface TableRow {
  id: string
  branchId: string
  label: string
  area: string | null
  status: DiningTableStatus
  qrVersion: number
  qrRotatedAt: Date
  version: number
  createdAt: Date
  updatedAt: Date
}

type TableChanges = Partial<Pick<TableRow, 'label' | 'area' | 'status' | 'qrVersion' | 'qrRotatedAt'>> & { qrTokenHash?: string }

export interface ScannedTableRow {
  tableId: string
  label: string
  tableStatus: DiningTableStatus
  tenantId: string
  tenantSlug: string
  tenantName: string
  tenantStatus: string | null
  branchId: string
  branchName: string
  branchStatus: string | null
}

// --- Column lists and conditions ---

export const activeBranch = eq(branches.status, 'active')

const branchColumns = {
  id: branches.id,
  name: branches.name,
  timezone: branches.timezone,
  address: branches.address,
  phone: branches.phone,
  status: branches.status,
  version: branches.version,
  pausedUntil: branches.pausedUntil,
}

const tableColumns = {
  id: diningTables.id,
  branchId: diningTables.branchId,
  label: diningTables.label,
  area: diningTables.area,
  status: diningTables.status,
  qrVersion: diningTables.qrVersion,
  qrRotatedAt: diningTables.qrRotatedAt,
  version: diningTables.version,
  createdAt: diningTables.createdAt,
  updatedAt: diningTables.updatedAt,
}

// --- Reads ---

export async function hasAnyBranch(db: Db, tenantId: string): Promise<boolean> {
  return hasAny(db, branches, inTenant(branches, tenantId))
}

export async function findBranch(db: Db, tenantId: string, id: string): Promise<BranchRow | undefined> {
  return firstRow(db.select(branchColumns).from(branches).where(byId(branches, tenantId, id)))
}

/** The branch's pause with who set it (`user.name`, readable by every feature). */
export async function findPause(db: Db, tenantId: string, id: string): Promise<PauseRow | undefined> {
  return firstRow(db.select({ pausedUntil: branches.pausedUntil, reason: branches.pauseReason, pausedByName: user.name })
    .from(branches).leftJoin(user, eq(user.id, branches.pausedBy))
    .where(byId(branches, tenantId, id)))
}

/** Active branches by name, with their clocks. Uses branches_tenant_id_unique. */
export async function listActiveBranches(db: Db, tenantId: string): Promise<BranchOptionRow[]> {
  return db.select({ id: branches.id, name: branches.name, timezone: branches.timezone }).from(branches)
    .where(inTenant(branches, tenantId, activeBranch))
    .orderBy(asc(branches.name), asc(branches.id))
}

/** The branch's opening windows, by weekday, then start. Uses branch_hours' primary key. */
export async function hoursOf(db: Db, tenantId: string, branchId: string): Promise<WeeklyWindow[]> {
  return db.select({ weekday: branchHours.weekday, startMinute: branchHours.startMinute, endMinute: branchHours.endMinute })
    .from(branchHours).where(inTenant(branchHours, tenantId, eq(branchHours.branchId, branchId)))
    .orderBy(asc(branchHours.weekday), asc(branchHours.startMinute))
}

/** A branch's tables; the service sorts labels in natural order. Uses dining_tables_branch_idx. */
export async function listTables(db: Db, tenantId: string, branchId: string, status: DiningTableStatus | 'all'): Promise<TableRow[]> {
  return db.select(tableColumns).from(diningTables)
    .where(inTenant(diningTables, tenantId, eq(diningTables.branchId, branchId), withStatus(diningTables.status, status)))
}

export async function findTable(db: Db, tenantId: string, branchId: string, tableId: string): Promise<TableRow | undefined> {
  return firstRow(db.select(tableColumns).from(diningTables)
    .where(inTenant(diningTables, tenantId, eq(diningTables.id, tableId), eq(diningTables.branchId, branchId))))
}

export async function countTables(db: Db, tenantId: string, branchId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(diningTables).where(inTenant(diningTables, tenantId, eq(diningTables.branchId, branchId)))
  return row?.n ?? 0
}

/** Across cafes: the table whose QR token hashes to `hash`, with its branch and tenant (a QR names both, D134). */
export async function findTableByTokenHash(db: Db, hash: string): Promise<ScannedTableRow | undefined> {
  return firstRow(db.select({
    tableId: diningTables.id,
    label: diningTables.label,
    tableStatus: diningTables.status,
    tenantId: branches.tenantId,
    tenantSlug: organization.slug,
    tenantName: organization.name,
    tenantStatus: organization.status,
    branchId: branches.id,
    branchName: branches.name,
    branchStatus: branches.status,
  }).from(diningTables)
    .innerJoin(branches, and(eq(branches.tenantId, diningTables.tenantId), eq(branches.id, diningTables.branchId)))
    .innerJoin(organization, eq(organization.id, branches.tenantId))
    .where(eq(diningTables.qrTokenHash, hash)),
  )
}

/** Across cafes: active branches per tenant, for the platform console's usage numbers (D142). */
export async function activeBranchCounts(db: Db, tenantIds: string[]): Promise<{ tenantId: string, total: number }[]> {
  return readInChunks(tenantIds, ids => db.select({ tenantId: branches.tenantId, total: count() }).from(branches)
    .where(and(inArray(branches.tenantId, ids), activeBranch))
    .groupBy(branches.tenantId))
}

// --- Write statements ---

export function insertBranchStatement(db: Db, row: { id: string, tenantId: string, name: string, timezone: string, now: Date }): Statement {
  return db.insert(branches).values({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    timezone: row.timezone,
    currency: 'USD',
    status: 'active',
    createdAt: row.now,
  })
}

/**
 * Sets or clears the active branch's pause (D199). Not versioned: the last pause wins, like sold
 * out; the branch's `version` (its settings) stays. Follow it with `requireOneChange`.
 */
export function setPauseStatement(db: Db, tenantId: string, id: string, pause: { until: Date, by: string, reason: string | null } | null): Statement {
  return db.update(branches)
    .set({ pausedUntil: pause?.until ?? null, pausedBy: pause?.by ?? null, pauseReason: pause?.reason ?? null })
    .where(inTenant(branches, tenantId, eq(branches.id, id), activeBranch))
}

/** A guard for the batch that adds a branch: aborts it when the tenant would have more than `max` active branches. */
export function activeBranchesAtMost(db: Db, tenantId: string, max: number): Statement {
  return requireAtMost(db, db.$count(branches, inTenant(branches, tenantId, activeBranch)), max)
}

/**
 * Moves the branch to the next version if it's still at `version` and active, applying `changes`.
 * Follow it with `requireOneChange`.
 */
export function touchBranchStatement(db: Db, tenantId: string, id: string, version: number, changes: Partial<Pick<BranchRow, 'name' | 'timezone' | 'address' | 'phone'>>): Statement {
  return updateAtVersion(db, branches, { tenantId, id, version }, changes, activeBranch)
}

export function replaceHoursStatements(db: Db, tenantId: string, branchId: string, windows: WeeklyWindow[]): Statement[] {
  return replaceAll(db, branchHours, inTenant(branchHours, tenantId, eq(branchHours.branchId, branchId)), windows.map(window => ({ tenantId, branchId, ...window })))
}

export function insertTableStatement(db: Db, row: { id: string, tenantId: string, branchId: string, label: string, area: string | null, qrTokenHash: string, now: Date }): Statement {
  return db.insert(diningTables).values({ ...row, qrVersion: 1, qrRotatedAt: row.now, createdAt: row.now, updatedAt: row.now })
}

/**
 * Moves the table to the next version if it's still at `version` (and still active, unless
 * `anyStatus`), applying `changes`. Follow it with `requireOneChange`.
 */
export function touchTableStatement(db: Db, tenantId: string, id: string, version: number, changes: TableChanges, now: Date, anyStatus = false): Statement {
  return updateAtVersion(db, diningTables, { tenantId, id, version }, { ...changes, updatedAt: now }, anyStatus ? undefined : eq(diningTables.status, 'active'))
}
