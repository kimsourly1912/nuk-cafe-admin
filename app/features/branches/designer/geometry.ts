import type { Edge, Floor, Opening, Placement, Point, TableLook } from '#shared/contracts/shop-layout'
import { edgeLength, signedArea } from '#shared/contracts/shop-layout'
import { ITEM_SPECS } from './catalog'

/**
 * Layout geometry shared by the 2D editor and the 3D builders (D273). Pure functions in layout
 * units: centimetres, y pointing down, rotation in degrees clockwise.
 */

export const GRID_CM = 25
export const FINE_GRID_CM = 5
export const WALL_THICKNESS_CM = 20
export const DOOR_HEIGHT_CM = 210
export const WINDOW_SILL_CM = 90
export const WINDOW_TOP_CM = 220
export const RAILING_HEIGHT_CM = 105
/** How far a chair's centre sits outside its table's edge. */
const CHAIR_GAP_CM = 26
/** The room one chair takes along a table's side. */
const CHAIR_PITCH_CM = 55
/** A booth bench's depth on each long side. */
export const BOOTH_BENCH_DEPTH_CM = 55

export function snap(value: number, step: number = GRID_CM): number {
  return Math.round(value / step) * step
}

export function normalizeRotation(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360
}

/** Turns a point clockwise (on screen) around the origin. */
export function rotatePoint(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

export interface Pose {
  x: number
  y: number
  /** The way it faces, clockwise; a chair at 0° faces +y (down the screen), its back towards −y. */
  rotation: number
}

/**
 * Where a table's chairs stand, relative to the table's centre before the table turns: one per
 * seat, each facing the table. Round tables spread them evenly from the top; rectangles fill the
 * long sides, then the ends. A booth has benches instead, and a look without chairs has none.
 * Returns fewer than `seats` only when they can't fit.
 */
export function chairPoses(look: Pick<TableLook, 'shape' | 'chair'>, width: number, depth: number, seats: number): Pose[] {
  if (look.chair === 'none' || look.shape === 'booth' || seats < 1) return []
  if (look.shape === 'round') {
    const radius = Math.max(width, depth) / 2 + CHAIR_GAP_CM
    return Array.from({ length: seats }, (_, index) => {
      const angle = -90 + (index * 360) / seats
      const radians = (angle * Math.PI) / 180
      return { x: round(Math.cos(radians) * radius), y: round(Math.sin(radians) * radius), rotation: normalizeRotation(angle + 90) }
    })
  }
  // Long sides along x; a deeper-than-wide table works the same, turned.
  const turned = depth > width
  const length = turned ? depth : width
  const across = turned ? width : depth
  const perSide = Math.max(1, Math.floor(length / CHAIR_PITCH_CM))
  const sideSeats = Math.min(seats, perSide * 2)
  const ends = Math.min(2, seats - sideSeats)
  const near = Math.ceil(sideSeats / 2)
  const far = sideSeats - near
  const poses: Pose[] = [
    ...spread(near, length).map(along => ({ x: along, y: -(across / 2 + CHAIR_GAP_CM), rotation: 0 })),
    ...spread(far, length).map(along => ({ x: along, y: across / 2 + CHAIR_GAP_CM, rotation: 180 })),
  ]
  if (ends >= 1) poses.push({ x: -(length / 2 + CHAIR_GAP_CM), y: 0, rotation: 270 })
  if (ends >= 2) poses.push({ x: length / 2 + CHAIR_GAP_CM, y: 0, rotation: 90 })
  return turned ? poses.map(pose => ({ ...rotatePoint(pose, 90), rotation: normalizeRotation(pose.rotation + 90) })) : poses
}

function spread(count: number, length: number): number[] {
  return Array.from({ length: count }, (_, index) => round((index + 0.5) * (length / count) - length / 2))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** The rectangle a placed table takes with its chairs or benches, before it turns. */
export function placementExtent(placement: Pick<Placement, 'width' | 'depth'>, look: Pick<TableLook, 'shape' | 'chair'>): { width: number, depth: number } {
  if (look.shape === 'booth') return { width: placement.width, depth: placement.depth + BOOTH_BENCH_DEPTH_CM * 2 }
  if (look.chair === 'none') return { width: placement.width, depth: placement.depth }
  const reach = (CHAIR_GAP_CM + 25) * 2
  return { width: placement.width + reach, depth: placement.depth + reach }
}

/** A turned rectangle's corners around its centre. */
export function rectCorners(center: Point, width: number, depth: number, rotation: number): Point[] {
  return [
    { x: -width / 2, y: -depth / 2 },
    { x: width / 2, y: -depth / 2 },
    { x: width / 2, y: depth / 2 },
    { x: -width / 2, y: depth / 2 },
  ].map((corner) => {
    const turned = rotatePoint(corner, rotation)
    return { x: center.x + turned.x, y: center.y + turned.y }
  })
}

/** A piece on the plan: where it stands, how it's turned and its size. */
export interface Sized extends Pose {
  width: number
  depth: number
}

export interface ResizeOptions {
  /** Which corner is dragged, in `rectCorners` order (0 top-left before turning, then clockwise). */
  corner: number
  /** How far the pointer moved, in plan centimetres. */
  delta: Point
  /** Round pieces stay round: width and depth change together. */
  round: boolean
  min: number
  max: number
}

/**
 * A corner handle dragged on the plan (D273, frame 2B): the opposite corner stays where it is, so
 * the centre moves by half the change. Sizes snap to 5 cm (the panel's step) within the limits; the
 * centre is rounded to whole centimetres, as the layout stores it.
 */
export function resizeFromCorner(start: Sized, options: ResizeOptions): Sized {
  const { corner, delta, min, max } = options
  const sx = corner === 1 || corner === 2 ? 1 : -1
  const sy = corner >= 2 ? 1 : -1
  // The pointer's move in the piece's own (unturned) directions, outwards from the centre.
  const local = rotatePoint(delta, -start.rotation)
  const along = { x: sx * local.x, y: sy * local.y }
  const fit = (value: number) => Math.min(max, Math.max(min, snap(value, FINE_GRID_CM)))
  let width = fit(start.width + along.x)
  let depth = fit(start.depth + along.y)
  if (options.round) width = depth = fit(start.width + (Math.abs(along.x) >= Math.abs(along.y) ? along.x : along.y))
  const shift = rotatePoint({ x: (sx * (width - start.width)) / 2, y: (sy * (depth - start.depth)) / 2 }, start.rotation)
  return { x: Math.round(start.x + shift.x), y: Math.round(start.y + shift.y), rotation: start.rotation, width, depth }
}

/**
 * Where a copy of a piece goes (Duplicate): beside it on the right, clear of it by about one grid
 * step, turned the same way. `width` and `depth` are what it takes up (a table's chairs included).
 */
export function besideOf(pose: Pose, width: number, depth: number): Point {
  const xs = rectCorners({ x: 0, y: 0 }, width, depth, pose.rotation).map(corner => corner.x)
  return { x: snap(pose.x + Math.max(...xs) - Math.min(...xs) + GRID_CM), y: pose.y }
}

export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!
    const b = polygon[previous]!
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function boundsOf(points: readonly Point[]): Bounds {
  return points.reduce<Bounds>((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
}

export function centroid(points: readonly Point[]): Point {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/** The unit vector pointing out of the floor from edge `index`, whichever way the outline runs. */
export function outwardNormal(outline: readonly Point[], index: number): Point {
  const from = outline[index]!
  const to = outline[(index + 1) % outline.length]!
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  const dx = (to.x - from.x) / length
  const dy = (to.y - from.y) / length
  return signedArea(outline) >= 0 ? { x: dy, y: -dx } : { x: -dy, y: dx }
}

/** A point along edge `index`, `distance` from its start corner. */
export function pointOnEdge(outline: readonly Point[], index: number, distance: number): Point {
  const from = outline[index]!
  const to = outline[(index + 1) % outline.length]!
  const length = edgeLength(outline, index) || 1
  return { x: from.x + ((to.x - from.x) * distance) / length, y: from.y + ((to.y - from.y) * distance) / length }
}

/** A solid piece of wall, in centimetres along the edge and above the floor. */
export interface WallPiece {
  from: number
  to: number
  bottom: number
  top: number
}

/**
 * A wall as solid pieces around its doors and windows: no holes are cut. A door leaves the wall
 * above it; a window leaves the wall below its sill and above its head.
 */
export function wallPieces(length: number, height: number, openings: readonly Opening[]): WallPiece[] {
  const pieces: WallPiece[] = []
  let cursor = 0
  for (const opening of [...openings].sort((a, b) => a.offset - b.offset)) {
    const start = Math.max(cursor, opening.offset)
    const end = Math.min(length, opening.offset + opening.width)
    if (end <= start) continue
    if (start > cursor) pieces.push({ from: cursor, to: start, bottom: 0, top: height })
    if (opening.kind === 'window') pieces.push({ from: start, to: end, bottom: 0, top: Math.min(WINDOW_SILL_CM, height) })
    const head = Math.min(opening.kind === 'door' ? DOOR_HEIGHT_CM : WINDOW_TOP_CM, height)
    if (head < height) pieces.push({ from: start, to: end, bottom: head, top: height })
    cursor = end
  }
  if (cursor < length) pieces.push({ from: cursor, to: length, bottom: 0, top: height })
  return pieces
}

export interface Viewpoint {
  id: string
  label: string
  /** Where the eye stands and what it looks at, on the floor's plan. */
  eye: Point
  target: Point
}

/**
 * The preset viewpoints inside a floor, worked out from its layout: the front door, the top of the
 * stairs (from the floor below on an upper floor) and the longest window. A floor without a door has
 * no Entrance.
 */
export function floorViewpoints(floor: Floor, floorBelow?: Floor): Viewpoint[] {
  const middle = centroid(floor.outline)
  const points: Viewpoint[] = []
  const inside = (index: number, along: number, inward: number): Point => {
    const point = pointOnEdge(floor.outline, index, along)
    const normal = outwardNormal(floor.outline, index)
    return { x: point.x - normal.x * inward, y: point.y - normal.y * inward }
  }
  const door = findOpening(floor.edges, 'door')
  if (door) points.push({ id: 'entrance', label: 'Entrance', eye: inside(door.index, door.opening.offset + door.opening.width / 2, 120), target: middle })
  const stairs = [...(floorBelow?.items ?? []), ...floor.items].find(item => item.kind === 'stairs' && pointInPolygon(item, floor.outline))
  if (stairs) {
    const top = rotatePoint({ x: 0, y: -ITEM_SPECS.stairs.depth / 2 + 40 }, stairs.rotation)
    points.push({ id: 'stairs', label: 'Top of stairs', eye: { x: stairs.x + top.x + 60, y: stairs.y + top.y + 60 }, target: middle })
  }
  const window = findOpening(floor.edges, 'window', true)
  if (window) {
    const eye = inside(window.index, window.opening.offset + window.opening.width / 2, 90)
    points.push({ id: 'window', label: 'Window side', eye, target: { x: 2 * middle.x - eye.x, y: 2 * middle.y - eye.y } })
  }
  if (!points.length) points.push({ id: 'centre', label: 'Middle', eye: middle, target: { x: middle.x, y: middle.y - 100 } })
  return points
}

function findOpening(edges: readonly Edge[], kind: Opening['kind'], longest = false): { index: number, opening: Opening } | undefined {
  let found: { index: number, opening: Opening } | undefined
  edges.forEach((edge, index) => {
    for (const opening of edge.openings) {
      if (opening.kind !== kind) continue
      if (!found || (longest && opening.width > found.opening.width)) found = { index, opening }
    }
  })
  return found
}

/** A new id for a floor, wall or item: unique enough within one layout. */
export function newLayoutId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}
