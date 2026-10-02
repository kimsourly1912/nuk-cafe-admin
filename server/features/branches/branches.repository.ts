import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { DiningTableStatus } from '#shared/contracts/branches'
import type { WeeklyWindow } from '#shared/contracts/common'
import type { Db, Statement } from '#server/utils/batch'
import { insertPieces } from '#server/utils/batch'
import { branches, branchHours, diningTables } from './branches.schema'

/**
 * A tenant's branches (D44, D134): the seed task creates them, the admin edits their settings, hours
 * and dining tables (step 5.1, D91). Every read names the tenant; a branch of another tenant is
 * "not found".
 */

export async function hasAnyBranch(db: Db, tenantId: string): Promise<boolean> {
  const rows = await db.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1)
  return rows.length > 0
}

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

export interface BranchRow {
  id: string
  name: string
  timezone: string
  address: string | null
  phone: string | null
  status: string | null
  version: number | null
}

const branchColumns = {
  id: branches.id,
  name: branches.name,
  timezone: branches.timezone,
  address: branches.address,
  phone: branches.phone,
  status: branches.status,
  version: branches.version,
}

export async function findBranch(db: Db, tenantId: string, id: string): Promise<BranchRow | undefined> {
  const rows: BranchRow[] = await db.select(branchColumns).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.id, id))).limit(1)
  return rows[0]
}

export interface BranchOptionRow {
  id: string
  name: string
}

/** Active branches by name, for pickers. */
export async function listActiveBranches(db: Db, tenantId: string): Promise<BranchOptionRow[]> {
  return db.select({ id: branches.id, name: branches.name }).from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.status, 'active')))
    .orderBy(asc(branches.name))
}

/** The branch's opening windows, by weekday, then start. */
export async function hoursOf(db: Db, branchId: string): Promise<WeeklyWindow[]> {
  return db.select({ weekday: branchHours.weekday, startMinute: branchHours.startMinute, endMinute: branchHours.endMinute })
    .from(branchHours).where(eq(branchHours.branchId, branchId))
    .orderBy(asc(branchHours.weekday), asc(branchHours.startMinute))
}

/**
 * Moves the branch to the next version if it's still at `version` and active, applying `changes`.
 * Follow it with `requireOneChange`.
 */
export function touchBranchStatement(db: Db, tenantId: string, id: string, version: number, changes: Partial<Pick<BranchRow, 'name' | 'timezone' | 'address' | 'phone'>>): Statement {
  return db.update(branches)
    .set({ ...changes, version: sql`${branches.version} + 1` })
    .where(and(eq(branches.tenantId, tenantId), eq(branches.id, id), eq(branches.version, version), eq(branches.status, 'active')))
}

export function replaceHoursStatements(db: Db, tenantId: string, branchId: string, windows: WeeklyWindow[]): Statement[] {
  return [
    db.delete(branchHours).where(and(eq(branchHours.tenantId, tenantId), eq(branchHours.branchId, branchId))),
    ...insertPieces(branchHours, windows).map(piece => db.insert(branchHours).values(piece.map(window => ({ tenantId, branchId, ...window })))),
  ]
}

// --- Dining tables ---

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

/** A branch's tables; the service sorts them by label (natural order). */
export async function listTables(db: Db, branchId: string, status: DiningTableStatus | 'all'): Promise<TableRow[]> {
  return db.select(tableColumns).from(diningTables)
    .where(and(eq(diningTables.branchId, branchId), status === 'all' ? undefined : eq(diningTables.status, status)))
}

export async function findTable(db: Db, branchId: string, tableId: string): Promise<TableRow | undefined> {
  const rows: TableRow[] = await db.select(tableColumns).from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.branchId, branchId))).limit(1)
  return rows[0]
}

export async function countTables(db: Db, branchId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(diningTables).where(eq(diningTables.branchId, branchId))
  return row?.n ?? 0
}

export function insertTableStatement(db: Db, row: { id: string, tenantId: string, branchId: string, label: string, area: string | null, qrTokenHash: string, now: Date }): Statement {
  return db.insert(diningTables).values({ ...row, qrVersion: 1, qrRotatedAt: row.now, createdAt: row.now, updatedAt: row.now })
}

type TableChanges = Partial<Pick<TableRow, 'label' | 'area' | 'status' | 'qrVersion' | 'qrRotatedAt'>> & { qrTokenHash?: string }

/**
 * Moves the table to the next version if it's still at `version` (and still active, unless
 * `anyStatus`), applying `changes`. Follow it with `requireOneChange`.
 */
export function touchTableStatement(db: Db, id: string, version: number, now: Date, changes: TableChanges, anyStatus = false): Statement {
  return db.update(diningTables)
    .set({ ...changes, version: sql`${diningTables.version} + 1`, updatedAt: now })
    .where(and(eq(diningTables.id, id), eq(diningTables.version, version), anyStatus ? undefined : eq(diningTables.status, 'active')))
}

export interface ScannedTableRow {
  tableId: string
  label: string
  tableStatus: DiningTableStatus
  tenantId: string
  branchId: string
  branchName: string
  branchStatus: string | null
}

/** The table whose QR token hashes to `hash`, with its branch and tenant (a QR names both, D134). */
export async function findTableByTokenHash(db: Db, hash: string): Promise<ScannedTableRow | undefined> {
  const rows: ScannedTableRow[] = await db.select({
    tableId: diningTables.id,
    label: diningTables.label,
    tableStatus: diningTables.status,
    tenantId: branches.tenantId,
    branchId: branches.id,
    branchName: branches.name,
    branchStatus: branches.status,
  }).from(diningTables)
    .innerJoin(branches, eq(branches.id, diningTables.branchId))
    .where(eq(diningTables.qrTokenHash, hash))
    .limit(1)
  return rows[0]
}
