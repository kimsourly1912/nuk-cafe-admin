import type { Floor, LayoutItem, Point, TableLook } from '#shared/contracts/shop-layout'
import { edgeLength, isFigureKind } from '#shared/contracts/shop-layout'
import { ITEM_SPECS } from './catalog'
import type { Bounds, Pose, Sized } from './geometry'
import { BOOTH_BENCH_DEPTH_CM, boundsOf, outwardNormal, pointInPolygon, pointOnEdge, rectCorners, rotatePoint, WALL_THICKNESS_CM, wallPieces } from './geometry'

const EPSILON = 1e-7
type FloorShape = Pick<Floor, 'outline' | 'edges' | 'walls' | 'height'>

interface PlanFootprint {
  id: string
  parts: readonly Point[][]
}

interface PlacementWarning {
  outside: boolean
  overlap: boolean
}

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

function footprint(piece: Sized, round: boolean): Point[] {
  if (!round) return rectCorners(piece, piece.width, piece.depth, piece.rotation)
  return Array.from({ length: 24 }, (_, index) => {
    const angle = index * Math.PI / 12
    const point = rotatePoint({ x: Math.cos(angle) * piece.width / 2, y: Math.sin(angle) * piece.depth / 2 }, piece.rotation)
    return { x: piece.x + point.x, y: piece.y + point.y }
  })
}

/**
 * A piece's footprint for the warnings. People and pets (step 3g) have none: a customer on a chair
 * or a cat under a table is where they belong, so they neither warn nor make others warn.
 */
export function itemFootprint(item: Pick<LayoutItem, 'id' | 'kind'> & Sized): PlanFootprint {
  if (isFigureKind(item.kind)) return { id: item.id, parts: [] }
  return { id: item.id, parts: [footprint(item, ITEM_SPECS[item.kind].footprint === 'round')] }
}

export function tableFootprint(table: Sized & { tableId: string }, look: Pick<TableLook, 'shape' | 'chair'>, chairs: readonly Pose[]): PlanFootprint {
  const parts = [footprint(table, look.shape === 'round')]
  const append = (pose: Pose, width: number, depth: number) => {
    const offset = rotatePoint(pose, table.rotation)
    parts.push(rectCorners({ x: table.x + offset.x, y: table.y + offset.y }, width, depth, table.rotation + pose.rotation))
  }
  if (look.chair !== 'none') {
    const { width, depth } = ITEM_SPECS[look.chair]
    for (const chair of chairs) append(chair, width, depth)
  }
  if (look.shape === 'booth') {
    const offset = (table.depth + BOOTH_BENCH_DEPTH_CM) / 2
    for (const y of [-offset, offset]) append({ x: 0, y, rotation: 0 }, table.width + 10, BOOTH_BENCH_DEPTH_CM)
  }
  return { id: table.tableId, parts }
}

function onSegment(point: Point, from: Point, to: Point): boolean {
  const length = subtract(to, from)
  const offset = subtract(point, from)
  const projection = dot(offset, length)
  if (dot(length, length) < EPSILON) return dot(offset, offset) < EPSILON
  return Math.abs(cross(length, offset)) < EPSILON && projection >= -EPSILON && projection <= dot(length, length) + EPSILON
}

/** Split each footprint edge at boundary crossings so a concave corner cannot hide between its ends. */
function insideOutline(points: Point[], outline: Point[]): boolean {
  const contains = (point: Point) => pointInPolygon(point, outline) || outline.some((from, index) => onSegment(point, from, outline[(index + 1) % outline.length]!))
  if (!points.every(contains)) return false
  return points.every((from, index) => {
    const direction = subtract(points[(index + 1) % points.length]!, from)
    const splits = [0, 1]
    for (const [side, start] of outline.entries()) {
      const end = outline[(side + 1) % outline.length]!
      const edge = subtract(end, start)
      const offset = subtract(start, from)
      const determinant = cross(direction, edge)
      if (Math.abs(determinant) < EPSILON) {
        if (Math.abs(cross(direction, offset)) < EPSILON) {
          const t = dot(direction, offset) / dot(direction, direction)
          if (t > 0 && t < 1) splits.push(t)
        }
        continue
      }
      const t = cross(offset, edge) / determinant
      const u = cross(offset, direction) / determinant
      if (t > 0 && t < 1 && u >= 0 && u <= 1) splits.push(t)
    }
    splits.sort((a, b) => a - b)
    return splits.slice(1).every((end, step) => {
      const t = (splits[step]! + end) / 2
      return contains({ x: from.x + direction.x * t, y: from.y + direction.y * t })
    })
  })
}

