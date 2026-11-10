import type { BranchLayout, Floor, Placement, SaveLayoutInput } from '#shared/contracts/shop-layout'
import type { Db, Statement } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import type { Actor } from '#server/features/identity'
import { layoutChanged, layoutTablesUnavailable } from './branches.errors'
import * as repo from './branches.layout.repository'
import type { FloorRow, LayoutRows, PlacementRow } from './branches.layout.repository'
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
    floors: rows.floors.map(toFloor),
    placements: rows.placements.map(toPlacement),
    tables: rows.tables.sort((a, b) => byLabel.compare(a.label, b.label)),
  }
}

function toFloor(row: FloorRow): Floor {
  return { id: row.id, name: row.name, height: row.heightCm, hasRoof: row.hasRoof, ...row.geometry }
}

function toPlacement(row: PlacementRow): Placement {
  return { tableId: row.tableId, floorId: row.floorId, x: row.xCm, y: row.yCm, rotation: row.rotation, width: row.widthCm, depth: row.depthCm, lookId: row.look }
}

function floorRow(floor: Floor, position: number): FloorRow {
  const { id, name, height, hasRoof, outline, edges, walls, items } = floor
  return { id, position, name, heightCm: height, hasRoof, geometry: { outline, edges, walls, items } }
}

function placementRow(placement: Placement): PlacementRow {
  const { tableId, floorId, x, y, rotation, width, depth, lookId } = placement
  return { tableId, floorId, xCm: x, yCm: y, rotation, widthCm: width, depthCm: depth, look: lookId }
}

/** The branch's layout (archived branches too: read only); none saved yet is an empty one at version 0. */
export async function getLayout(db: Db, tenantId: string, branchId: string): Promise<BranchLayout> {
  await loadBranch(db, tenantId, branchId)
  return toLayout(await repo.layoutRows(db, tenantId, branchId))
}

/**
 * Saves the whole layout from the version read, in one batch: the version (first save: the
 * layout's row), the floors and placements replaced, every placed table checked still active in
 * this branch, and an audit row. A stale version is `layoutChanged`; placed tables that aren't
 * active tables of the branch (archived or deleted meanwhile, or another branch's) are
 * `layoutTablesUnavailable`, before the write and again by the batch's guards. Nothing is saved
 * either way. The tables themselves are never written: their versions and QR codes stay.
 */
export async function saveLayout(db: Db, actor: Actor, branchId: string, input: SaveLayoutInput): Promise<BranchLayout> {
  const { tenantId } = actor
  await loadActiveBranch(db, tenantId, branchId)
  const current = await repo.layoutRows(db, tenantId, branchId)
  if ((current.layout?.version ?? 0) !== input.version) throw layoutChanged()
  const { floors, placements } = input.layout
  const unavailable = unavailableAt(placements, current.tables.map(table => table.id))
  if (unavailable.length) throw layoutTablesUnavailable(unavailable)

  const tableIds = placements.map(placement => placement.tableId)
  const now = new Date()
  const statements: Statement[] = [
    ...(input.version === 0
      ? [repo.insertLayoutStatement(db, tenantId, branchId, actor.userId, now)]
      : [repo.touchLayoutStatement(db, tenantId, branchId, input.version, actor.userId, now), requireOneChange(db)]),
    ...repo.replaceLayoutStatements(db, tenantId, branchId, floors.map(floorRow), placements.map(placementRow)),
    ...repo.requireActiveTables(db, tenantId, branchId, tableIds),
    audit(db, actor, 'layout.update', 'branch', branchId, { version: input.version + 1, floors: floors.length, placements: placements.length }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // A first save racing another: the layout's key. A table deleted meanwhile: the placement's foreign key.
    if (!isStaleWrite(error) && !isUniqueViolation(error) && !isForeignKeyError(error)) throw error
    const now = await repo.layoutRows(db, tenantId, branchId)
    if ((now.layout?.version ?? 0) !== input.version) throw layoutChanged()
    const gone = unavailableAt(placements, now.tables.map(table => table.id))
    throw gone.length ? layoutTablesUnavailable(gone) : layoutChanged()
  }
  return getLayout(db, tenantId, branchId)
}

/** The positions of the placements whose table isn't one of `activeIds`. */
function unavailableAt(placements: Placement[], activeIds: string[]): number[] {
  const active = new Set(activeIds)
  return placements.flatMap((placement, index) => (active.has(placement.tableId) ? [] : [index]))
}
