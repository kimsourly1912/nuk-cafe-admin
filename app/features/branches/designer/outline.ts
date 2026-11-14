import type { FinishColor, Floor, FloorSurface, Point, Slab, Wall } from '#shared/contracts/shop-layout'
import { signedArea } from '#shared/contracts/shop-layout'
import { newLayoutId, outwardNormal, snap, SNAP_CM, wallOutward } from './geometry'
import { followPoints, joinWalls, perimeterWalls, splitWall, wallAlong } from './walls'
import type { PointMove } from './walls'

/**
 * Editing a floor surface's outline (D273 frames 3A, D282): its corners and sides, with the walls
 * joined to it. Since contract v2 a surface and its walls are separate, but they stay joined where
 * a wall's end sits on a corner: moving the corner moves the wall end, a corner added on a side
 * cuts the wall along it in two, and a corner removed joins the two walls beside it. Pure functions
 * in layout units that return new values, so each edit is one draft change (one undo step).
 */

/** One surface's outline and the floor's walls (all of them: any may be joined to it). */
export interface FloorShape {
  outline: Point[]
  walls: Wall[]
}

/** Corners closer than this to the shape's first corner close it while drawing. */
export const CLOSE_DISTANCE_CM = 30

/** A new surface from drawn corners, with walls around it outside (D282); `walls` holds only the new ones. */
export function closedShape(corners: readonly Point[]): FloorShape {
  const outline = corners.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }))
  return { outline, walls: perimeterWalls(outline) }
}

/** Whether the drawn corners make a floor: three or more with an area (the contract's 1 m²). */
export function canClose(corners: readonly Point[]): boolean {
  return corners.length >= 3 && Math.abs(signedArea(corners)) >= 10_000
}

/** The walls after corners moved: those joined to a moved corner follow it. */
function follow(shape: FloorShape, outline: Point[]): FloorShape {
  const moves: PointMove[] = shape.outline.map((from, index) => ({ from, to: outline[index]! }))
  return { outline, walls: followPoints(shape.walls, moves) }
}

/**
 * Moves corner `index` to `to`. With `square`, the corners next to it follow so that edges that
 * ran straight across or down still do (an L-shape stays an L-shape, frame 3A); without, only the
 * corner moves. Walls joined to a moved corner follow.
 */
export function moveCorner(shape: FloorShape, index: number, to: Point, square = true): FloorShape {
  const outline = shape.outline.map(point => ({ ...point }))
  const count = outline.length
  const from = outline[index]!
  const target = { x: Math.round(to.x), y: Math.round(to.y) }
  if (square) {
    for (const neighbour of [(index - 1 + count) % count, (index + 1) % count]) {
      const point = outline[neighbour]!
      // A neighbour sharing both coordinates is a zero-length edge: leave it.
      if (point.y === from.y && point.x !== from.x) point.y = target.y
      else if (point.x === from.x && point.y !== from.y) point.x = target.x
    }
  }
  outline[index] = target
  return follow(shape, outline)
}

/**
 * A new corner on side `index`: in its middle (the side's round handle, frame 3A), or at the point
 * on it nearest `at` (a double-click in Edit points, D278), snapped to the grid. A wall along the
 * side is cut in two there, each door or window going to the half holding its middle.
 */
export function insertCorner(shape: FloorShape, index: number, at?: Point): FloorShape {
  const count = shape.outline.length
  const from = shape.outline[index]!
  const to = shape.outline[(index + 1) % count]!
  const span = Math.hypot(to.x - from.x, to.y - from.y)
  const share = at && span ? clamp(((at.x - from.x) * (to.x - from.x) + (at.y - from.y) * (to.y - from.y)) / (span * span), 0, 1) : 0.5
  const middle = { x: snap(from.x + (to.x - from.x) * share, SNAP_CM), y: snap(from.y + (to.y - from.y) * share, SNAP_CM) }
  // On a corner already: nothing to add.
  if ((middle.x === from.x && middle.y === from.y) || (middle.x === to.x && middle.y === to.y)) return shape
  const outline = [...shape.outline.slice(0, index + 1), middle, ...shape.outline.slice(index + 1)].map(point => ({ ...point }))
  const walls = shape.walls.flatMap(wall => (wallAlong(wall, from, to) ? splitWall(wall, middle, newLayoutId('wall')) : [wall]))
  return { outline, walls }
}

/**
 * Moves side `index` sideways by `distance` (outwards when positive), both its corners together:
 * Figma's dragging of a shape's side (D278). The sides next to it stretch; right angles stay right.
 */
export function moveSide(shape: FloorShape, index: number, distance: number): FloorShape {
  if (!distance) return shape
  const count = shape.outline.length
  const normal = outwardNormal(shape.outline, index)
  const outline = shape.outline.map(point => ({ ...point }))
  for (const corner of [index, (index + 1) % count]) {
    outline[corner] = { x: Math.round(outline[corner]!.x + normal.x * distance), y: Math.round(outline[corner]!.y + normal.y * distance) }
  }
  return follow(shape, outline)
}

