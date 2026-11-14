// The package's ES build has a default export only (its types name the functions).
import polygonClipping from 'polygon-clipping'
import type { Pair, Polygon } from 'polygon-clipping'
import type { Floor, Point, Slab } from '#shared/contracts/shop-layout'
import { isSimpleOutline, LAYOUT_MAX_CORNERS, LAYOUT_MAX_SLABS_PER_FLOOR, signedArea } from '#shared/contracts/shop-layout'
import type { Bounds } from './geometry'
import { newLayoutId } from './geometry'
import { perimeterWalls, trimOuterWalls } from './walls'

/**
 * The Room tool (D278, D282, Figma's rectangle): a rectangle dragged on the plan becomes a floor
 * surface with walls around it. It merges into the surfaces it touches or overlaps (one surface
 * then), or stands as a surface of its own; with Alt it is cut out of the surfaces it overlaps,
 * which may split one in two. Then outer walls follow the new edge of the floor: the rectangle's
 * sides get walls outside the floor, and outer walls left inside the building or in the air go
 * (`trimOuterWalls`). A surface has no holes, as the contract wants: a room or cut that would leave
 * one is refused with the reason.
 */

export type RoomResult = { floor: Pick<Floor, 'slabs' | 'walls'> } | { refused: string }

/** Points closer than this (cm) are one corner; a point this close to a line is on it. */
const TOLERANCE_CM = 1
/** The smallest room the tool makes, like the contract's 1 m² floor. */
export const ROOM_MIN_CM = 50

/** The four corners of a dragged rectangle, clockwise on screen like the starters. */
export function roomCorners(bounds: Bounds): Point[] {
  return [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }]
}

export function addRoom(floor: Pick<Floor, 'slabs' | 'walls'>, bounds: Bounds, cut: boolean): RoomResult {
  if (bounds.maxX - bounds.minX < ROOM_MIN_CM || bounds.maxY - bounds.minY < ROOM_MIN_CM) return { refused: `A room is at least ${ROOM_MIN_CM} cm on each side.` }
  const room = roomCorners(bounds)
  const meets = (slab: Slab) => polygonClipping.union(toPolygon(slab.outline), toPolygon(room)).length === 1
  const touched = floor.slabs.filter(meets)
  let slabs: Slab[]
  if (cut) {
    if (!touched.length) return { refused: 'Drag over a floor surface to cut a room out of it.' }
    slabs = []
    for (const slab of floor.slabs) {
      if (!touched.includes(slab)) {
        slabs.push(slab)
        continue
      }
      const pieces = polygonClipping.difference(toPolygon(slab.outline), toPolygon(room))
      if (pieces.some(piece => piece.length > 1)) return { refused: 'That would leave a hole in the floor: cut from its edge.' }
      pieces.forEach((piece, index) => slabs.push({ ...slab, id: index === 0 ? slab.id : newLayoutId('slab'), outline: oriented(tidyRing(piece[0]!), slab.outline) }))
    }
  }
  else {
    const merged = polygonClipping.union(toPolygon(room), ...touched.map(slab => toPolygon(slab.outline)))
    if (merged.length !== 1) return { refused: 'That room would not join the floor it touches.' }
    if (merged[0]!.length > 1) return { refused: 'That would leave a hole in the floor: a surface has one outline.' }
    const first = touched[0]
    const outline = tidyRing(merged[0]![0]!)
    const joined: Slab = first ? { ...first, outline: startNear(oriented(outline, first.outline), first.outline[0]!) } : { id: newLayoutId('slab'), outline: oriented(outline, room) }
    slabs = first ? floor.slabs.flatMap(slab => (slab === first ? [joined] : touched.includes(slab) ? [] : [slab])) : [...floor.slabs, joined]
  }
  for (const slab of slabs) {
    if (slab.outline.length < 3 || Math.abs(signedArea(slab.outline)) < 10_000 || !isSimpleOutline(slab.outline)) return { refused: 'That would leave too little floor.' }
    if (slab.outline.length > LAYOUT_MAX_CORNERS) return { refused: `A floor surface has at most ${LAYOUT_MAX_CORNERS} corners.` }
  }
  if (slabs.length > LAYOUT_MAX_SLABS_PER_FLOOR) return { refused: `A floor has at most ${LAYOUT_MAX_SLABS_PER_FLOOR} surfaces.` }
  // The rectangle's walls stand outside the floor: outside the room when added, inside it when cut.
  const sides = perimeterWalls(room).map(wall => (cut ? { ...wall, side: wall.side === 'left' ? 'right' as const : 'left' as const } : wall))
  return { floor: { slabs, walls: trimOuterWalls([...floor.walls, ...sides], slabs) } }
}

/** The ring wound the same way as `like` (clockwise or not), as the surface was drawn. */
function oriented(points: Point[], like: readonly Point[]): Point[] {
  return Math.sign(signedArea(points)) === Math.sign(signedArea(like)) ? points : [...points].reverse()
}

function toPolygon(points: readonly Point[]): Polygon {
  return [points.map((point): Pair => [point.x, point.y])]
}

/** A ring from polygon-clipping as whole-centimetre corners: no repeated last point, no straight-through corners. */
function tidyRing(ring: readonly Pair[]): Point[] {
  const points: Point[] = []
  for (const [x, y] of ring) {
    const point = { x: Math.round(x), y: Math.round(y) }
    const last = points.at(-1)
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > TOLERANCE_CM) points.push(point)
  }
  if (points.length > 1 && Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) <= TOLERANCE_CM) points.pop()
  let changed = true
  while (changed && points.length > 3) {
    changed = false
    for (let index = 0; index < points.length; index++) {
      const before = points[(index + points.length - 1) % points.length]!
      const after = points[(index + 1) % points.length]!
      if (distanceToLine(points[index]!, before, after) <= TOLERANCE_CM / 2) {
        points.splice(index, 1)
        changed = true
        break
      }
    }
  }
  return points
}

/** The ring started at the corner nearest the old first corner, so edge numbers move as little as they can. */
function startNear(points: readonly Point[], first: Point): Point[] {
  let best = 0
  points.forEach((point, index) => {
    if (Math.hypot(point.x - first.x, point.y - first.y) < Math.hypot(points[best]!.x - first.x, points[best]!.y - first.y)) best = index
  })
  return [...points.slice(best), ...points.slice(0, best)]
}

function distanceToLine(point: Point, from: Point, to: Point): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  return Math.abs((to.x - from.x) * (from.y - point.y) - (from.x - point.x) * (to.y - from.y)) / length
}
