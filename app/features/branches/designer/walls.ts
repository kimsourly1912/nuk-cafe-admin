import type { DoorHinge, DoorSwing, Floor, Opening, OpeningKind, Point, Slab, Wall, WallKind, WallSide } from '#shared/contracts/shop-layout'
import { signedArea, wallKind, wallLength } from '#shared/contracts/shop-layout'
import { newLayoutId, pointAlongWall, pointInPolygon, WALL_THICKNESS_CM, wallBand, wallNormal, wallStrip, wallThickness } from './geometry'
import type { WallSegment } from './geometry'

/**
 * Walls as pure functions (D278, D282): outer and inside walls alike, with their kind, length,
 * thickness, height, doors and windows, and moving their ends or whole walls. Ends that touch
 * another wall's end are joined: they move together, so a corner stays closed. A floor surface's
 * corner and a wall's end on the same point are joined the same way (`followPoints`). Every result
 * is a new list of plain objects (one undo step each).
 */

/** Ends this close (cm) count as joined. */
export const JOIN_DISTANCE_CM = 1

const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_DISTANCE_CM

/** The width a new door or window starts with (the mockup's library: Door 90 cm, Window 180 cm). */
export const OPENING_DEFAULT_WIDTH: Record<OpeningKind, number> = { door: 90, window: 180 }
export const OPENING_MIN_WIDTH = 40

/** Whether this kind takes this opening: only a full wall takes windows (D278). */
export function wallTakes(kind: WallKind, opening: OpeningKind): boolean {
  return opening === 'door' || kind === 'wall'
}

/**
 * Where a new opening of `width` fits on a wall: centred in the widest free stretch, or `null`
 * when no stretch is wide enough.
 */
export function freeSpot(openings: readonly Opening[], length: number, width: number): number | null {
  let best: { start: number, size: number } | null = null
  let cursor = 0
  for (const opening of [...openings].sort((a, b) => a.offset - b.offset)) {
    if (opening.offset - cursor > (best?.size ?? -1)) best = { start: cursor, size: opening.offset - cursor }
    cursor = Math.max(cursor, opening.offset + opening.width)
  }
  if (length - cursor > (best?.size ?? -1)) best = { start: cursor, size: length - cursor }
  if (!best || best.size < width) return null
  return Math.floor(best.start + (best.size - width) / 2)
}

/**
 * Keeps a wall's openings inside it and apart, in their order of importance (first kept first):
 * each keeps its place when it can, moves along when it overlaps, and goes when there is no room.
 * Whole centimetres, as the contract wants.
 */
export function fitOpenings(openings: readonly Opening[], length: number): Opening[] {
  const room = Math.floor(length)
  const placed: Opening[] = []
  for (const opening of openings) {
    const width = Math.min(opening.width, room)
    if (width < OPENING_MIN_WIDTH) continue
    const offset = firstFreeOffset(placed, clamp(Math.round(opening.offset), 0, room - width), width, room)
    if (offset !== null) placed.push({ ...opening, offset, width })
  }
  return placed.sort((a, b) => a.offset - b.offset)
}

function firstFreeOffset(placed: readonly Opening[], wanted: number, width: number, room: number): number | null {
  const fits = (offset: number) => offset >= 0 && offset + width <= room && placed.every(other => offset + width <= other.offset || offset >= other.offset + other.width)
  if (fits(wanted)) return wanted
  // The nearest free place: just after or just before each opening already placed.
  const candidates = placed.flatMap(other => [other.offset + other.width, other.offset - width]).filter(fits)
  if (!candidates.length) return null
  return candidates.reduce((best, offset) => (Math.abs(offset - wanted) < Math.abs(best - wanted) ? offset : best))
}

/**
 * The wall as saved, with these changes: `kind`, `openings`, `side`, `thickness` and `height` only
 * when they say something (a plain wall has none). Its name and layer flags stay.
 */
function tidy(wall: Wall, changes: Partial<Wall> = {}): Wall {
  const next = { ...wall, ...changes }
  const { kind: _kind, openings: _openings, side: _side, thickness: _thickness, height: _height, ...rest } = next
  const kind = wallKind(next)
  const openings = next.openings ?? []
  return {
    ...rest,
    from: { ...next.from },
    to: { ...next.to },
    ...(kind !== 'wall' && { kind }),
    ...(openings.length > 0 && { openings: openings.map(opening => ({ ...opening })) }),
    ...(next.side && { side: next.side }),
    ...(next.thickness && { thickness: next.thickness }),
    ...(next.height && { height: next.height }),
  }
}

