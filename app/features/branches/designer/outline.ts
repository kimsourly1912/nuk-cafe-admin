import type { Edge, EdgeKind, Floor, Opening, OpeningKind, Point } from '#shared/contracts/shop-layout'
import { edgeLength, signedArea } from '#shared/contracts/shop-layout'
import { snap } from './geometry'

/**
 * Editing a floor's outline (D273, frames 3A, 3B): corners, the kind of each edge, and the doors
 * and windows on it. Pure functions in layout units that return new values, so each edit is one
 * draft change (one undo step). Edge `i` runs from corner `i` to corner `i + 1`; every function
 * keeps `edges` the same length as `outline` and every opening inside its edge.
 */

export interface FloorShape {
  outline: Point[]
  edges: Edge[]
}

/** The width a new door or window starts with (the mockup's library: Door 90 cm, Window 180 cm). */
export const OPENING_DEFAULT_WIDTH: Record<OpeningKind, number> = { door: 90, window: 180 }
export const OPENING_MIN_WIDTH = 40
/** Corners closer than this to the shape's first corner close it while drawing. */
export const CLOSE_DISTANCE_CM = 30

/** A new outline from drawn corners: every edge a wall, no doors or windows yet. */
export function closedShape(corners: readonly Point[]): FloorShape {
  return { outline: corners.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })), edges: corners.map(() => ({ kind: 'wall', openings: [] })) }
}

/** Whether the drawn corners make a floor: three or more with an area (the contract's 1 m²). */
export function canClose(corners: readonly Point[]): boolean {
  return corners.length >= 3 && Math.abs(signedArea(corners)) >= 10_000
}

/**
 * Moves corner `index` to `to`. With `square`, the corners next to it follow so that edges that
 * ran straight across or down still do (an L-shape stays an L-shape, frame 3A); without, only the
 * corner moves. Openings are fitted to the new lengths.
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
  return { outline, edges: fitEdges(outline, shape.edges) }
}

/**
 * A new corner in the middle of edge `index` (the edge's round handle, frame 3A), snapped to the
 * grid. Both halves keep the edge's kind; each opening goes to the half holding its middle.
 */
export function insertCorner(shape: FloorShape, index: number): FloorShape {
  const count = shape.outline.length
  const from = shape.outline[index]!
  const to = shape.outline[(index + 1) % count]!
  const middle = { x: snap((from.x + to.x) / 2), y: snap((from.y + to.y) / 2) }
  const outline = [...shape.outline.slice(0, index + 1), middle, ...shape.outline.slice(index + 1)].map(point => ({ ...point }))
  const split = Math.hypot(middle.x - from.x, middle.y - from.y)
  const edge = shape.edges[index]!
  const first: Opening[] = []
  const second: Opening[] = []
  for (const opening of edge.openings) {
    if (opening.offset + opening.width / 2 <= split) first.push({ ...opening })
    else second.push({ ...opening, offset: Math.max(0, Math.round(opening.offset - split)) })
  }
  const edges = [
    ...shape.edges.slice(0, index).map(cloneEdge),
    { kind: edge.kind, openings: first },
    { kind: edge.kind, openings: second },
    ...shape.edges.slice(index + 1).map(cloneEdge),
  ]
  return { outline, edges: fitEdges(outline, edges) }
}

/**
 * Removes corner `index`: the edges on either side become one, of the earlier edge's kind, with
 * the openings of both that still fit. A floor keeps at least three corners.
 */
export function removeCorner(shape: FloorShape, index: number): FloorShape {
  const count = shape.outline.length
  if (count <= 3) return shape
  const before = (index - 1 + count) % count
  const beforeLength = edgeLength(shape.outline, before)
  const merged: Edge = {
    kind: shape.edges[before]!.kind,
    openings: [
      ...shape.edges[before]!.openings.map(opening => ({ ...opening })),
      ...shape.edges[index]!.openings.map(opening => ({ ...opening, offset: Math.round(opening.offset + beforeLength) })),
    ],
  }
  const outline = shape.outline.filter((_, position) => position !== index).map(point => ({ ...point }))
  const edges = shape.edges.map(cloneEdge)
  edges[before] = merged
  edges.splice(index, 1)
  // Removing corner 0 merges the last edge with the first: the merged edge is now the last one.
  return { outline, edges: fitEdges(outline, edges) }
}