function wallFootprints(floor: FloorShape): Point[][] {
  const walls: Point[][] = []
  const append = (from: Point, to: Point, shift: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length <= EPSILON) return
    const center = { x: (from.x + to.x) / 2 + shift.x, y: (from.y + to.y) / 2 + shift.y }
    const rotation = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI
    walls.push(rectCorners(center, length, WALL_THICKNESS_CM, rotation))
  }
  for (const wall of floor.walls) append(wall.from, wall.to, { x: 0, y: 0 })
  for (const [index, edge] of floor.edges.entries()) {
    if (edge.kind !== 'wall') continue
    const normal = outwardNormal(floor.outline, index)
    const shift = { x: normal.x * WALL_THICKNESS_CM / 2, y: normal.y * WALL_THICKNESS_CM / 2 }
    for (const part of wallPieces(edgeLength(floor.outline, index), floor.height, edge.openings)) {
      if (part.bottom === 0) append(pointOnEdge(floor.outline, index, part.from), pointOnEdge(floor.outline, index, part.to), shift)
    }
  }
  return walls
}

interface Polygon {
  points: Point[]
  bounds: Bounds
}

const polygon = (points: Point[]): Polygon => ({ points, bounds: boundsOf(points) })
const intersects = (a: Bounds, b: Bounds) => a.minX < b.maxX - EPSILON && b.minX < a.maxX - EPSILON && a.minY < b.maxY - EPSILON && b.minY < a.maxY - EPSILON

/** These footprints are convex. A separating edge on either part means they can touch without overlapping. */
function overlaps(a: Polygon, b: Polygon): boolean {
  if (!intersects(a.bounds, b.bounds)) return false
  function separates(from: Polygon, to: Polygon) {
    return from.points.some((point, index) => {
      const edge = subtract(from.points[(index + 1) % from.points.length]!, point)
      const normal = { x: -edge.y, y: edge.x }
      const near = from.points.map(vertex => dot(normal, vertex))
      const far = to.points.map(vertex => dot(normal, vertex))
      return Math.max(...near) <= Math.min(...far) + EPSILON || Math.max(...far) <= Math.min(...near) + EPSILON
    })
  }
  return !separates(a, b) && !separates(b, a)
}

export function placementWarnings(floor: FloorShape, footprints: readonly PlanFootprint[], preview?: PlanFootprint): Map<string, PlacementWarning> {
  const warnings = new Map<string, PlacementWarning>()
  if (floor.outline.length < 3) return warnings
  const walls = wallFootprints(floor).map(polygon)
  const items = footprints.map(piece => ({ id: piece.id, parts: piece.parts.map(polygon), bounds: boundsOf(piece.parts.flat()) }))
  const subjects = preview ? [{ id: preview.id, parts: preview.parts.map(polygon), bounds: boundsOf(preview.parts.flat()) }] : items
  for (const item of subjects) {
    const outside = item.parts.some(part => !insideOutline(part.points, floor.outline))
    const overlap = item.parts.some(part => walls.some(wall => overlaps(part, wall))) || items.some(other =>
      other.id !== item.id && intersects(item.bounds, other.bounds) && item.parts.some(part => other.parts.some(blocker => overlaps(part, blocker))),
    )
    if (outside || overlap) warnings.set(item.id, { outside, overlap })
  }
  return warnings
}