/** Its openings kept inside it and apart, after a change of length (the first kept first). */
function refit(wall: Wall): Wall {
  return tidy(wall, { openings: fitOpenings(wall.openings ?? [], Math.floor(wallLength(wall))) })
}

function replace(walls: readonly Wall[], id: string, change: (wall: Wall) => Wall): Wall[] {
  return walls.map(wall => (wall.id === id ? change(wall) : tidy(wall)))
}

/** Another kind: a railing, half wall or glass keeps its doors (gaps or gates) and loses its windows. */
export function setWallKind(walls: readonly Wall[], id: string, kind: WallKind): Wall[] {
  return replace(walls, id, wall => tidy(wall, { kind, openings: (wall.openings ?? []).filter(opening => wallTakes(kind, opening.kind)) }))
}

/** Its length, from its start: the end moves along the wall (joined ends don't follow; type it again there). */
export function setWallLength(walls: readonly Wall[], id: string, length: number): Wall[] {
  return replace(walls, id, (wall) => {
    const current = wallLength(wall)
    if (current <= 0) return wall
    const scale = Math.max(1, Math.round(length)) / current
    const to = { x: Math.round(wall.from.x + (wall.to.x - wall.from.x) * scale), y: Math.round(wall.from.y + (wall.to.y - wall.from.y) * scale) }
    return refit({ ...wall, to })
  })
}

/** What a wall is built as (D282, owner D3): its own thickness, height and side; `null` puts the kind's back (centred). */
export interface WallStructure {
  thickness?: number | null
  height?: number | null
  side?: WallSide | null
}

export function setWallStructure(walls: readonly Wall[], id: string, change: WallStructure): Wall[] {
  return replace(walls, id, (wall) => {
    const pick = <K extends keyof WallStructure>(key: K) => (change[key] === undefined ? wall[key] : change[key] ?? undefined)
    return tidy({ ...wall, thickness: pick('thickness') as number | undefined, height: pick('height') as number | undefined, side: pick('side') as WallSide | undefined })
  })
}

/** Whether a door or window of this kind has a free spot on the wall. */
export function wallOpeningFits(wall: Wall, kind: OpeningKind): boolean {
  if (!wallTakes(wallKind(wall), kind)) return false
  const length = Math.floor(wallLength(wall))
  const width = Math.min(OPENING_DEFAULT_WIDTH[kind], length)
  return width >= OPENING_MIN_WIDTH && freeSpot(wall.openings ?? [], length, width) !== null
}

/** A door or window at the first free spot; nothing changes when there is none. */
export function addWallOpening(walls: readonly Wall[], id: string, kind: OpeningKind, openingId: string): Wall[] {
  return replace(walls, id, (wall) => {
    if (!wallOpeningFits(wall, kind)) return wall
    const length = Math.floor(wallLength(wall))
    const width = Math.min(OPENING_DEFAULT_WIDTH[kind], length)
    const offset = freeSpot(wall.openings ?? [], length, width)!
    return tidy(wall, { openings: [...(wall.openings ?? []), { id: openingId, kind, offset, width }] })
  })
}

/** One opening's width or place; the others move out of its way (or go, when the wall is full). */
export function updateWallOpening(walls: readonly Wall[], id: string, openingId: string, change: Partial<Pick<Opening, 'offset' | 'width'>>): Wall[] {
  return replace(walls, id, (wall) => {
    const length = Math.floor(wallLength(wall))
    const openings = (wall.openings ?? []).map(opening => ({ ...opening }))
    const opening = openings.find(candidate => candidate.id === openingId)
    if (!opening) return wall
    opening.width = Math.min(Math.max(Math.round(change.width ?? opening.width), OPENING_MIN_WIDTH), Math.max(OPENING_MIN_WIDTH, length))
    opening.offset = Math.min(Math.max(Math.round(change.offset ?? opening.offset), 0), Math.max(0, length - opening.width))
    const ordered = [opening, ...openings.filter(candidate => candidate !== opening)]
    return tidy(wall, { openings: fitOpenings(ordered, length) })
  })
}

