import { and, asc, eq, sql, sum } from 'drizzle-orm'
import type { Finish, ItemLookKind } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, byName, firstRow, inTenant } from '#server/utils/query'
import { branches, branchLayoutFloors, branchLayoutItemLooks, customItemLooks } from './branches.schema'

// --- Row types ---

export interface ItemLookRow {
  id: string
  name: string
  kind: ItemLookKind
  finishes: Record<string, Finish>
  defaultWidthCm: number
  defaultDepthCm: number
  /** The photo's upload (a `media_assets` id), or `null`. */
  photoAssetId: string | null
  version: number
}

/** What a look is made of: everything the owner sets. The kind is set once, on create. */
export type ItemLookValues = Omit<ItemLookRow, 'id' | 'version'>

/** Where a look is used: a floor of a branch, and how many of its pieces. */
export interface ItemLookPlace {
  floor: string
  branch: string
  pieces: number
}

// --- Column lists ---

const lookColumns = {
  id: customItemLooks.id,
  name: customItemLooks.name,
  kind: customItemLooks.kind,
  finishes: customItemLooks.finishes,
  defaultWidthCm: customItemLooks.defaultWidthCm,
  defaultDepthCm: customItemLooks.defaultDepthCm,
  photoAssetId: customItemLooks.photoAssetId,
  version: customItemLooks.version,
}

/** `sum()` of the pieces as a number (SQLite answers an integer; drizzle types it as text). */
const pieceTotal = sql<number>`coalesce(${sum(branchLayoutItemLooks.pieces)}, 0)`.mapWith(Number)

// --- Reads ---

/**
 * The cafe's chair and fixture looks by name, and how many placed pieces use each, in one batch
 * (one snapshot). At most MAX_CUSTOM_ITEM_LOOKS looks; uses branch_layout_item_looks_look_idx.
 */
export async function itemLooksWithUse(db: Db, tenantId: string): Promise<{ looks: ItemLookRow[], use: Map<string, number> }> {
  const [looks, use] = await db.batch([
    db.select(lookColumns).from(customItemLooks)
      .where(inTenant(customItemLooks, tenantId))
      .orderBy(byName(customItemLooks.name), asc(customItemLooks.id)),
    db.select({ lookId: branchLayoutItemLooks.lookId, pieces: pieceTotal }).from(branchLayoutItemLooks)
      .where(inTenant(branchLayoutItemLooks, tenantId))
      .groupBy(branchLayoutItemLooks.lookId),
  ])
  return { looks, use: new Map(use.map(row => [row.lookId, row.pieces])) }
}

export function findItemLook(db: Db, tenantId: string, id: string): Promise<ItemLookRow | undefined> {
  return firstRow(db.select(lookColumns).from(customItemLooks).where(byId(customItemLooks, tenantId, id)))
}

export async function countItemLooks(db: Db, tenantId: string): Promise<number> {
  return db.$count(customItemLooks, inTenant(customItemLooks, tenantId))
}

/**
 * How many placed pieces use the look, and the first `limit` floors that hold them, by branch
 * and floor name.
 */
export async function itemLookUse(db: Db, tenantId: string, lookId: string, limit: number): Promise<{ total: number, places: ItemLookPlace[] }> {
  const ofLook = inTenant(branchLayoutItemLooks, tenantId, eq(branchLayoutItemLooks.lookId, lookId))
  const [totals, places] = await db.batch([
    db.select({ n: pieceTotal }).from(branchLayoutItemLooks).where(ofLook),
    db.select({ floor: branchLayoutFloors.name, branch: branches.name, pieces: branchLayoutItemLooks.pieces }).from(branchLayoutItemLooks)
      .innerJoin(branchLayoutFloors, and(eq(branchLayoutFloors.tenantId, branchLayoutItemLooks.tenantId), eq(branchLayoutFloors.branchId, branchLayoutItemLooks.branchId), eq(branchLayoutFloors.id, branchLayoutItemLooks.floorId)))
      .innerJoin(branches, eq(branches.id, branchLayoutItemLooks.branchId))
      .where(ofLook)
      .orderBy(byName(branches.name), asc(branchLayoutFloors.position))
      .limit(limit),
  ])
  return { total: totals[0]?.n ?? 0, places }
}

// --- Guards ---

/** The scalar count of the cafe's item looks, for `requireAtMost`. */
export const itemLookCount = (db: Db, tenantId: string) => db.$count(customItemLooks, inTenant(customItemLooks, tenantId))

// --- Write statements ---

/** Fails on the name's unique index when the cafe has an item look of that name (in any capitals). */
export function insertItemLookStatement(db: Db, tenantId: string, id: string, values: ItemLookValues, now: Date): Statement {
  return db.insert(customItemLooks).values({ id, tenantId, ...values, version: 1, createdAt: now, updatedAt: now })
}

/** Replaces the look's values (never its kind) if it's still at `version`. Follow it with `requireOneChange`. */
export function updateItemLookStatement(db: Db, tenantId: string, id: string, version: number, values: Omit<ItemLookValues, 'kind'>, now: Date): Statement {
  return updateAtVersion(db, customItemLooks, { tenantId, id, version }, { ...values, updatedAt: now })
}

/**
 * Deletes the look if it's still at `version`; the uses' foreign key refuses it while a saved
 * floor's furniture uses it. Follow it with `requireOneChange`.
 */
export function deleteItemLookStatement(db: Db, tenantId: string, id: string, version: number): Statement {
  return db.delete(customItemLooks).where(atVersion(customItemLooks, tenantId, id, version))
}
