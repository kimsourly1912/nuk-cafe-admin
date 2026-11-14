import type { InnerWall, LayoutItem, Point, ShopLayout } from '#shared/contracts/shop-layout'
import { newLayoutId, normalizeRotation } from './geometry'
import type { Bounds } from './geometry'
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
    return { ...copyWall(wall), id, from: { x: wall.from.x + offset.x, y: wall.from.y + offset.y }, to: { x: wall.to.x + offset.x, y: wall.to.y + offset.y } }
  })
  floor.items.push(...itemCopies)
  floor.walls.push(...wallCopies)
  return copies
}

/**
 * Ctrl/⌘+C (ISS-022): a copy of the selected pieces and inside walls as they are now, so a paste
 * still works after the originals moved or were deleted, like Figma. Tables are kept by id only:
 * a copy of a table is another table (its own QR code), chosen when pasting, as Duplicate look does.
 * In memory only, never the system clipboard.
 */
export interface PlanClipboard {
  floorId: string
  items: LayoutItem[]
  walls: InnerWall[]
  tableIds: string[]
}

export function copySelected(layout: ShopLayout, floorId: string, targets: readonly PlanSelection[]): PlanClipboard | null {
  const floor = layout.floors.find(candidate => candidate.id === floorId)
  if (!floor) return null
  const items = ids(targets, 'item')
  const walls = ids(targets, 'wall')
  const tables = ids(targets, 'table')
  const clipboard: PlanClipboard = {
    floorId,
    items: floor.items.filter(item => items.has(item.id)).map(item => structuredClone(item)),
    walls: floor.walls.filter(wall => walls.has(wall.id)).map(wall => structuredClone(wall)),
    tableIds: layout.placements.filter(placement => placement.floorId === floorId && tables.has(placement.tableId)).map(placement => placement.tableId),
  }
  return clipboard.items.length || clipboard.walls.length || clipboard.tableIds.length ? clipboard : null
}

/**
 * Ctrl/⌘+V (ISS-022): new copies of the clipboard's pieces and walls on floor `floorId` (any floor:
 * owner, 2026-11-13), moved by `offset`. Tables are not pasted here.
 */
export function pasteClipboard(layout: ShopLayout, clipboard: PlanClipboard, floorId: string, offset: Point): PlanSelection[] {
  const floor = layout.floors.find(candidate => candidate.id === floorId)
  if (!floor) return []
  const copies: PlanSelection[] = []
  for (const item of clipboard.items) {
    const id = newLayoutId('item')
    copies.push({ kind: 'item', id })
    floor.items.push({ ...structuredClone(item), id, x: item.x + offset.x, y: item.y + offset.y })
  }
  for (const wall of clipboard.walls) {
    const id = newLayoutId('wall')
    copies.push({ kind: 'wall', id })
    floor.walls.push({ ...copyWall(wall), id, from: { x: wall.from.x + offset.x, y: wall.from.y + offset.y }, to: { x: wall.to.x + offset.x, y: wall.to.y + offset.y } })
  }
  return copies
}

/** A copy of a wall whose doors and windows get ids of their own (ISS-042), as the panels make them. */
function copyWall(wall: InnerWall): InnerWall {
  const copy = structuredClone(wall)
  if (copy.openings) copy.openings = copy.openings.map(opening => ({ ...opening, id: newLayoutId(opening.kind) }))
  return copy
}

/**
 * Tab and Shift+Tab on the plan (ISS-007, Figma): the next or previous of `order` after `current`,
 * round the end; the first (or last) when nothing in `order` is selected.
 */
export function cycleSelection(order: readonly PlanSelection[], current: PlanSelection | null, step: 1 | -1): PlanSelection | null {
  if (!order.length) return null
  const at = current ? order.findIndex(target => target.kind === current.kind && target.id === current.id) : -1
  if (at < 0) return order[step > 0 ? 0 : order.length - 1]!
  return order[(at + step + order.length) % order.length]!
}

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/**
 * Align (ISS-026, Figma): how far each selected thing moves so its `edge` lines up with the same
 * edge of the whole selection, or of `within` when given (ED-11: one piece to its floor, as Figma
 * aligns one layer to its frame). `boxes` are what each one takes up on the plan, as drawn.
 */
export function alignOffsets(boxes: readonly { target: PlanSelection, bounds: Bounds }[], edge: AlignEdge, within?: Bounds): { target: PlanSelection, delta: Point }[] {
  if (!boxes.length || (boxes.length < 2 && !within)) return []
  const all = within ?? {
    minX: Math.min(...boxes.map(box => box.bounds.minX)),
    maxX: Math.max(...boxes.map(box => box.bounds.maxX)),
    minY: Math.min(...boxes.map(box => box.bounds.minY)),
    maxY: Math.max(...boxes.map(box => box.bounds.maxY)),
  }
  return boxes.map(({ target, bounds }) => {
    const delta = { x: 0, y: 0 }
    if (edge === 'left') delta.x = all.minX - bounds.minX
    if (edge === 'right') delta.x = all.maxX - bounds.maxX
    if (edge === 'center') delta.x = Math.round((all.minX + all.maxX - bounds.minX - bounds.maxX) / 2)
    if (edge === 'top') delta.y = all.minY - bounds.minY
    if (edge === 'bottom') delta.y = all.maxY - bounds.maxY
    if (edge === 'middle') delta.y = Math.round((all.minY + all.maxY - bounds.minY - bounds.maxY) / 2)
    return { target, delta }
  }).filter(({ delta }) => delta.x || delta.y)
}

/**
 * Distribute (owner, 2026-11-13, Figma's tidy spacing): three or more along `axis` get equal gaps;
 * the first and last stay where they are. Whole centimetres, so a gap may differ by 1 cm.
 */
export function distributeOffsets(boxes: readonly { target: PlanSelection, bounds: Bounds }[], axis: 'x' | 'y'): { target: PlanSelection, delta: Point }[] {
  if (boxes.length < 3) return []
  const min = axis === 'x' ? 'minX' : 'minY'
  const max = axis === 'x' ? 'maxX' : 'maxY'
  const sorted = [...boxes].sort((a, b) => a.bounds[min] - b.bounds[min])
  const first = sorted[0]!
  const last = sorted.at(-1)!
  const sizes = sorted.reduce((sum, box) => sum + box.bounds[max] - box.bounds[min], 0)
  const gap = (last.bounds[max] - first.bounds[min] - sizes) / (sorted.length - 1)
  let at = first.bounds[min]
  const moves: { target: PlanSelection, delta: Point }[] = []
  for (const box of sorted) {
    const shift = Math.round(at - box.bounds[min])
    if (shift && box !== first && box !== last) moves.push({ target: box.target, delta: axis === 'x' ? { x: shift, y: 0 } : { x: 0, y: shift } })
    at += box.bounds[max] - box.bounds[min] + gap
  }
  return moves
}