/** How a door or window is built (owner D3): its height, a window's sill, a door's swing, hinge and leaf. `null` puts the default back. */
export interface OpeningShape {
  height?: number | null
  sill?: number | null
  swing?: DoorSwing
  hinge?: DoorHinge
  /** False: an open doorway, no leaf. */
  leaf?: boolean
}

/**
 * Changes how one opening is built, keeping only what says something (D282): defaults are left
 * out (`swing: 'in'`, `hinge: 'start'`, a leaf), as the contract saves them; a sill or a leaf only
 * where the kind has one.
 */
export function setOpeningShape(walls: readonly Wall[], id: string, openingId: string, change: OpeningShape): Wall[] {
  return replace(walls, id, wall => tidy(wall, {
    openings: (wall.openings ?? []).map((opening) => {
      if (opening.id !== openingId) return opening
      const { height: _height, sill: _sill, swing: _swing, hinge: _hinge, leaf: _leaf, ...base } = opening
      const pick = <K extends keyof OpeningShape>(key: K, current: OpeningShape[K]) => (change[key] === undefined ? current : change[key])
      const height = pick('height', opening.height)
      const sill = pick('sill', opening.sill)
      const swing = pick('swing', opening.swing)
      const hinge = pick('hinge', opening.hinge)
      const leaf = pick('leaf', opening.leaf)
      const door = opening.kind === 'door'
      return {
        ...base,
        ...(height != null && { height: Math.round(height) }),
        ...(!door && sill != null && { sill: Math.round(sill) }),
        ...(door && swing === 'out' && { swing: 'out' as const }),
        ...(door && hinge === 'end' && { hinge: 'end' as const }),
        ...(door && leaf === false && { leaf: false as const }),
      }
    }),
  }))
}

export function removeWallOpening(walls: readonly Wall[], id: string, openingId: string): Wall[] {
  return replace(walls, id, wall => tidy(wall, { openings: (wall.openings ?? []).filter(opening => opening.id !== openingId) }))
}

/**
 * Moves one end of a wall to `to`; any other wall's end joined to it moves too. A wall shrunk to
 * nothing is left as it was (the whole change is refused).
 */
export function moveWallEnd(walls: readonly Wall[], id: string, end: 'from' | 'to', to: Point): Wall[] {
  const wall = walls.find(candidate => candidate.id === id)
  if (!wall) return [...walls]
  const at = wall[end]
  const moved = walls.map((candidate) => {
    const from = candidate.id === id ? (end === 'from' ? to : candidate.from) : same(candidate.from, at) ? to : candidate.from
    const next = candidate.id === id ? (end === 'to' ? to : candidate.to) : same(candidate.to, at) ? to : candidate.to
    return refit({ ...candidate, from: { ...from }, to: { ...next } })
  })
  return moved.some(candidate => wallLength(candidate) < OPENING_MIN_WIDTH / 4) ? walls.map(candidate => refit(candidate)) : moved
}

/**
 * Moves a whole wall by `delta`; the walls joined to its ends stretch to follow, so the room stays
 * closed (Figma's dragging of a shape's side).
 */
export function moveWall(walls: readonly Wall[], id: string, delta: Point): Wall[] {
  return moveWalls(walls, new Set([id]), delta)
}

/**
 * Moves several walls by `delta` together (multi-select): an end shared by two moved walls moves
 * once; an unmoved wall's end joined to a moved one's stretches to follow.
 */
export function moveWalls(walls: readonly Wall[], ids: ReadonlySet<string>, delta: Point): Wall[] {
  const shift = (point: Point) => ({ x: point.x + delta.x, y: point.y + delta.y })
  const ends = walls.filter(wall => ids.has(wall.id)).flatMap(wall => [wall.from, wall.to])
  return walls.map((candidate) => {
    if (ids.has(candidate.id)) return refit({ ...candidate, from: shift(candidate.from), to: shift(candidate.to) })
    const from = ends.some(end => same(candidate.from, end)) ? shift(candidate.from) : candidate.from
    const to = ends.some(end => same(candidate.to, end)) ? shift(candidate.to) : candidate.to
    return refit({ ...candidate, from: { ...from }, to: { ...to } })
  })
}

/** A point that moved: a surface corner (D282) or a wall end. */
export interface PointMove {
  from: Point
  to: Point
}

/**
 * Wall ends joined to moved points follow them (D282): a floor surface's corner dragged in Edit
 * points takes the walls ending there along, as the outline's walls did before contract v2.
 */