/**
 * Sets edge `index` to `length` by moving its end corner along the edge (and, with `square`, the
 * corners next to that one, as `moveCorner`). A zero-length edge has no direction and is left.
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

/**
 * Changes what an edge is (3B). Open edges have nothing on them; a railing keeps its doors (gates)
 * and loses its windows, which need a wall.
 */
export function setEdgeKind(shape: FloorShape, index: number, kind: EdgeKind): FloorShape {
  const edges = shape.edges.map(cloneEdge)
  const edge = edges[index]!
  edge.kind = kind
  if (kind === 'open') edge.openings = []
  if (kind === 'railing') edge.openings = edge.openings.filter(opening => opening.kind === 'door')
  return { outline: shape.outline, edges }
}

/** Whether an edge of this kind takes this opening: windows need a wall, an open edge takes none. */
export function edgeTakes(kind: EdgeKind, opening: OpeningKind): boolean {
  return kind === 'wall' || (kind === 'railing' && opening === 'door')
}

/**
 * Where a new opening of `width` fits on an edge: centred in the widest free stretch, or `null`
 * when no stretch is wide enough.
 */
export function freeSpot(edge: Edge, length: number, width: number): number | null {
  let best: { start: number, size: number } | null = null
  let cursor = 0
  for (const opening of [...edge.openings].sort((a, b) => a.offset - b.offset)) {
    if (opening.offset - cursor > (best?.size ?? -1)) best = { start: cursor, size: opening.offset - cursor }
    cursor = Math.max(cursor, opening.offset + opening.width)
  }
  if (length - cursor > (best?.size ?? -1)) best = { start: cursor, size: length - cursor }
  if (!best || best.size < width) return null
  return Math.floor(best.start + (best.size - width) / 2)
}

/**
 * Whether edge `index` can take a new door or window: the edge's kind allows it (windows need a
 * wall) and a free spot of the default width, or of the whole edge when shorter, is left.
 */
export function openingFits(shape: FloorShape, index: number, kind: OpeningKind): boolean {
  const edge = shape.edges[index]
  if (!edge || !edgeTakes(edge.kind, kind)) return false
  const length = Math.round(edgeLength(shape.outline, index))
  return length >= OPENING_MIN_WIDTH && freeSpot(edge, length, Math.min(OPENING_DEFAULT_WIDTH[kind], length)) !== null
}

/** Adds a door or window to edge `index` where it fits; the shape unchanged when it doesn't. */
export function addOpening(shape: FloorShape, index: number, kind: OpeningKind, id: string): FloorShape {
  const edge = shape.edges[index]!
  if (!edgeTakes(edge.kind, kind)) return shape
  const length = Math.floor(edgeLength(shape.outline, index))
  const width = Math.min(OPENING_DEFAULT_WIDTH[kind], length)
  const offset = width >= OPENING_MIN_WIDTH ? freeSpot(edge, length, width) : null
  if (offset === null) return shape
  const edges = shape.edges.map(cloneEdge)
  edges[index]!.openings.push({ id, kind, offset, width })
  return { outline: shape.outline, edges }
}

/**
 * Changes one opening's offset or width, then fits the edge: the changed opening keeps its place
 * and the others move out of its way (or go, when the edge is full).
 */
export function updateOpening(shape: FloorShape, index: number, id: string, change: Partial<Pick<Opening, 'offset' | 'width'>>): FloorShape {
  const length = Math.floor(edgeLength(shape.outline, index))
  const edges = shape.edges.map(cloneEdge)
  const edge = edges[index]!
  const opening = edge.openings.find(candidate => candidate.id === id)
  if (!opening) return shape
  opening.width = clamp(Math.round(change.width ?? opening.width), OPENING_MIN_WIDTH, Math.max(OPENING_MIN_WIDTH, length))
  opening.offset = clamp(Math.round(change.offset ?? opening.offset), 0, Math.max(0, length - opening.width))
  edge.openings = [opening, ...edge.openings.filter(candidate => candidate !== opening)]
  edges[index] = fitOpenings(edge, length)
  return { outline: shape.outline, edges }
}

