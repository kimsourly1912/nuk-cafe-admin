import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { BuiltInLookId, FloorGeometry, ItemLookKind, LayoutTable } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, insertAll, requireCount } from '#server/utils/batch'
import { inTenant } from '#server/utils/query'
import { activeTable } from './branches.repository'
import { branchLayoutFloors, branchLayoutItemLooks, branchLayoutPlacements, branchLayouts, customFurnitureLooks, customItemLooks, diningTables } from './branches.schema'

// --- Row types ---

export interface FloorRow {
  id: string
  position: number
  name: string
  heightCm: number
  hasRoof: boolean
  geometry: FloorGeometry
}

export interface PlacementRow {
  tableId: string
  floorId: string
  xCm: number
  yCm: number
  rotation: number
  widthCm: number
  depthCm: number
  /** A built-in look's key, or `customLookId`: exactly one of the two. */
  look: BuiltInLookId | null
  customLookId: string | null
}

/** A saved floor's pieces of one custom item look (step 3d), written from its drawing. */
export interface ItemLookUseRow {
  floorId: string
  lookId: string
  kind: ItemLookKind
  pieces: number
}

export interface LayoutRows {
  /** `undefined`: the branch has never saved a layout. */
  layout: { version: number, updatedAt: Date } | undefined
  floors: FloorRow[]
  placements: PlacementRow[]
  /** The branch's active tables; the service sorts them by label. */
  tables: LayoutTable[]
  /** The cafe's custom look ids: what a placement may name besides a built-in look. */
  lookIds: string[]
  /** The cafe's chair and fixture looks (step 3d): what a piece of that kind may name. */
  itemLooks: { id: string, kind: ItemLookKind }[]
}

// --- Column lists and conditions ---

const ofBranch = <T extends typeof branchLayouts | typeof branchLayoutFloors | typeof branchLayoutPlacements | typeof branchLayoutItemLooks>(table: T, tenantId: string, branchId: string) =>
  inTenant(table, tenantId, eq(table.branchId, branchId))

const floorColumns = {
  id: branchLayoutFloors.id,
  position: branchLayoutFloors.position,
  name: branchLayoutFloors.name,
  heightCm: branchLayoutFloors.heightCm,
  hasRoof: branchLayoutFloors.hasRoof,
  geometry: branchLayoutFloors.geometry,
}

const placementColumns = {
  tableId: branchLayoutPlacements.tableId,
  floorId: branchLayoutPlacements.floorId,
  xCm: branchLayoutPlacements.xCm,
  yCm: branchLayoutPlacements.yCm,
  rotation: branchLayoutPlacements.rotation,
  widthCm: branchLayoutPlacements.widthCm,
  depthCm: branchLayoutPlacements.depthCm,
  look: branchLayoutPlacements.look,
  customLookId: branchLayoutPlacements.customLookId,
}

// --- Reads ---

/**
 * The branch's layout, its floors bottom first, its placements and its active tables, in one batch
 * (one snapshot), with the cafe's custom look ids and its item looks' ids and kinds. Uses the layout's and floors' keys,
 * branch_layout_placements_floor_idx and dining_tables_branch_idx.
 */
export async function layoutRows(db: Db, tenantId: string, branchId: string): Promise<LayoutRows> {
  const [layouts, floors, placements, tables, looks, itemLooks] = await db.batch([
    db.select({ version: branchLayouts.version, updatedAt: branchLayouts.updatedAt }).from(branchLayouts)
      .where(ofBranch(branchLayouts, tenantId, branchId)).limit(1),
    db.select(floorColumns).from(branchLayoutFloors)
      .where(ofBranch(branchLayoutFloors, tenantId, branchId))
      .orderBy(asc(branchLayoutFloors.position)),
    db.select(placementColumns).from(branchLayoutPlacements)
      .where(ofBranch(branchLayoutPlacements, tenantId, branchId))
      .orderBy(asc(branchLayoutPlacements.tableId)),
    db.select({ id: diningTables.id, label: diningTables.label, seats: diningTables.seats }).from(diningTables)
      .where(inTenant(diningTables, tenantId, eq(diningTables.branchId, branchId), activeTable)),
    db.select({ id: customFurnitureLooks.id }).from(customFurnitureLooks).where(inTenant(customFurnitureLooks, tenantId)),
    db.select({ id: customItemLooks.id, kind: customItemLooks.kind }).from(customItemLooks).where(inTenant(customItemLooks, tenantId)),
  ])
  return { layout: layouts[0], floors, placements, tables, lookIds: looks.map(look => look.id), itemLooks }
}