export function followPoints(walls: readonly Wall[], moves: readonly PointMove[]): Wall[] {
  const moved = moves.filter(move => !same(move.from, move.to))
  if (!moved.length) return [...walls]
  const target = (point: Point) => moved.find(move => same(move.from, point))?.to ?? point
  return walls.map((wall) => {
    const from = target(wall.from)
    const to = target(wall.to)
    return from === wall.from && to === wall.to ? wall : refit({ ...wall, from: { ...from }, to: { ...to } })
  })
}

/** Whether a wall runs along the segment from `a` to `b`, either way. */
export function wallAlong(wall: Pick<Wall, 'from' | 'to'>, a: Point, b: Point): boolean {
  return (same(wall.from, a) && same(wall.to, b)) || (same(wall.from, b) && same(wall.to, a))
}

/**
 * A wall cut in two at `at` (a point on it): the first half keeps its id, the second gets `newId`;
 * each opening goes to the half holding its middle, both keep the wall's kind and structure.
 */
export function splitWall(wall: Wall, at: Point, newId: string): [Wall, Wall] {
  const split = Math.hypot(at.x - wall.from.x, at.y - wall.from.y)
  const first: Opening[] = []
  const second: Opening[] = []
  for (const opening of wall.openings ?? []) {
    if (opening.offset + opening.width / 2 <= split) first.push({ ...opening })
    else second.push({ ...opening, offset: Math.max(0, Math.round(opening.offset - split)) })
  }
  const { name: _name, ...unnamed } = wall
  return [refit({ ...wall, to: { ...at }, openings: first }), refit({ ...unnamed, id: newId, from: { ...at }, openings: second })]
}

/**
 * Two walls meeting end to end made one (a removed corner, D282): from the first's far end to the
 * second's, the first's kind and structure, the openings of both that still fit and that kind
 * takes (ISS-037). Null when they don't share an end.
 */
export function joinWalls(first: Wall, second: Wall): Wall | null {
  const shared = [first.from, first.to].find(end => same(end, second.from) || same(end, second.to))
  if (!shared) return null
  const start = same(first.to, shared) ? first : { ...first, from: first.to, to: first.from, openings: reversedOpenings(first) }
  const next = same(second.from, shared) ? second : { ...second, from: second.to, to: second.from, openings: reversedOpenings(second) }
  const startLength = wallLength(start)
  const kind = wallKind(start)
  const openings = [
    ...(start.openings ?? []),
    ...(next.openings ?? []).map(opening => ({ ...opening, offset: Math.round(opening.offset + startLength) })),
  ].filter(opening => wallTakes(kind, opening.kind))
  // A wall turned round runs the other way: its side does too.
  const side = start === first ? first.side : flipSide(first.side)
  return refit({ ...first, from: { ...start.from }, to: { ...next.to }, side, openings })
}

function reversedOpenings(wall: Wall): Opening[] {
  const length = wallLength(wall)
  return (wall.openings ?? []).map(opening => ({ ...opening, offset: Math.max(0, Math.round(length - opening.offset - opening.width)) }))
}

const flipSide = (side: WallSide | undefined): WallSide | undefined => (side === 'left' ? 'right' : side === 'right' ? 'left' : undefined)

/**
 * The walls around a new floor surface (D282, Room and Draw outline): one per side, outside the
 * surface, `WALL_THICKNESS_CM` thick, as the outline's walls were before contract v2.
 */
export function perimeterWalls(outline: readonly Point[]): Wall[] {
  const side: WallSide = signedArea(outline) >= 0 ? 'left' : 'right'
  return outline.map((from, index) => ({ id: newLayoutId('wall'), from: { ...from }, to: { ...outline[(index + 1) % outline.length]! }, side, thickness: WALL_THICKNESS_CM }))
}

/**
 * Outer walls (those standing beside their line, `side`) cut where the floor surfaces' sides cross
 * them, keeping only the pieces between a surface and the outside (D282, the Room tool): a piece
 * with floor on both sides is inside the building now, one with floor on neither side stands in
 * the air. Centred walls are the owner's own inside walls and are left alone. Each piece keeps the
 * openings that fit on it.
 */
