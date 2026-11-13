import { INVALID_STREET_DOOR, isBuiltInLook, isItemLookKind, ITEM_HEIGHTS, NO_SCENE, streetDoor } from '#shared/contracts/shop-layout'
import type { BranchLayout, Floor, LayoutHistoryEntry, LayoutScene, Placement, PublicExploreLayout, SaveLayoutInput, ShopLayout } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { apiError, ErrorCodes, notFound } from '#server/utils/errors'
import { toIso } from '#server/utils/time'
import type { Actor } from '#server/features/identity'
import { layoutChanged, layoutLooksUnavailable, layoutTablesUnavailable } from './branches.errors'
import * as repo from './branches.layout.repository'
import type { FloorRow, ItemLookUseRow, LayoutRows, PlacementRow } from './branches.layout.repository'
import { audit, loadActiveBranch, loadBranch } from './branches.service'

/**
 * A branch's shop layout (D273, docs/plans/shop-designer.md): its floors and where its dining
 * tables stand. Saved whole, at the version read (0 before the first save). The tables stay the
 * branches feature's records: a placement names a table of this cafe and branch (the database's
 * composite foreign key), placing it never changes its QR, and archiving it takes it off the plan.
 */

const byLabel = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function toLayout(rows: LayoutRows): BranchLayout {
  return {
    version: rows.layout?.version ?? 0,
    updatedAt: rows.layout ? toIso(rows.layout.updatedAt) : null,
    updatedByName: rows.layout?.updatedByName ?? null,
    floors: rows.floors.map(toFloor),
    placements: rows.placements.map(toPlacement),
    scene: rows.layout?.scene ?? NO_SCENE,
    ...(rows.layout?.pages && { pages: rows.layout.pages }),
    tables: rows.tables.sort((a, b) => byLabel.compare(a.label, b.label)),
  }
}

/** Studio's design-only fields (ISS-021, ISS-035, ISS-036), only when set, as the contract leaves them out. */
function frameOf(row: FloorRow): Pick<Floor, 'canvasX' | 'canvasY' | 'pageId' | 'hidden' | 'locked'> {
  return {
    ...(row.canvasXCm && { canvasX: row.canvasXCm }),
    ...(row.canvasYCm && { canvasY: row.canvasYCm }),
    ...(row.pageId && { pageId: row.pageId }),
    ...(row.hidden && { hidden: true as const }),
    ...(row.locked && { locked: true as const }),
  }
}

function toFloor(row: FloorRow): Floor {
  const { outline, edges, walls, items } = row.geometry
  return { id: row.id, name: row.name, height: row.heightCm, hasRoof: row.hasRoof, outline, edges, walls, items, ...frameOf(row) }
}

/**
 * A floor as Explore shows it to customers: the building only. Studio's frame, page and layer
 * flags (design-only) are left out, also its pieces' and walls' flags (names stay: a shape's shows in 3D).
 */
function toPublicFloor(row: FloorRow): Floor {
  const { outline, edges, walls, items } = row.geometry
  const plain = <T extends { name?: string, hidden?: true, locked?: true }>(layer: T) => {
    const { hidden: _hidden, locked: _locked, ...rest } = layer
    return rest
  }
  return { id: row.id, name: row.name, height: row.heightCm, hasRoof: row.hasRoof, outline, edges, walls: walls.map(plain), items: items.map(plain) }
}

function toPlacement(row: PlacementRow): Placement {
  return {
    tableId: row.tableId, floorId: row.floorId, x: row.xCm, y: row.yCm, rotation: row.rotation, width: row.widthCm, depth: row.depthCm, lookId: (row.look ?? row.customLookId)!,
    ...(row.hidden && { hidden: true as const }),
    ...(row.locked && { locked: true as const }),
  }
}

function floorRow(floor: Floor, position: number): FloorRow {
  const { id, name, height, hasRoof, outline, edges, walls, items } = floor
  return {
    id, position, name, heightCm: height, hasRoof, geometry: { outline, edges, walls, items },
    canvasXCm: floor.canvasX ?? 0, canvasYCm: floor.canvasY ?? 0, pageId: floor.pageId ?? null, hidden: floor.hidden ?? false, locked: floor.locked ?? false,
  }
}

function placementRow(placement: Placement): PlacementRow {
  const { tableId, floorId, x, y, rotation, width, depth, lookId } = placement
  const look = isBuiltInLook(lookId) ? { look: lookId, customLookId: null } : { look: null, customLookId: lookId }
  return { tableId, floorId, xCm: x, yCm: y, rotation, widthCm: width, depthCm: depth, ...look, hidden: placement.hidden ?? false, locked: placement.locked ?? false }
}

