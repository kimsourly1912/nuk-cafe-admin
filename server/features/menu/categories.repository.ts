import { and, asc, count, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { CategoryStatus } from '#shared/contracts/menu-categories'
import type { Db, Statement } from '../../utils/batch'
import { requireCount } from '../../utils/batch'
import { menuCategories } from './menu.schema'

export interface CategoryRow {
  id: string
  parentId: string | null
  name: string
  description: string
  sortOrder: number
  status: CategoryStatus
  version: number
  createdAt: Date
  updatedAt: Date
}

const columns = {
  id: menuCategories.id,
  parentId: menuCategories.parentId,
  name: menuCategories.name,
  description: menuCategories.description,
  sortOrder: menuCategories.sortOrder,
  status: menuCategories.status,
  version: menuCategories.version,
  createdAt: menuCategories.createdAt,
  updatedAt: menuCategories.updatedAt,
}

const parentIs = (parentId: string | null) => parentId === null ? isNull(menuCategories.parentId) : eq(menuCategories.parentId, parentId)

export async function findCategory(db: Db, id: string): Promise<CategoryRow | undefined> {
  const rows: CategoryRow[] = await db.select(columns).from(menuCategories).where(eq(menuCategories.id, id)).limit(1)
  return rows[0]
}

/** Every category with the given status (or all), ordered by position, then name. */
export async function listCategories(db: Db, status: CategoryStatus | 'all'): Promise<CategoryRow[]> {
  const query = db.select(columns).from(menuCategories)
  return (status === 'all' ? query : query.where(eq(menuCategories.status, status)))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name))
}

/** Active children per parent id. */
export async function activeChildCounts(db: Db): Promise<Map<string, number>> {
  const rows: { parentId: string | null, n: number }[] = await db
    .select({ parentId: menuCategories.parentId, n: count() })
    .from(menuCategories)
    .where(and(sql`${menuCategories.parentId} is not null`, eq(menuCategories.status, 'active')))
    .groupBy(menuCategories.parentId)
  return new Map(rows.map(r => [r.parentId!, r.n]))
}

export async function countChildren(db: Db, id: string, status?: CategoryStatus): Promise<number> {
  const rows: { n: number }[] = await db.select({ n: count() }).from(menuCategories)
    .where(and(eq(menuCategories.parentId, id), status ? eq(menuCategories.status, status) : undefined))
  return rows[0]?.n ?? 0
}

/** The active children of one parent (the top level for `null`), in order. */
export async function activeSiblings(db: Db, parentId: string | null): Promise<{ id: string, version: number }[]> {
  return db.select({ id: menuCategories.id, version: menuCategories.version }).from(menuCategories)
    .where(and(parentIs(parentId), eq(menuCategories.status, 'active')))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name))
}

/** The next position under a parent: after every active sibling. */
export async function nextSortOrder(db: Db, parentId: string | null): Promise<number> {
  const rows: { top: number | null }[] = await db.select({ top: max(menuCategories.sortOrder) }).from(menuCategories)
    .where(and(parentIs(parentId), eq(menuCategories.status, 'active')))
  return (rows[0]?.top ?? 0) + 1
}

// --- Guards (checked again inside the batch: things may change between the read and the write) ---

/** Aborts unless `parentId` is still an active top-level category. */
export function requireActiveTopLevel(db: Db, parentId: string): Statement {
  return requireCount(db, sql`select count(*) from ${menuCategories} where ${menuCategories.id} = ${parentId} and ${menuCategories.parentId} is null and ${menuCategories.status} = 'active'`, 1)
}

/** Aborts unless the category still has no children (active or archived): it's about to become one. */
export function requireNoChildren(db: Db, id: string): Statement {
  return requireCount(db, sql`select count(*) from ${menuCategories} where ${menuCategories.parentId} = ${id}`, 0)
}

/** Aborts unless the parent has exactly `n` active children (a reorder must name all of them). */
export function requireActiveSiblingCount(db: Db, parentId: string | null, n: number): Statement {
  const parent: SQL = parentId === null ? sql`${menuCategories.parentId} is null` : sql`${menuCategories.parentId} = ${parentId}`
  return requireCount(db, sql`select count(*) from ${menuCategories} where ${parent} and ${menuCategories.status} = 'active'`, n)
}

// --- Writes: statements for the service's batch ---

export function insertCategoryStatement(db: Db, row: { id: string, parentId: string | null, name: string, description: string, sortOrder: number, now: Date }): Statement {
  return db.insert(menuCategories).values({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    createdAt: row.now,
    updatedAt: row.now,
  })
}

/** Changes one category if it's still at `version`; follow it with `requireOneChange`. */
export function updateCategoryStatement(db: Db, id: string, version: number, changes: Partial<Pick<CategoryRow, 'parentId' | 'name' | 'description' | 'sortOrder' | 'status'>>, now: Date): Statement {
  return db.update(menuCategories)
    .set({ ...changes, version: sql`${menuCategories.version} + 1`, updatedAt: now })
    .where(and(eq(menuCategories.id, id), eq(menuCategories.version, version)))
}

/** Archives the active children of a parent (archiving a parent archives its sub-categories). */
export function archiveChildrenStatement(db: Db, parentId: string, now: Date): Statement {
  return db.update(menuCategories)
    .set({ status: 'archived', version: sql`${menuCategories.version} + 1`, updatedAt: now })
    .where(and(eq(menuCategories.parentId, parentId), eq(menuCategories.status, 'active')))
}

/** Moves one sibling to `sortOrder` if it's still active under `parentId` at `version`. */
export function positionStatement(db: Db, parentId: string | null, id: string, version: number, sortOrder: number, now: Date): Statement {
  return db.update(menuCategories)
    .set({ sortOrder, version: sql`${menuCategories.version} + 1`, updatedAt: now })
    .where(and(eq(menuCategories.id, id), eq(menuCategories.version, version), parentIs(parentId), eq(menuCategories.status, 'active')))
}

export async function findCategoriesByIds(db: Db, ids: string[]): Promise<CategoryRow[]> {
  if (!ids.length) return []
  return db.select(columns).from(menuCategories).where(inArray(menuCategories.id, ids))
}