/**
 * Removes corner `index`: the sides on either side become one. Walls along both become one wall,
 * of the earlier one's kind, with the openings of both that still fit and that kind takes
 * (ISS-037; owner 2026-11-14: no warning). A wall along the earlier side only stretches to the next
 * corner; one along the later side only goes, as an open edge did before contract v2. A surface
 * keeps at least three corners (Delete removes the whole surface).
 */
export function removeCorner(shape: FloorShape, index: number): FloorShape {
  const count = shape.outline.length
  if (count <= 3) return shape
  const previous = shape.outline[(index - 1 + count) % count]!
  const corner = shape.outline[index]!
  const next = shape.outline[(index + 1) % count]!
  const before = shape.walls.find(wall => wallAlong(wall, previous, corner))
  const after = shape.walls.find(wall => wallAlong(wall, corner, next))
  const outline = shape.outline.filter((_, position) => position !== index).map(point => ({ ...point }))
  let walls = shape.walls.filter(wall => wall !== after)
  if (before) {
    const merged = after ? joinWalls(before, after) : followPoints([before], [{ from: corner, to: next }])[0]!
    walls = walls.map(wall => (wall === before ? merged ?? wall : wall))
  }
  return { outline, walls }
}

/**
 * Sets side `index` to `length` by moving its end corner along it (and, with `square`, the
 * corners next to that one, as `moveCorner`). A zero-length side has no direction and is left.
 */
export function setEdgeLength(shape: FloorShape, index: number, length: number, square = true): FloorShape {
  const count = shape.outline.length
  const from = shape.outline[index]!
  const to = shape.outline[(index + 1) % count]!
  const current = Math.hypot(to.x - from.x, to.y - from.y)
  if (!current) return shape
  const scale = length / current
  return moveCorner(shape, (index + 1) % count, { x: from.x + (to.x - from.x) * scale, y: from.y + (to.y - from.y) * scale }, square)
}

/** Which way an outward direction faces in the top-down view: Front (down the screen), Back, Left or Right. */
export function facing(out: Point): 'Front' | 'Back' | 'Left' | 'Right' {
  if (Math.abs(out.y) >= Math.abs(out.x)) return out.y > 0 ? 'Front' : 'Back'
  return out.x > 0 ? 'Right' : 'Left'
}

/** Names by facing, numbered when several face the same way ("Front edge 2"). */
export function facingNames(facings: readonly string[], noun: string): string[] {
  const totals = new Map<string, number>()
  for (const name of facings) totals.set(name, (totals.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  return facings.map((name) => {
    const number = (seen.get(name) ?? 0) + 1
    seen.set(name, number)
    return totals.get(name)! > 1 ? `${name} ${noun} ${number}` : `${name} ${noun}`
  })
}

/** What to call a surface's sides in the editor, by the way each faces: "Front edge", "Left edge 2". */
export function edgeNames(outline: readonly Point[]): string[] {
  return facingNames(outline.map((_, index) => facing(outwardNormal(outline, index))), 'edge')
}

/** What to call a floor's walls (D282), by the way each faces out of the building: "Front wall", "Left wall 2". */
export function wallNames(floor: Pick<Floor, 'slabs' | 'walls'>): string[] {
  return facingNames(floor.walls.map(wall => facing(wallOutward(wall, floor.slabs))), 'wall')
}

/** The floor's area in square metres, rounded. */
export function areaM2(outline: readonly Point[]): number {
  return Math.round(Math.abs(signedArea(outline)) / 10_000)
}

/** A surface's outline with the floor's walls, the part these functions edit. */
export function shapeOf(floor: Pick<Floor, 'walls'>, slab: Pick<Slab, 'outline'>): FloorShape {
  return { outline: slab.outline, walls: floor.walls }
}

/** The floor with surface `slabId` and its walls changed to `shape`. */
export function withShape<T extends Pick<Floor, 'slabs' | 'walls'>>(floor: T, slabId: string, shape: FloorShape): T {
  return { ...floor, slabs: floor.slabs.map(slab => (slab.id === slabId ? { ...slab, outline: shape.outline } : slab)), walls: shape.walls }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A floor surface's finish (D285): what it is laid with and its colour; null puts the default back. */
export interface SlabFinish {
  floor?: FloorSurface | null
  color?: FinishColor | null
}

/** The surface with its finish changed; a field left out keeps its value. */
export function setSlabFinish(slab: Slab, change: SlabFinish): Slab {
  const { floor: _floor, color: _color, ...rest } = slab
  const floor = change.floor === undefined ? slab.floor : change.floor
  const color = change.color === undefined ? slab.color : change.color
  return { ...rest, ...(floor && { floor }), ...(color && { color }) }
}