/** The branch's layout (archived branches too: read only); none saved yet is an empty one at version 0. */
export async function getLayout(db: Db, tenantId: string, branchId: string): Promise<BranchLayout> {
  await loadBranch(db, tenantId, branchId)
  return toLayout(await repo.layoutRows(db, tenantId, branchId))
}

/** Only an active, opted-in branch with a pin and a valid street door has a public layout. */
export async function getPublicExploreLayout(db: Db, tenantId: string, branchId: string): Promise<PublicExploreLayout> {
  const rows = await repo.exploreRows(db, tenantId, branchId)
  if (!rows) throw notFound('This branch')
  const floors = rows.floors.map(toPublicFloor)
  const { preset, entrance } = rows.scene
  if (!entrance || !streetDoor(floors, entrance)) throw notFound('This branch')
  return {
    floors,
    placements: rows.placements.map((row) => {
      const { floorId, x, y, rotation, width, depth, lookId } = toPlacement(row) // never Studio's flags
      return { floorId, x, y, rotation, width, depth, lookId, seats: row.seats }
    }),
    scene: { preset, entrance, explore: true },
    looks: rows.looks,
    itemLooks: rows.itemLooks.map(look => ({ ...look, defaultHeight: look.defaultHeight ?? ITEM_HEIGHTS[look.kind].default })),
  }
}

/**
 * Saves the whole layout from the version read, in one batch: the version (first save: the
 * layout's row) and the scene if one came (none: the saved one stays, an app tab from before step 4a),
 * the floors and placements replaced, every placed table checked still active in
 * this branch, and an audit row. A stale version is `layoutChanged`; placed tables that aren't
 * active tables of the branch (archived or deleted meanwhile, or another branch's) are
 * `layoutTablesUnavailable`, before the write and again by the batch's guards. A look that is
 * neither built in nor one of this cafe's custom looks (deleted meanwhile, or another cafe's) is
 * `layoutLooksUnavailable`, before the write and again by the placements' foreign key; so is a
 * piece of furniture whose look isn't one of the cafe's item looks of its kind (step 3d), checked
 * again by the item looks' uses' foreign key. Nothing is saved either way. The tables themselves are never written: their versions and QR codes stay.
 */
