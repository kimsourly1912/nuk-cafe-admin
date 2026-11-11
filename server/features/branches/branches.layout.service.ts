import { isBuiltInLook, isItemLookKind, NO_SCENE } from '#shared/contracts/shop-layout'
import type { BranchLayout, Floor, LayoutScene, Placement, SaveLayoutInput, ScenePreset } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
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
    tables: rows.tables.sort((a, b) => byLabel.compare(a.label, b.label)),
  }
}

function toFloor(row: FloorRow): Floor {
  return { id: row.id, name: row.name, height: row.heightCm, hasRoof: row.hasRoof, ...row.geometry }
}

function toPlacement(row: PlacementRow): Placement {
  return { tableId: row.tableId, floorId: row.floorId, x: row.xCm, y: row.yCm, rotation: row.rotation, width: row.widthCm, depth: row.depthCm, lookId: (row.look ?? row.customLookId)! }
}

function floorRow(floor: Floor, position: number): FloorRow {
  const { id, name, height, hasRoof, outline, edges, walls, items } = floor
  return { id, position, name, heightCm: height, hasRoof, geometry: { outline, edges, walls, items } }
}

function placementRow(placement: Placement): PlacementRow {
  const { tableId, floorId, x, y, rotation, width, depth, lookId } = placement
  const look = isBuiltInLook(lookId) ? { look: lookId, customLookId: null } : { look: null, customLookId: lookId }
  return { tableId, floorId, xCm: x, yCm: y, rotation, widthCm: width, depthCm: depth, ...look }
}

/** The branch's layout (archived branches too: read only); none saved yet is an empty one at version 0. */
export async function getLayout(db: Db, tenantId: string, branchId: string): Promise<BranchLayout> {
  await loadBranch(db, tenantId, branchId)
  return toLayout(await repo.layoutRows(db, tenantId, branchId))
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
  const { floors, placements, scene } = input.layout
  const unavailable = unavailableAt(placements, current.tables.map(table => table.id))
  if (unavailable.length) throw layoutTablesUnavailable(unavailable)
  const unknownLooks = unknownLooksAt(input.layout, current)
  if (unknownLooks.length) throw layoutLooksUnavailable(unknownLooks)

  const tableIds = placements.map(placement => placement.tableId)
  const now = new Date()
  const statements: Statement[] = [
    ...(input.version === 0
      ? [repo.insertLayoutStatement(db, tenantId, branchId, actor.userId, now, scene)]
      : [repo.touchLayoutStatement(db, tenantId, branchId, input.version, actor.userId, now, scene), requireOneChange(db)]),
    ...repo.replaceLayoutStatements(db, tenantId, branchId, floors.map(floorRow), placements.map(placementRow), floors.flatMap(itemLookUses)),
    ...repo.requireActiveTables(db, tenantId, branchId, tableIds),
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

/** The audit's note of a new scene: its preset, when the save changes it (step 4a). */
function sceneChange(current: LayoutRows, scene: LayoutScene | undefined): { scene?: ScenePreset } {
  const saved = current.layout?.scene ?? NO_SCENE
  return scene && scene.preset !== saved.preset ? { scene: scene.preset } : {}
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