export function trimOuterWalls(walls: readonly Wall[], slabs: readonly Pick<Slab, 'outline'>[]): Wall[] {
  const onFloor = (point: Point) => slabs.some(slab => pointInPolygon(point, slab.outline))
  return walls.flatMap((wall) => {
    if (!wall.side) return [wall]
    const length = wallLength(wall)
    if (length < 1) return []
    const cuts = [0, length, ...slabs.flatMap(slab => crossings(wall, slab.outline))].sort((a, b) => a - b)
      .filter((cut, index, all) => index === 0 || cut - all[index - 1]! >= JOIN_DISTANCE_CM)
    const normal = wallNormal(wall)
    const pieces: Wall[] = []
    let rest: Wall = wall
    let start = 0
    for (const cut of cuts.slice(1)) {
      const middle = pointAlongWall(wall, (start + cut) / 2)
      const sides = [1, -1].map(sign => onFloor({ x: middle.x + normal.x * 2 * sign, y: middle.y + normal.y * 2 * sign }))
      let piece: Wall = rest
      if (cut < length - JOIN_DISTANCE_CM) {
        const at = roundPoint(pointAlongWall(wall, cut))
        ;[piece, rest] = splitWall(rest, at, newLayoutId('wall'))
      }
      if (sides[0] !== sides[1]) pieces.push(piece)
      start = cut
    }
    return pieces
  })
}

/** Where a slab's sides cross a wall's line, as distances from its start. */
function crossings(wall: Wall, outline: readonly Point[]): number[] {
  const d = { x: wall.to.x - wall.from.x, y: wall.to.y - wall.from.y }
  const length = Math.hypot(d.x, d.y)
  const found: number[] = []
  outline.forEach((a, index) => {
    const b = outline[(index + 1) % outline.length]!
    const e = { x: b.x - a.x, y: b.y - a.y }
    const cross = d.x * e.y - d.y * e.x
    if (Math.abs(cross) < 1e-9) return
    const t = ((a.x - wall.from.x) * e.y - (a.y - wall.from.y) * e.x) / cross
    const u = ((a.x - wall.from.x) * d.y - (a.y - wall.from.y) * d.x) / cross
    if (t > 0 && t < 1 && u >= 0 && u <= 1) found.push(t * length)
  })
  return found
}

const roundPoint = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) })

/**
 * The floor below's surfaces and walls for a new floor above it (owner D1, "Copy walls from floor
 * below"): new ids, without doors and windows (a new floor's own come later), as before contract
 * v2 a new floor copied the outline with plain walls.
 */
export function copyStructure(below: Pick<Floor, 'slabs' | 'walls'>): Pick<Floor, 'slabs' | 'walls'> {
  return {
    slabs: below.slabs.map(slab => ({ id: newLayoutId('slab'), outline: slab.outline.map(point => ({ ...point })) })),
    walls: below.walls.map((wall) => {
      const { id: _id, openings: _openings, name: _name, hidden: _hidden, locked: _locked, ...rest } = wall
      return tidy({ ...rest, id: newLayoutId('wall') })
    }),
  }
}

/** A wall as drawn on the plan: its solid spans between doors, its bands, windows and door swings. */
export interface WallDrawing {
  wall: Wall
  kind: WallKind
  /** Its faces along its right normal (`wallBand`). */
  near: number
  far: number
  /** Its pieces between doors. */
  spans: WallSegment[]
  /** A full wall's pieces as bands, mitred where it meets another full wall end to end (ISS-034). */
  bands: Point[][]
  /** How far its band reaches past each end (a mitred corner's), for the 3D wall. */
  reach: { start: number, end: number }
  windows: { id: string, from: Point, to: Point }[]
  /** A door's leaf, one width long, from its hinge: into the room (away from the wall's side) unless it opens out. */
  doors: { id: string, hinge: Point, swing: Point }[]
}

