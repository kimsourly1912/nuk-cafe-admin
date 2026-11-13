import type { InnerWall, LayoutItem, Point, ShopLayout } from '#shared/contracts/shop-layout'
import { newLayoutId, normalizeRotation } from './geometry'
import type { PlanSelection } from './plan'
import { moveWalls } from './walls'

/**
 * Several selected pieces changed together (D278, multi-select): tables, furniture and inside walls
 * of one floor. Each function changes the draft's copy of the layout it is given (inside one
 * `draft.change`, so the whole change is one undo step). Outline edges never join a set.
 */

const ids = (targets: readonly PlanSelection[], kind: PlanSelection['kind']) => new Set(targets.filter(target => target.kind === kind).map(target => target.id))

/** Moves every selected table, piece and wall by `delta`; walls joined to a moved wall's end stretch to follow. */
export function shiftSelected(layout: ShopLayout, floorId: string, targets: readonly PlanSelection[], delta: Point): void {
  if (!delta.x && !delta.y) return
  const tables = ids(targets, 'table')
  const items = ids(targets, 'item')
  const walls = ids(targets, 'wall')
  for (const placement of layout.placements) {
    if (placement.floorId === floorId && tables.has(placement.tableId)) {
      placement.x += delta.x
      placement.y += delta.y
    }
  }
  const floor = layout.floors.find(candidate => candidate.id === floorId)
  if (!floor) return
  for (const item of floor.items) {
    if (items.has(item.id)) {
      item.x += delta.x
      item.y += delta.y
    }
  }
  if (walls.size) floor.walls = moveWalls(floor.walls, walls, delta)
}

/**
 * Turns the set 90° clockwise around `center` (the middle of its bounds): each piece moves around
 * it and turns with it, as one rigid group (Figma's rotation of a selection).
 */
export function turnSelected(layout: ShopLayout, floorId: string, targets: readonly PlanSelection[], center: Point): void {
  const turn = (point: Point): Point => ({ x: Math.round(center.x - (point.y - center.y)), y: Math.round(center.y + (point.x - center.x)) })
  const tables = ids(targets, 'table')
  const items = ids(targets, 'item')
  const walls = ids(targets, 'wall')
  for (const placement of layout.placements) {
    if (placement.floorId !== floorId || !tables.has(placement.tableId)) continue
    Object.assign(placement, turn(placement), { rotation: normalizeRotation(placement.rotation + 90) })
  }
  const floor = layout.floors.find(candidate => candidate.id === floorId)
  if (!floor) return
  for (const item of floor.items) {
    if (items.has(item.id)) Object.assign(item, turn(item), { rotation: normalizeRotation(item.rotation + 90) })
  }
  for (const wall of floor.walls) {
    if (!walls.has(wall.id)) continue
    wall.from = turn(wall.from)
    wall.to = turn(wall.to)
  }
}

/** Tables leave the map (their QR untouched), furniture and walls are deleted. */
export function removeSelected(layout: ShopLayout, targets: readonly PlanSelection[]): void {
  const tables = ids(targets, 'table')
  const items = ids(targets, 'item')
  const walls = ids(targets, 'wall')
  layout.placements = layout.placements.filter(placement => !tables.has(placement.tableId))
  for (const floor of layout.floors) {
    floor.items = floor.items.filter(item => !items.has(item.id))
    floor.walls = floor.walls.filter(wall => !walls.has(wall.id))
  }
}

/**
 * Copies the set's furniture and walls `offset` away, as new pieces, and returns them (to select).
 * Tables are not copied: a copy would need a table of its own and its own QR code (Duplicate look
 * asks which table, one at a time).
 */
export function duplicateSelected(layout: ShopLayout, floorId: string, targets: readonly PlanSelection[], offset: Point): PlanSelection[] {
  const floor = layout.floors.find(candidate => candidate.id === floorId)
  if (!floor) return []
  const items = ids(targets, 'item')
  const walls = ids(targets, 'wall')
  const copies: PlanSelection[] = []
  const itemCopies: LayoutItem[] = floor.items.filter(item => items.has(item.id)).map((item) => {
    const id = newLayoutId('item')
    copies.push({ kind: 'item', id })
    return { ...structuredClone(item), id, x: item.x + offset.x, y: item.y + offset.y }
  })
  const wallCopies: InnerWall[] = floor.walls.filter(wall => walls.has(wall.id)).map((wall) => {
    const id = newLayoutId('wall')
    copies.push({ kind: 'wall', id })
    return { ...structuredClone(wall), id, from: { x: wall.from.x + offset.x, y: wall.from.y + offset.y }, to: { x: wall.to.x + offset.x, y: wall.to.y + offset.y } }
  })
  floor.items.push(...itemCopies)
  floor.walls.push(...wallCopies)
  return copies
}
