// The package's ES build has a default export only (its types name the functions).
import polygonClipping from 'polygon-clipping'
import type { Pair, Polygon } from 'polygon-clipping'
import type { Edge, Opening, Point } from '#shared/contracts/shop-layout'
import { LAYOUT_MAX_CORNERS, signedArea } from '#shared/contracts/shop-layout'
import type { Bounds } from './geometry'
import { closedShape, fitOpenings } from './outline'
import type { FloorShape } from './outline'

/**
 * The Room tool (D278, Figma's rectangle): a rectangle dragged on the plan becomes the floor's
 * outline, merges into it, or (with Alt) is cut out of it. The result is one outline without holes,
 * as the contract wants: a room that doesn't touch the floor, a cut that would split it or leave a
 * hole, is refused with the reason. The edges that stay where they were keep their kind, doors and
 * windows; new edges are walls.
 */

export type RoomResult = { shape: FloorShape } | { refused: string }

/** Points closer than this (cm) are one corner; a point this close to a line is on it. */
const TOLERANCE_CM = 1
/** The smallest room the tool makes, like the contract's 1 m² floor. */
export const ROOM_MIN_CM = 50

/** The four corners of a dragged rectangle, clockwise on screen like the starters. */
export function roomCorners(bounds: Bounds): Point[] {
  return [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }]
}

export function addRoom(shape: FloorShape, bounds: Bounds, cut: boolean): RoomResult {
  if (bounds.maxX - bounds.minX < ROOM_MIN_CM || bounds.maxY - bounds.minY < ROOM_MIN_CM) return { refused: `A room is at least ${ROOM_MIN_CM} cm on each side.` }
  const room = roomCorners(bounds)
  if (shape.outline.length < 3) {
    if (cut) return { refused: 'Draw the floor first: there is nothing to cut a room out of.' }
    return { shape: closedShape(room) }
  }
  const result = cut ? polygonClipping.difference(toPolygon(shape.outline), toPolygon(room)) : polygonClipping.union(toPolygon(shape.outline), toPolygon(room))
  if (result.length === 0) return { refused: 'That cut would remove the whole floor.' }
  if (result.length > 1) return { refused: cut ? 'That cut would split the floor in two.' : 'A new room must touch or overlap the floor.' }
  if (result[0]!.length > 1) return { refused: 'That would leave a hole in the floor: floors have one outline.' }
  const corners = tidyRing(result[0]![0]!)
  if (corners.length < 3 || Math.abs(signedArea(corners)) < 10_000) return { refused: 'That would leave too little floor.' }
  if (corners.length > LAYOUT_MAX_CORNERS) return { refused: `A floor has at most ${LAYOUT_MAX_CORNERS} corners.` }
  const sameWinding = Math.sign(signedArea(corners)) === Math.sign(signedArea(shape.outline))
  const oriented = sameWinding ? corners : [...corners].reverse()
  const outline = startNear(oriented, shape.outline[0]!)
  if (samePolygon(outline, shape.outline)) return { shape }
  return { shape: { outline, edges: carryEdges(shape, outline) } }
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

function samePolygon(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((point, index) => point.x === b[index]!.x && point.y === b[index]!.y)
}

function distanceToLine(point: Point, from: Point, to: Point): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  return Math.abs((to.x - from.x) * (from.y - point.y) - (from.x - point.x) * (to.y - from.y)) / length
}

/** How far along the line from `from` to `to` a point is, in centimetres. */
function along(point: Point, from: Point, to: Point): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / length
}

/**
 * Each new edge lying on an old one keeps that edge's kind and the doors and windows inside it,
 * measured again from its own start; any other edge is a new wall.
 */
function carryEdges(shape: FloorShape, outline: readonly Point[]): Edge[] {
  return outline.map((from, index) => {
    const to = outline[(index + 1) % outline.length]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    for (const [oldIndex, edge] of shape.edges.entries()) {
      const oldFrom = shape.outline[oldIndex]!
      const oldTo = shape.outline[(oldIndex + 1) % shape.outline.length]!
      if (distanceToLine(from, oldFrom, oldTo) > TOLERANCE_CM || distanceToLine(to, oldFrom, oldTo) > TOLERANCE_CM) continue
      const oldLength = Math.hypot(oldTo.x - oldFrom.x, oldTo.y - oldFrom.y)
      const start = along(from, oldFrom, oldTo)
      const end = along(to, oldFrom, oldTo)
      // Not within the old edge, or running the other way: not the same edge.
      if (start < -TOLERANCE_CM || end > oldLength + TOLERANCE_CM || end <= start) continue
      const openings: Opening[] = edge.openings
        .filter(opening => opening.offset >= start - TOLERANCE_CM && opening.offset + opening.width <= end + TOLERANCE_CM)
        .map(opening => ({ ...opening, offset: Math.max(0, Math.round(opening.offset - start)) }))
      return fitOpenings({ kind: edge.kind, openings }, Math.floor(length))
    }
    return { kind: 'wall', openings: [] }
  })
}
