import { and, asc, desc, eq, exists, inArray, max, notInArray, sql } from 'drizzle-orm'
import type { BuiltInLookId, FloorGeometry, ItemLook, ItemLookKind, LayoutPage, LayoutScene, LayoutTable, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { chunk, insertAll, requireCount } from '#server/utils/batch'
import { inTenant } from '#server/utils/query'
import { user } from '#server/db/tables'
import { activeBranch, activeTable, branchHasPin, exploreIsOn } from './branches.repository'
import { branchLayoutFloors, branchLayoutItemLooks, branchLayoutPlacements, branchLayouts, branchLayoutVersions, branches, customFurnitureLooks, customItemLooks, diningTables } from './branches.schema'

// --- Row types ---

export interface FloorRow {
  id: string
  position: number
  name: string
  heightCm: number
  hasRoof: boolean
  geometry: FloorGeometry
  /** Studio's frame (ISS-035, ISS-036, ISS-021): design-only; left out, the columns' defaults. */
  canvasXCm?: number
  canvasYCm?: number
  pageId?: string | null
  hidden?: boolean
  locked?: boolean
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
  /** Studio's 2D view only (ISS-021); left out, not hidden or locked. */
  hidden?: boolean
  locked?: boolean
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
  layout: { version: number, updatedAt: Date, updatedByName: string | null, scene: LayoutScene | null, pages: LayoutPage[] | null } | undefined
  floors: FloorRow[]
  placements: PlacementRow[]
  /** The branch's active tables; the service sorts them by label. */
  tables: LayoutTable[]
  /** The cafe's custom look ids: what a placement may name besides a built-in look. */
  lookIds: string[]
  /** The cafe's chair and fixture looks (step 3d): what a piece of that kind may name. */
  itemLooks: { id: string, kind: ItemLookKind }[]
  /** When the newest history snapshot was taken (ISS-027); null: none yet. */
  lastSnapshotAt: Date | null
}

// --- Column lists and conditions ---

const ofBranch = <T extends typeof branchLayouts | typeof branchLayoutFloors | typeof branchLayoutPlacements | typeof branchLayoutItemLooks | typeof branchLayoutVersions>(table: T, tenantId: string, branchId: string) =>
  inTenant(table, tenantId, eq(table.branchId, branchId))

const floorColumns = {
  id: branchLayoutFloors.id,
  position: branchLayoutFloors.position,
  name: branchLayoutFloors.name,
  heightCm: branchLayoutFloors.heightCm,
  hasRoof: branchLayoutFloors.hasRoof,
  geometry: branchLayoutFloors.geometry,
  canvasXCm: branchLayoutFloors.canvasXCm,
  canvasYCm: branchLayoutFloors.canvasYCm,
  pageId: branchLayoutFloors.pageId,
  hidden: branchLayoutFloors.hidden,
  locked: branchLayoutFloors.locked,
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
  hidden: branchLayoutPlacements.hidden,
  locked: branchLayoutPlacements.locked,
}

// --- Reads ---

/**
 * The branch's layout, its floors bottom first, its placements and its active tables, in one batch
 * (one snapshot), with who saved it last (`user.name`, readable by every feature), the cafe's
 * custom look ids and its item looks' ids and kinds. Uses the layout's and floors' keys,
 * branch_layout_placements_floor_idx and dining_tables_branch_idx.
 */
export async function layoutRows(db: Db, tenantId: string, branchId: string): Promise<LayoutRows> {
  const [layouts, floors, placements, tables, looks, itemLooks, snapshots] = await db.batch([
    db.select({ version: branchLayouts.version, updatedAt: branchLayouts.updatedAt, updatedByName: user.name, scene: branchLayouts.scene, pages: branchLayouts.pages }).from(branchLayouts)
      .leftJoin(user, eq(user.id, branchLayouts.updatedBy))
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
    db.select({ at: max(branchLayoutVersions.savedAt) }).from(branchLayoutVersions).where(ofBranch(branchLayoutVersions, tenantId, branchId)),
  ])
  return { layout: layouts[0], floors, placements, tables, lookIds: looks.map(look => look.id), itemLooks, lastSnapshotAt: snapshots[0]?.at ?? null }
}

interface ExploreRows {
  scene: LayoutScene
  floors: FloorRow[]
  placements: (PlacementRow & { seats: number })[]
  looks: Omit<TableLook, 'name' | 'photo'>[]
  itemLooks: (Omit<ItemLook, 'name' | 'photo' | 'defaultHeight'> & { defaultHeight: number | null })[]
}

/** Publication state and the referenced drawing are read in one snapshot. */
export async function exploreRows(db: Db, tenantId: string, branchId: string): Promise<ExploreRows | undefined> {
  const publication = db.select({ scene: branchLayouts.scene }).from(branchLayouts)
    .innerJoin(branches, and(eq(branches.tenantId, branchLayouts.tenantId), eq(branches.id, branchLayouts.branchId), activeBranch, branchHasPin))
    .where(and(ofBranch(branchLayouts, tenantId, branchId), exploreIsOn)).limit(1)
  const isPublished = exists(publication)
  const [published, floors, placements, looks, itemLooks] = await db.batch([
    publication,
    db.select(floorColumns).from(branchLayoutFloors)
      .where(and(ofBranch(branchLayoutFloors, tenantId, branchId), isPublished)).orderBy(asc(branchLayoutFloors.position)),
    db.select({ ...placementColumns, seats: diningTables.seats }).from(branchLayoutPlacements)
      .innerJoin(diningTables, and(
        eq(diningTables.tenantId, branchLayoutPlacements.tenantId),
        eq(diningTables.branchId, branchLayoutPlacements.branchId),
        eq(diningTables.id, branchLayoutPlacements.tableId),
        activeTable,
      ))
      .where(and(ofBranch(branchLayoutPlacements, tenantId, branchId), isPublished))
      .orderBy(asc(branchLayoutPlacements.floorId), asc(branchLayoutPlacements.xCm), asc(branchLayoutPlacements.yCm), asc(branchLayoutPlacements.tableId)),
    db.select({
      id: customFurnitureLooks.id, shape: customFurnitureLooks.shape,
      base: customFurnitureLooks.base, chair: customFurnitureLooks.chair, finishes: customFurnitureLooks.finishes,
      defaultWidth: customFurnitureLooks.defaultWidthCm, defaultDepth: customFurnitureLooks.defaultDepthCm,
    }).from(customFurnitureLooks).where(inTenant(customFurnitureLooks, tenantId, inArray(customFurnitureLooks.id,
      db.select({ id: branchLayoutPlacements.customLookId }).from(branchLayoutPlacements)
        .where(and(ofBranch(branchLayoutPlacements, tenantId, branchId), isPublished)),
    ))).orderBy(asc(customFurnitureLooks.id)),
    db.select({
      id: customItemLooks.id, kind: customItemLooks.kind, finishes: customItemLooks.finishes,
      defaultWidth: customItemLooks.defaultWidthCm, defaultDepth: customItemLooks.defaultDepthCm,
      defaultHeight: customItemLooks.defaultHeightCm,
    }).from(customItemLooks).where(inTenant(customItemLooks, tenantId, inArray(customItemLooks.id,
      db.select({ id: branchLayoutItemLooks.lookId }).from(branchLayoutItemLooks)
        .where(and(ofBranch(branchLayoutItemLooks, tenantId, branchId), isPublished)),
    ))).orderBy(asc(customItemLooks.id)),
  ])
  const scene = published[0]?.scene
  return scene ? { scene, floors, placements, looks, itemLooks } : undefined
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

/** The branch's first layout, at version 1, with its scene and pages if they came. Fails on the key when one was saved meanwhile. */
export function insertLayoutStatement(db: Db, tenantId: string, branchId: string, by: string | null, now: Date, scene?: LayoutScene, pages?: LayoutPage[]): Statement {
  return db.insert(branchLayouts).values({ tenantId, branchId, version: 1, updatedAt: now, updatedBy: by, scene: scene ?? null, pages: pages ?? null })
}

/**
 * Moves the layout to the next version if it's still at `version`, and sets its scene and pages if
 * they came (none: the saved ones stay, an app tab from before). Follow it with `requireOneChange`.
 */
export function touchLayoutStatement(db: Db, tenantId: string, branchId: string, version: number, by: string | null, now: Date, scene?: LayoutScene, pages?: LayoutPage[]): Statement {
  return db.update(branchLayouts)
    .set({ version: sql`${branchLayouts.version} + 1`, updatedAt: now, updatedBy: by, ...(scene && { scene }), ...(pages && { pages }) })
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

// --- Version history (ISS-027) ---

/** How many history snapshots a branch keeps. */
export const LAYOUT_HISTORY_KEEP = 50

/** A snapshot of the layout as this save leaves it, under its new version. */
export function insertSnapshotStatement(db: Db, tenantId: string, branchId: string, version: number, by: string | null, now: Date, snapshot: ShopLayout): Statement {
  return db.insert(branchLayoutVersions).values({ tenantId, branchId, version, savedAt: now, savedBy: by, snapshot })
}

/** Keeps the branch's newest `LAYOUT_HISTORY_KEEP` snapshots; uses the history's key. */
export function pruneSnapshotsStatement(db: Db, tenantId: string, branchId: string): Statement {
  const kept = db.select({ version: branchLayoutVersions.version }).from(branchLayoutVersions)
    .where(ofBranch(branchLayoutVersions, tenantId, branchId)).orderBy(desc(branchLayoutVersions.version)).limit(LAYOUT_HISTORY_KEEP)
  return db.delete(branchLayoutVersions).where(and(ofBranch(branchLayoutVersions, tenantId, branchId), notInArray(branchLayoutVersions.version, kept)))
}

/** The branch's snapshots, newest first, with who saved each (`user.name`); no drawing. */
export function listSnapshots(db: Db, tenantId: string, branchId: string) {
  return db.select({ version: branchLayoutVersions.version, savedAt: branchLayoutVersions.savedAt, savedByName: user.name }).from(branchLayoutVersions)
    .leftJoin(user, eq(user.id, branchLayoutVersions.savedBy))
    .where(ofBranch(branchLayoutVersions, tenantId, branchId)).orderBy(desc(branchLayoutVersions.version)).limit(LAYOUT_HISTORY_KEEP)
}

/** One snapshot's layout, of this cafe and branch only. */
export async function snapshotAt(db: Db, tenantId: string, branchId: string, version: number): Promise<ShopLayout | undefined> {
  const rows = await db.select({ snapshot: branchLayoutVersions.snapshot }).from(branchLayoutVersions)
    .where(inTenant(branchLayoutVersions, tenantId, eq(branchLayoutVersions.branchId, branchId), eq(branchLayoutVersions.version, version))).limit(1)
  return rows[0]?.snapshot
}