/** Every wall drawn (2D) and its reach (3D): one shared reading of `side`, thickness and joins. */
export function drawWalls(walls: readonly Wall[]): WallDrawing[] {
  const key = (point: Point) => `${Math.round(point.x)},${Math.round(point.y)}`
  const solidEnds = new Map<string, Wall[]>()
  for (const wall of walls) {
    if (wallKind(wall) !== 'wall') continue
    for (const point of [wall.from, wall.to]) solidEnds.set(key(point), [...(solidEnds.get(key(point)) ?? []), wall])
  }
  /** The other full wall joined at `point`, turned to run into it (`into`) or out of it; none at a T. */
  const joinedAt = (wall: Wall, point: Point, into: boolean): WallSegment | undefined => {
    const others = (solidEnds.get(key(point)) ?? []).filter(other => other.id !== wall.id)
    if (others.length !== 1) return undefined
    const other = others[0]!
    const endsHere = key(other.to) === key(point)
    return into === endsHere ? { from: other.from, to: other.to } : { from: other.to, to: other.from }
  }
  return walls.map((wall) => {
    const kind = wallKind(wall)
    const length = wallLength(wall)
    const { near, far } = wallBand(wall)
    const openings = [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset)
    const spans: WallSegment[] = []
    let cursor = 0
    for (const opening of openings) {
      if (opening.kind === 'door' && opening.offset > cursor) spans.push({ from: pointAlongWall(wall, cursor), to: pointAlongWall(wall, opening.offset) })
      if (opening.kind === 'door') cursor = opening.offset + opening.width
    }
    if (cursor < length) spans.push({ from: pointAlongWall(wall, cursor), to: wall.to })
    const before = kind === 'wall' ? joinedAt(wall, wall.from, true) : undefined
    const after = kind === 'wall' ? joinedAt(wall, wall.to, false) : undefined
    const bands = kind === 'wall'
      ? spans.map(span => wallStrip(span, near, far, key(span.from) === key(wall.from) ? before : undefined, key(span.to) === key(wall.to) ? after : undefined))
      : []
    const whole = wallStrip(wall, near, far, before, after)
    const d = { x: (wall.to.x - wall.from.x) / (length || 1), y: (wall.to.y - wall.from.y) / (length || 1) }
    const past = (point: Point, from: Point) => (point.x - from.x) * d.x + (point.y - from.y) * d.y
    // Unjoined, a centred wall runs half its thickness past its ends, so two walls meeting close
    // the corner (D278); a wall beside its line stops at its ends.
    const loose = wall.side ? 0 : wallThickness(wall) / 2
    const reach = {
      start: before ? Math.max(0, -past(whole[0]!, wall.from), -past(whole[3]!, wall.from)) : loose,
      end: after ? Math.max(0, past(whole[1]!, wall.to), past(whole[2]!, wall.to)) : loose,
    }
    const normal = wallNormal(wall)
    const onBand = (point: Point): Point => ({ x: point.x + normal.x * (near + far) / 2, y: point.y + normal.y * (near + far) / 2 })
    const swingSign = wall.side === 'right' ? -1 : 1
    return {
      wall,
      kind,
      near,
      far,
      spans,
      bands,
      reach,
      // On the band's middle line, where the glass stands.
      windows: openings.filter(opening => opening.kind === 'window').map(opening => ({ id: opening.id, from: onBand(pointAlongWall(wall, opening.offset)), to: onBand(pointAlongWall(wall, opening.offset + opening.width)) })),
      // Hung at the doorway's start or end, opening into the room or out of it (D282); an open
      // doorway (`leaf: false`) has no leaf to draw.
      doors: openings.filter(opening => opening.kind === 'door' && opening.leaf !== false).map((opening) => {
        const hinge = pointAlongWall(wall, opening.hinge === 'end' ? opening.offset + opening.width : opening.offset)
        const sign = opening.swing === 'out' ? -swingSign : swingSign
        return { id: opening.id, hinge, swing: { x: hinge.x + normal.x * sign * opening.width, y: hinge.y + normal.y * sign * opening.width } }
      }),
    }
  })
}

/**
 * Gives every door or window whose id repeats in the layout a new id (ISS-042): copies of walls
 * made before the fix kept their doors' ids, which the contract refuses. The first one keeps its
 * id; upgraded outer walls come first on each floor (D282), so Explore's street door is never
 * renamed. Returns the floors unchanged (the same array) when nothing repeats.
 */
export function renewRepeatedOpeningIds<T extends Pick<Floor, 'walls'>>(floors: T[]): T[] {
  const seen = new Set<string>()
  const repeats = (opening: Opening) => {
    const repeated = seen.has(opening.id)
    seen.add(opening.id)
    return repeated
  }
  if (!floors.flatMap(floor => floor.walls.flatMap(wall => wall.openings ?? [])).some(repeats)) return floors
  seen.clear()
  const renew = (openings: Opening[]) => openings.map(opening => (repeats(opening) ? { ...opening, id: newLayoutId(opening.kind) } : opening))
  return floors.map(floor => ({
    ...floor,
    walls: floor.walls.map(wall => (wall.openings ? { ...wall, openings: renew(wall.openings) } : wall)),
  }))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
