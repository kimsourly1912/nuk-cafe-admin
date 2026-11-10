import { asc, count, eq, isNotNull } from 'drizzle-orm'
import type { LookChair, LookFinishes, TableBase, TableShape } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { updateAtVersion } from '#server/utils/batch'
import { atVersion, byId, byName, firstRow, inTenant } from '#server/utils/query'
import { branches, branchLayoutPlacements, customFurnitureLooks, diningTables } from './branches.schema'

// --- Row types ---

export interface LookRow {
  id: string
  name: string
  shape: TableShape
  base: TableBase
  chair: LookChair
  finishes: LookFinishes
  defaultWidthCm: number
  defaultDepthCm: number
  version: number
}

/** What a look is made of: everything the owner sets. */
export type LookValues = Omit<LookRow, 'id' | 'version'>

// --- Column lists ---

const lookColumns = {
  id: customFurnitureLooks.id,
  name: customFurnitureLooks.name,
  shape: customFurnitureLooks.shape,
  base: customFurnitureLooks.base,
  chair: customFurnitureLooks.chair,
  finishes: customFurnitureLooks.finishes,
  defaultWidthCm: customFurnitureLooks.defaultWidthCm,
  defaultDepthCm: customFurnitureLooks.defaultDepthCm,
  version: customFurnitureLooks.version,
}

/** The cafe's placements that use a custom look (branch_layout_placements_look_idx). */
const usingALook = (tenantId: string) => inTenant(branchLayoutPlacements, tenantId, isNotNull(branchLayoutPlacements.customLookId))

// --- Reads ---

/**
 * The cafe's custom looks by name, and how many placed tables use each, in one batch (one
 * snapshot). At most MAX_CUSTOM_LOOKS looks.
 */
export async function looksWithUse(db: Db, tenantId: string): Promise<{ looks: LookRow[], use: Map<string, number> }> {
  const [looks, use] = await db.batch([
    db.select(lookColumns).from(customFurnitureLooks)
      .where(inTenant(customFurnitureLooks, tenantId))
      .orderBy(byName(customFurnitureLooks.name), asc(customFurnitureLooks.id)),
    db.select({ lookId: branchLayoutPlacements.customLookId, tables: count() }).from(branchLayoutPlacements)
      .where(usingALook(tenantId))
      .groupBy(branchLayoutPlacements.customLookId),
  ])
  return { looks, use: new Map(use.map(row => [row.lookId!, row.tables])) }
}

export function findLook(db: Db, tenantId: string, id: string): Promise<LookRow | undefined> {
  return firstRow(db.select(lookColumns).from(customFurnitureLooks).where(byId(customFurnitureLooks, tenantId, id)))
}

export async function countLooks(db: Db, tenantId: string): Promise<number> {
  return db.$count(customFurnitureLooks, inTenant(customFurnitureLooks, tenantId))
}

/** How many placed tables use the look, and the first `limit` of them by branch and label. */
export async function lookUse(db: Db, tenantId: string, lookId: string, limit: number): Promise<{ total: number, tables: { label: string, branch: string }[] }> {
  const ofLook = inTenant(branchLayoutPlacements, tenantId, eq(branchLayoutPlacements.customLookId, lookId))
  const [totals, tables] = await db.batch([
    db.select({ n: count() }).from(branchLayoutPlacements).where(ofLook),
    db.select({ label: diningTables.label, branch: branches.name }).from(branchLayoutPlacements)
      .innerJoin(diningTables, eq(diningTables.id, branchLayoutPlacements.tableId))
      .innerJoin(branches, eq(branches.id, branchLayoutPlacements.branchId))
      .where(ofLook)
      .orderBy(byName(branches.name), byName(diningTables.label), asc(diningTables.id))
      .limit(limit),
  ])
  return { total: totals[0]?.n ?? 0, tables }
}

// --- Guards ---

/** The scalar count of the cafe's custom looks, for `requireAtMost`. */
export const lookCount = (db: Db, tenantId: string) => db.$count(customFurnitureLooks, inTenant(customFurnitureLooks, tenantId))

// --- Write statements ---

/** Fails on the name's unique index when the cafe has a look of that name (in any capitals). */
export function insertLookStatement(db: Db, tenantId: string, id: string, values: LookValues, now: Date): Statement {
  return db.insert(customFurnitureLooks).values({ id, tenantId, ...values, version: 1, createdAt: now, updatedAt: now })
}

/** Replaces the look's values if it's still at `version`. Follow it with `requireOneChange`. */
export function updateLookStatement(db: Db, tenantId: string, id: string, version: number, values: LookValues, now: Date): Statement {
  return updateAtVersion(db, customFurnitureLooks, { tenantId, id, version }, { ...values, updatedAt: now })
}

/**
 * Deletes the look if it's still at `version`; the placements' foreign key refuses it while a
 * table uses it. Follow it with `requireOneChange`.
 */
export function deleteLookStatement(db: Db, tenantId: string, id: string, version: number): Statement {
  return db.delete(customFurnitureLooks).where(atVersion(customFurnitureLooks, tenantId, id, version))
}
