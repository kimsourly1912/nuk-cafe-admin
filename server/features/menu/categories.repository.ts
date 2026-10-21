import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { CategoryStatus } from '#shared/contracts/menu-categories'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks, requireCount, updateAtVersion } from '#server/utils/batch'
import { byId, firstRow, inTenant, nextPosition, withStatus } from '#server/utils/query'
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

export const activeCategory = eq(menuCategories.status, 'active')

/** The top level for `null`, else the parent's children. */
const underParent = (parentId: string | null): SQL => parentId === null ? isNull(menuCategories.parentId) : eq(menuCategories.parentId, parentId)

/** The cafe's sub-categories of `parentId` (active or archived). */
export const childrenOf = (tenantId: string, parentId: string): SQL => inTenant(menuCategories, tenantId, eq(menuCategories.parentId, parentId))

/** The cafe's active categories under one parent (the top level for `null`). */
const activeSiblingsOf = (tenantId: string, parentId: string | null): SQL => inTenant(menuCategories, tenantId, underParent(parentId), activeCategory)

// --- Reads ---

export function findCategory(db: Db, tenantId: string, id: string): Promise<CategoryRow | undefined> {
  return firstRow(db.select(columns).from(menuCategories).where(byId(menuCategories, tenantId, id)))
}

export function findCategoriesByIds(db: Db, tenantId: string, ids: string[]): Promise<CategoryRow[]> {
  return readInChunks(ids, piece => db.select(columns).from(menuCategories).where(inTenant(menuCategories, tenantId, inArray(menuCategories.id, piece))))
}

/** Every category with the given status (or all), ordered by position, then name. */
export function listCategories(db: Db, tenantId: string, status: CategoryStatus | 'all'): Promise<CategoryRow[]> {
  return db
    .select(columns)
    .from(menuCategories)
    .where(inTenant(menuCategories, tenantId, withStatus(menuCategories.status, status)))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name), asc(menuCategories.id))
}

/** Active children per parent id. */
export async function activeChildCounts(db: Db, tenantId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ parentId: menuCategories.parentId, n: count() })
    .from(menuCategories)
    .where(inTenant(menuCategories, tenantId, isNotNull(menuCategories.parentId), activeCategory))
    .groupBy(menuCategories.parentId)
  return new Map(rows.map(r => [r.parentId!, r.n]))
}

/** The category's sub-categories, of one status or all. */
export function countChildren(db: Db, tenantId: string, id: string, status?: CategoryStatus): Promise<number> {
  return db.$count(menuCategories, and(childrenOf(tenantId, id), withStatus(menuCategories.status, status)))
}

/** The active children of one parent (the top level for `null`), in order. */
export function activeSiblings(db: Db, tenantId: string, parentId: string | null): Promise<{ id: string, version: number }[]> {
  return db
    .select({ id: menuCategories.id, version: menuCategories.version })
    .from(menuCategories)
    .where(activeSiblingsOf(tenantId, parentId))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name), asc(menuCategories.id))
}

/** The next position under a parent: after every active sibling. */
export function nextSortOrder(db: Db, tenantId: string, parentId: string | null): Promise<number> {
  return nextPosition(db, menuCategories, menuCategories.sortOrder, activeSiblingsOf(tenantId, parentId))
}

// --- Guards (checked again inside the batch: things may change between the read and the write) ---

/** Aborts unless `parentId` is still an active top-level category. */
export function requireActiveTopLevel(db: Db, tenantId: string, parentId: string): Statement {
  return requireCount(db, db.$count(menuCategories, and(byId(menuCategories, tenantId, parentId), underParent(null), activeCategory)), 1)
}

/** Aborts unless the category still has no children (active or archived): it's about to become one. */
export function requireNoChildren(db: Db, tenantId: string, id: string): Statement {
  return requireCount(db, db.$count(menuCategories, childrenOf(tenantId, id)), 0)
}

/** Aborts unless the parent has exactly `n` active children (a reorder must name all of them). */
export function requireActiveSiblingCount(db: Db, tenantId: string, parentId: string | null, n: number): Statement {
  return requireCount(db, db.$count(menuCategories, activeSiblingsOf(tenantId, parentId)), n)
}

// --- Writes: statements for the service's batch ---

export function insertCategoryStatement(db: Db, row: { id: string, tenantId: string, parentId: string | null, name: string, description: string, sortOrder: number, now: Date }): Statement {
  return db.insert(menuCategories).values({
    id: row.id,
    tenantId: row.tenantId,
    parentId: row.parentId,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    createdAt: row.now,
    updatedAt: row.now,
  })
}

/** Changes one category if it's still at `version`; follow it with `requireOneChange`. */
export function updateCategoryStatement(db: Db, tenantId: string, id: string, version: number, changes: Partial<Pick<CategoryRow, 'parentId' | 'name' | 'description' | 'sortOrder' | 'status'>>, now: Date): Statement {
  return updateAtVersion(db, menuCategories, { tenantId, id, version }, { ...changes, updatedAt: now })
}

/** Archives the active children of a parent (archiving a parent archives its sub-categories). */
export function archiveChildrenStatement(db: Db, tenantId: string, parentId: string, now: Date): Statement {
  return setChildrenStatus(db, tenantId, parentId, 'active', 'archived', now)
}

/** Restores a parent's archived children (they keep their positions among themselves). */
export function restoreChildrenStatement(db: Db, tenantId: string, parentId: string, now: Date): Statement {
  return setChildrenStatus(db, tenantId, parentId, 'archived', 'active', now)
}

function setChildrenStatus(db: Db, tenantId: string, parentId: string, from: CategoryStatus, to: CategoryStatus, now: Date): Statement {
  return db.update(menuCategories)
    .set({ status: to, version: sql`${menuCategories.version} + 1`, updatedAt: now })
    .where(and(childrenOf(tenantId, parentId), eq(menuCategories.status, from)))
}

/** Moves one sibling to `sortOrder` if it's still active under `parentId` at `version`. Follow it with `requireOneChange`. */
export function positionStatement(db: Db, tenantId: string, parentId: string | null, id: string, version: number, sortOrder: number, now: Date): Statement {
  return updateAtVersion(db, menuCategories, { tenantId, id, version }, { sortOrder, updatedAt: now }, and(underParent(parentId), activeCategory))
}