// --- Guards ---

/**
 * Aborts the batch unless every one of these tables is still an active table of the branch: one
 * guard per piece of `chunk(tableIds)`. At most MAX_BRANCH_TABLES (200) ids.
 */
export function requireActiveTables(db: Db, tenantId: string, branchId: string, tableIds: readonly string[]): Statement[] {
  return chunk(tableIds).map(ids => requireCount(
    db,
    db.$count(diningTables, inTenant(diningTables, tenantId, eq(diningTables.branchId, branchId), activeTable, inArray(diningTables.id, ids))),
    ids.length,
  ))
}

// --- Write statements ---

/** The branch's first layout, at version 1. Fails on the key when one was saved meanwhile. */
export function insertLayoutStatement(db: Db, tenantId: string, branchId: string, by: string | null, now: Date): Statement {
  return db.insert(branchLayouts).values({ tenantId, branchId, version: 1, updatedAt: now, updatedBy: by })
}

/** Moves the layout to the next version if it's still at `version`. Follow it with `requireOneChange`. */
export function touchLayoutStatement(db: Db, tenantId: string, branchId: string, version: number, by: string | null, now: Date): Statement {
  return db.update(branchLayouts)
    .set({ version: sql`${branchLayouts.version} + 1`, updatedAt: now, updatedBy: by })
    .where(inTenant(branchLayouts, tenantId, eq(branchLayouts.branchId, branchId), eq(branchLayouts.version, version)))
}

/**
 * Replaces the branch's floors, placements and item looks' uses: the old ones go (the floors'
 * children first), the new ones come. Each floor is its own insert, so one statement carries at
 * most one floor's drawing (`LAYOUT_MAX_FLOOR_BYTES`), whatever the number of floors. A use names
 * its look and kind: the foreign key refuses another cafe's look or one of another kind.
 */
export function replaceLayoutStatements(db: Db, tenantId: string, branchId: string, floors: FloorRow[], placements: PlacementRow[], itemLooks: ItemLookUseRow[] = []): Statement[] {
  return [
    db.delete(branchLayoutPlacements).where(ofBranch(branchLayoutPlacements, tenantId, branchId)),
    db.delete(branchLayoutItemLooks).where(ofBranch(branchLayoutItemLooks, tenantId, branchId)),
    db.delete(branchLayoutFloors).where(ofBranch(branchLayoutFloors, tenantId, branchId)),
    ...floors.map(floor => db.insert(branchLayoutFloors).values({ tenantId, branchId, ...floor })),
    ...insertAll(db, branchLayoutPlacements, placements.map(placement => ({ tenantId, branchId, ...placement }))),
    ...insertAll(db, branchLayoutItemLooks, itemLooks.map(use => ({ tenantId, branchId, ...use }))),
  ]
}

/** Takes the table off the branch's plan (archiving it); nothing when it isn't placed. */
export function deletePlacementStatement(db: Db, tenantId: string, branchId: string, tableId: string): Statement {
  return db.delete(branchLayoutPlacements)
    .where(inTenant(branchLayoutPlacements, tenantId, eq(branchLayoutPlacements.branchId, branchId), eq(branchLayoutPlacements.tableId, tableId)))
}