export async function saveLayout(db: Db, actor: Actor, branchId: string, input: SaveLayoutInput): Promise<BranchLayout> {
  const { tenantId } = actor
  await loadActiveBranch(db, tenantId, branchId)
  const current = await repo.layoutRows(db, tenantId, branchId)
  if ((current.layout?.version ?? 0) !== input.version) throw layoutChanged()
  const { floors, placements, scene: requestedScene, pages } = input.layout
  const savedScene = current.layout?.scene ?? NO_SCENE
  const scene = requestedScene && { ...savedScene, ...requestedScene }
  const effectiveScene = scene ?? savedScene
  if ((effectiveScene.entrance != null || effectiveScene.explore) && !streetDoor(floors, effectiveScene.entrance)) {
    throw apiError(400, ErrorCodes.VALIDATION_FAILED, INVALID_STREET_DOOR, { fieldErrors: { 'layout.scene.entrance': [INVALID_STREET_DOOR] } })
  }
  const unavailable = unavailableAt(placements, current.tables.map(table => table.id))
  if (unavailable.length) throw layoutTablesUnavailable(unavailable)
  const unknownLooks = unknownLooksAt(input.layout, current)
  if (unknownLooks.length) throw layoutLooksUnavailable(unknownLooks)

  const tableIds = placements.map(placement => placement.tableId)
  const now = new Date()
  // History (ISS-027): a snapshot of what this save leaves, unless one was taken a moment ago, so
  // autosaving every few seconds keeps checkpoints, not every keystroke.
  const snapshot: ShopLayout = { floors, placements, scene: effectiveScene, ...((pages ?? current.layout?.pages) && { pages: pages ?? current.layout!.pages! }) }
  const takeSnapshot = !current.lastSnapshotAt || now.getTime() - current.lastSnapshotAt.getTime() >= LAYOUT_SNAPSHOT_EVERY_MS
  const statements: Statement[] = [
    ...(input.version === 0
      ? [repo.insertLayoutStatement(db, tenantId, branchId, actor.userId, now, scene, pages)]
      : [repo.touchLayoutStatement(db, tenantId, branchId, input.version, actor.userId, now, scene, pages), requireOneChange(db)]),
    ...repo.replaceLayoutStatements(db, tenantId, branchId, floors.map(floorRow), placements.map(placementRow), floors.flatMap(itemLookUses)),
    ...repo.requireActiveTables(db, tenantId, branchId, tableIds),
    ...(takeSnapshot ? [repo.insertSnapshotStatement(db, tenantId, branchId, input.version + 1, actor.userId, now, snapshot), repo.pruneSnapshotsStatement(db, tenantId, branchId)] : []),
    audit(db, actor, 'layout.update', 'branch', branchId, { version: input.version + 1, floors: floors.length, placements: placements.length, ...sceneChange(current, scene) }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // A first save racing another: the layout's key. A table or a custom look deleted meanwhile:
    // the placement's and the item looks' uses' foreign keys.
    if (!isStaleWrite(error) && !isUniqueViolation(error) && !isForeignKeyError(error)) throw error
    const now = await repo.layoutRows(db, tenantId, branchId)
    if ((now.layout?.version ?? 0) !== input.version) throw layoutChanged()
    const gone = unavailableAt(placements, now.tables.map(table => table.id))
    if (gone.length) throw layoutTablesUnavailable(gone)
    const deleted = unknownLooksAt(input.layout, now)
    throw deleted.length ? layoutLooksUnavailable(deleted) : layoutChanged()
  }
  return getLayout(db, tenantId, branchId)
}

/** At most one history snapshot per this long of saving (ISS-027). */
export const LAYOUT_SNAPSHOT_EVERY_MS = 10 * 60_000

/** The branch's layout history (ISS-027), newest first: versions with a snapshot, and who saved them. */
export async function listLayoutHistory(db: Db, tenantId: string, branchId: string): Promise<LayoutHistoryEntry[]> {
  await loadBranch(db, tenantId, branchId)
  const rows = await repo.listSnapshots(db, tenantId, branchId)
  return rows.map(row => ({ version: row.version, savedAt: toIso(row.savedAt), savedByName: row.savedByName ?? null }))
}

/** One history snapshot (ISS-027) of this cafe's branch; another branch's or cafe's is not found. */
export async function getLayoutSnapshot(db: Db, tenantId: string, branchId: string, version: number): Promise<ShopLayout> {
  await loadBranch(db, tenantId, branchId)
  const snapshot = await repo.snapshotAt(db, tenantId, branchId, version)
  if (!snapshot) throw notFound('This version')
  return snapshot
}

/** The audit's note of a new scene: its preset, when the save changes it (step 4a). */
function sceneChange(current: LayoutRows, scene: LayoutScene | undefined) {
  if (!scene) return {}
  const saved = current.layout?.scene ?? NO_SCENE
  return {
    ...(scene.preset !== saved.preset && { scene: scene.preset }),
    ...(scene.entrance !== saved.entrance && { entrance: scene.entrance ?? null }),
    ...(Boolean(scene.explore) !== Boolean(saved.explore) && { explore: Boolean(scene.explore) }),
  }
}

/** The positions of the placements whose table isn't one of `activeIds`. */
function unavailableAt(placements: Placement[], activeIds: string[]): number[] {
  const active = new Set(activeIds)
  return placements.flatMap((placement, index) => (active.has(placement.tableId) ? [] : [index]))
}

/**
 * The `lookId` paths of the save whose look the cafe doesn't have: a placement's that is neither
 * built in nor one of `lookIds`; a piece's that isn't one of `itemLooks` of the piece's kind.
 */
function unknownLooksAt(layout: SaveLayoutInput['layout'], cafe: Pick<LayoutRows, 'lookIds' | 'itemLooks'>): string[] {
  const known = new Set(cafe.lookIds)
  const kinds = new Map(cafe.itemLooks.map(look => [look.id, look.kind]))
  return [
    ...layout.placements.flatMap((placement, index) => (isBuiltInLook(placement.lookId) || known.has(placement.lookId) ? [] : [`layout.placements.${index}.lookId`])),
    ...layout.floors.flatMap((floor, at) => floor.items.flatMap((item, index) =>
      item.lookId === undefined || kinds.get(item.lookId) === item.kind ? [] : [`layout.floors.${at}.items.${index}.lookId`])),
  ]
}

/** How many of a floor's pieces use each custom item look: the rows that let the database guard them. */
function itemLookUses(floor: Floor): ItemLookUseRow[] {
  const uses = new Map<string, ItemLookUseRow>()
  for (const item of floor.items) {
    if (item.lookId === undefined || !isItemLookKind(item.kind)) continue
    const use = uses.get(item.lookId)
    if (use) use.pieces++
    else uses.set(item.lookId, { floorId: floor.id, lookId: item.lookId, kind: item.kind, pieces: 1 })
  }
  return [...uses.values()]
}
