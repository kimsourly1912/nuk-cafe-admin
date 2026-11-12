import type { InnerWall, InnerWallKind, Opening, OpeningKind, Point } from '#shared/contracts/shop-layout'
import { innerWallKind, innerWallLength } from '#shared/contracts/shop-layout'
import { fitOpenings, freeSpot, OPENING_DEFAULT_WIDTH, OPENING_MIN_WIDTH } from './outline'

/**
 * Inside walls as pure functions (D278): their kind, length, doors and windows, and moving their
 * ends or the whole wall. Ends that touch another wall's end are joined: they move together, so a
 * kitchen's corner stays closed. Every result is a new list of plain objects (one undo step each).
 */

/** Ends this close (cm) count as joined. */
export const JOIN_DISTANCE_CM = 1

const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_DISTANCE_CM

/** Whether this kind takes this opening: only a full wall takes windows (D278). */
export function innerWallTakes(kind: InnerWallKind, opening: OpeningKind): boolean {
  return opening === 'door' || kind === 'wall'
}

/** The wall as saved: `kind` and `openings` only when they say something (older layouts have neither). */
function tidy(wall: InnerWall, kind: InnerWallKind, openings: readonly Opening[]): InnerWall {
  const { id, from, to } = wall
  return {
    id,
    from: { ...from },
    to: { ...to },
    ...(kind !== 'wall' && { kind }),
    ...(openings.length > 0 && { openings: openings.map(opening => ({ ...opening })) }),
  }
}

/** Its openings kept inside it and apart, after a change of length (the first kept first). */
function refit(wall: InnerWall): InnerWall {
  const kind = innerWallKind(wall)
  return tidy(wall, kind, fitOpenings({ kind: 'wall', openings: wall.openings ?? [] }, Math.floor(innerWallLength(wall))).openings)
}

function replace(walls: readonly InnerWall[], id: string, change: (wall: InnerWall) => InnerWall): InnerWall[] {
  return walls.map(wall => (wall.id === id ? change(wall) : tidy(wall, innerWallKind(wall), wall.openings ?? [])))
}

/** Another kind: a railing, half wall or glass keeps its doors (gaps or gates) and loses its windows. */
export function setInnerWallKind(walls: readonly InnerWall[], id: string, kind: InnerWallKind): InnerWall[] {
  return replace(walls, id, wall => tidy(wall, kind, (wall.openings ?? []).filter(opening => innerWallTakes(kind, opening.kind))))
}

/** Its length, from its start: the end moves along the wall (joined ends don't follow; type it again there). */
export function setInnerWallLength(walls: readonly InnerWall[], id: string, length: number): InnerWall[] {
  return replace(walls, id, (wall) => {
    const current = innerWallLength(wall)
    if (current <= 0) return wall
    const scale = Math.max(1, Math.round(length)) / current
    const to = { x: Math.round(wall.from.x + (wall.to.x - wall.from.x) * scale), y: Math.round(wall.from.y + (wall.to.y - wall.from.y) * scale) }
    return refit({ ...wall, to })
  })
}

/** Whether a door or window of this kind has a free spot on the wall. */
export function innerOpeningFits(wall: InnerWall, kind: OpeningKind): boolean {
  if (!innerWallTakes(innerWallKind(wall), kind)) return false
  const length = Math.floor(innerWallLength(wall))
  const width = Math.min(OPENING_DEFAULT_WIDTH[kind], length)
  return width >= OPENING_MIN_WIDTH && freeSpot({ kind: 'wall', openings: wall.openings ?? [] }, length, width) !== null
}

/** A door or window at the first free spot; nothing changes when there is none. */
export function addInnerOpening(walls: readonly InnerWall[], id: string, kind: OpeningKind, openingId: string): InnerWall[] {
  return replace(walls, id, (wall) => {
    if (!innerOpeningFits(wall, kind)) return wall
    const length = Math.floor(innerWallLength(wall))
    const width = Math.min(OPENING_DEFAULT_WIDTH[kind], length)
    const offset = freeSpot({ kind: 'wall', openings: wall.openings ?? [] }, length, width)!
    return tidy(wall, innerWallKind(wall), [...(wall.openings ?? []), { id: openingId, kind, offset, width }])
  })
}

/** One opening's width or place; the others move out of its way (or go, when the wall is full). */
export function updateInnerOpening(walls: readonly InnerWall[], id: string, openingId: string, change: Partial<Pick<Opening, 'offset' | 'width'>>): InnerWall[] {
  return replace(walls, id, (wall) => {
    const length = Math.floor(innerWallLength(wall))
    const openings = (wall.openings ?? []).map(opening => ({ ...opening }))
    const opening = openings.find(candidate => candidate.id === openingId)
    if (!opening) return wall
    opening.width = Math.min(Math.max(Math.round(change.width ?? opening.width), OPENING_MIN_WIDTH), Math.max(OPENING_MIN_WIDTH, length))
    opening.offset = Math.min(Math.max(Math.round(change.offset ?? opening.offset), 0), Math.max(0, length - opening.width))
    const ordered = [opening, ...openings.filter(candidate => candidate !== opening)]
    return tidy(wall, innerWallKind(wall), fitOpenings({ kind: 'wall', openings: ordered }, length).openings)
  })
}

export function removeInnerOpening(walls: readonly InnerWall[], id: string, openingId: string): InnerWall[] {
  return replace(walls, id, wall => tidy(wall, innerWallKind(wall), (wall.openings ?? []).filter(opening => opening.id !== openingId)))
}

/**
 * Moves one end of a wall to `to`; any other wall's end joined to it moves too. A wall shrunk to
 * nothing is left as it was (the whole change is refused).
 */
export function moveWallEnd(walls: readonly InnerWall[], id: string, end: 'from' | 'to', to: Point): InnerWall[] {
  const wall = walls.find(candidate => candidate.id === id)
  if (!wall) return [...walls]
  const at = wall[end]
  const moved = walls.map((candidate) => {
    const from = candidate.id === id ? (end === 'from' ? to : candidate.from) : same(candidate.from, at) ? to : candidate.from
    const next = candidate.id === id ? (end === 'to' ? to : candidate.to) : same(candidate.to, at) ? to : candidate.to
    return refit({ ...candidate, from: { ...from }, to: { ...next } })
  })
  return moved.some(candidate => innerWallLength(candidate) < OPENING_MIN_WIDTH / 4) ? walls.map(candidate => refit(candidate)) : moved
}

/**
 * Moves a whole wall by `delta`; the walls joined to its ends stretch to follow, so the room stays
 * closed (Figma's dragging of a shape's side).
 */
export function moveWall(walls: readonly InnerWall[], id: string, delta: Point): InnerWall[] {
  const wall = walls.find(candidate => candidate.id === id)
  if (!wall) return [...walls]
  const shift = (point: Point) => ({ x: point.x + delta.x, y: point.y + delta.y })
  const ends = [wall.from, wall.to]
  return walls.map((candidate) => {
    if (candidate.id === id) return refit({ ...candidate, from: shift(candidate.from), to: shift(candidate.to) })
    const from = ends.some(end => same(candidate.from, end)) ? shift(candidate.from) : candidate.from
    const to = ends.some(end => same(candidate.to, end)) ? shift(candidate.to) : candidate.to
    return refit({ ...candidate, from: { ...from }, to: { ...to } })
  })
}