export function removeOpening(shape: FloorShape, index: number, id: string): FloorShape {
  const edges = shape.edges.map(cloneEdge)
  edges[index]!.openings = edges[index]!.openings.filter(opening => opening.id !== id)
  return { outline: shape.outline, edges }
}

/**
 * Keeps an edge's openings inside it and apart, in their order of importance (first kept first):
 * each keeps its place when it can, moves along when it overlaps, and goes when there is no room.
 * Whole centimetres, as the contract wants.
 */
export function fitOpenings(edge: Edge, length: number): Edge {
  const room = Math.floor(length)
  const placed: Opening[] = []
  for (const opening of edge.openings) {
    const width = Math.min(opening.width, room)
    if (width < OPENING_MIN_WIDTH) continue
    const offset = firstFreeOffset(placed, clamp(Math.round(opening.offset), 0, room - width), width, room)
    if (offset !== null) placed.push({ ...opening, offset, width })
  }
  return { kind: edge.kind, openings: placed.sort((a, b) => a.offset - b.offset) }
}

function firstFreeOffset(placed: readonly Opening[], wanted: number, width: number, room: number): number | null {
  const fits = (offset: number) => offset >= 0 && offset + width <= room && placed.every(other => offset + width <= other.offset || offset >= other.offset + other.width)
  if (fits(wanted)) return wanted
  // The nearest free place: just after or just before each opening already placed.
  const candidates = placed.flatMap(other => [other.offset + other.width, other.offset - width]).filter(fits)
  if (!candidates.length) return null
  return candidates.reduce((best, offset) => (Math.abs(offset - wanted) < Math.abs(best - wanted) ? offset : best))
}

function fitEdges(outline: readonly Point[], edges: readonly Edge[]): Edge[] {
  return edges.map((edge, index) => fitOpenings(edge, edgeLength(outline, index)))
}

/**
 * What to call an edge in the editor, by the way it faces in the top-down view: Front (down the
 * screen), Back, Left or Right, numbered when several face the same way ("Front edge 2").
 */
export function edgeNames(outline: readonly Point[]): string[] {
  const clockwise = signedArea(outline) >= 0
  const facings = outline.map((from, index) => {
    const to = outline[(index + 1) % outline.length]!
    const dx = to.x - from.x
    const dy = to.y - from.y
    // The outward normal, as `outwardNormal` (geometry.ts) works it out.
    const nx = clockwise ? dy : -dy
    const ny = clockwise ? -dx : dx
    if (Math.abs(ny) >= Math.abs(nx)) return ny > 0 ? 'Front' : 'Back'
    return nx > 0 ? 'Right' : 'Left'
  })
  const totals = new Map<string, number>()
  for (const facing of facings) totals.set(facing, (totals.get(facing) ?? 0) + 1)
  const seen = new Map<string, number>()
  return facings.map((facing) => {
    const number = (seen.get(facing) ?? 0) + 1
    seen.set(facing, number)
    return totals.get(facing)! > 1 ? `${facing} edge ${number}` : `${facing} edge`
  })
}

/** The floor's area in square metres, rounded. */
export function areaM2(outline: readonly Point[]): number {
  return Math.round(Math.abs(signedArea(outline)) / 10_000)
}

/** A floor's outline and edges, the part these functions edit. */
export function shapeOf(floor: Pick<Floor, 'outline' | 'edges'>): FloorShape {
  return { outline: floor.outline, edges: floor.edges }
}

function cloneEdge(edge: Edge): Edge {
  return { kind: edge.kind, openings: edge.openings.map(opening => ({ ...opening })) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
