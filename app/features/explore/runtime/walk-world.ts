import type { Vec2 } from './vec'
import { closestOnSegment, insidePolygon, rotate, sub } from './vec'

/**
 * What the character can stand on and what stops it (D275, docs/plans/explore.md → Collision):
 * the layout's plan with heights, no physics engine. Walls are segments, furniture is a circle or a
 * turned box, floors are areas at a height and stairs are ramps. Pure: built once per district,
 * queried every simulation step. Metres; `y` is up.
 */

/** A vertical sheet along a segment, from `bottom` to `top`. A door's leaf names its door. */
export interface Wall {
  a: Vec2
  b: Vec2
  bottom: number
  top: number
  /** A door's leaf: it blocks only while the door is closed. */
  door?: string
}

export type Solid
  = | { shape: 'circle', center: Vec2, radius: number, bottom: number, top: number }
  /** `rotation`: the plan's clockwise turn, degrees. */
    | { shape: 'box', center: Vec2, halfWidth: number, halfDepth: number, rotation: number, bottom: number, top: number }

/**
 * Something to stand on. A ramp is the designer's stairs: it rises from `bottom` at its local +z
 * end to `top` at its −z end, and it is solid underneath.
 */
export type Surface
  = | { shape: 'area', outline: Vec2[], holes: Vec2[][], y: number }
    | { shape: 'ramp', center: Vec2, halfWidth: number, halfDepth: number, rotation: number, bottom: number, top: number }

export type Ramp = Extract<Surface, { shape: 'ramp' }>

export interface WalkWorld {
  walls: Wall[]
  solids: Solid[]
  surfaces: Surface[]
  /** Doors whose leaves are open: their walls don't block. */
  openDoors: Set<string>
}

/** The highest step the character walks up without jumping (a curb is 0.15 m, a threshold 0.2). */
export const STEP_HEIGHT = 0.25

/** A point in a ramp's or box's own frame (unturned, centred). */
function local(point: Vec2, center: Vec2, rotation: number): Vec2 {
  return rotate(sub(point, center), -rotation)
}

/** The ramp's height above `point`, or null when the point isn't over it. */
export function rampHeight(ramp: Ramp, point: Vec2): number | null {
  const p = local(point, ramp.center, ramp.rotation)
  if (Math.abs(p.x) > ramp.halfWidth || Math.abs(p.z) > ramp.halfDepth) return null
  return rampHeightAt(ramp, p.z)
}

function rampHeightAt(ramp: Ramp, localZ: number): number {
  const t = (ramp.halfDepth - localZ) / (2 * ramp.halfDepth)
  return ramp.bottom + Math.max(0, Math.min(1, t)) * (ramp.top - ramp.bottom)
}

/**
 * The highest surface under `point` that feet at `feet` can reach (at most a step up), or null
 * when there is none: off the district, or only floors above.
 */
export function groundAt(world: WalkWorld, point: Vec2, feet: number): number | null {
  let best: number | null = null
  const limit = feet + STEP_HEIGHT
  for (const surface of world.surfaces) {
    let height: number | null
    if (surface.shape === 'area') {
      height = insidePolygon(point, surface.outline) && !surface.holes.some(hole => insidePolygon(point, hole)) ? surface.y : null
    }
    else {
      height = rampHeight(surface, point)
    }
    if (height !== null && height <= limit + 1e-6 && (best === null || height > best)) best = height
  }
  return best
}

/**
 * A floor higher than a step but lower than the head under `point`: the side of a platform the body
 * can't walk into. Floors above the head (the storey above) don't count.
 */
export function ledgeAt(world: WalkWorld, point: Vec2, feet: number, height: number): boolean {
  for (const surface of world.surfaces) {
    if (surface.shape !== 'area' || surface.y <= feet + STEP_HEIGHT + 1e-6 || surface.y >= feet + height) continue
    if (insidePolygon(point, surface.outline) && !surface.holes.some(hole => insidePolygon(point, hole))) return true
  }
  return false
}

/** Whether something from `bottom` to `top` is in the way of a body from `feet` to `feet + height`. */
function overlaps(bottom: number, top: number, feet: number, height: number): boolean {
  return top > feet + STEP_HEIGHT + 1e-6 && bottom < feet + height
}

export function wallBlocks(world: WalkWorld, wall: Wall): boolean {
  return !wall.door || !world.openDoors.has(wall.door)
}

/**
 * Pushes a body of `radius` at `point` out of every wall, solid and stair side in its way, a few
 * times so corners settle. Moving along a wall keeps the along-wall part: the character slides.
 */
export function pushOut(world: WalkWorld, point: Vec2, feet: number, radius: number, height: number): Vec2 {
  let p = { x: point.x, z: point.z }
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const wall of world.walls) {
      if (!wallBlocks(world, wall) || !overlaps(wall.bottom, wall.top, feet, height)) continue
      const next = awayFrom(p, closestOnSegment(p, wall.a, wall.b), radius)
      if (next) {
        p = next
        moved = true
      }
    }
    for (const solid of world.solids) {
      if (!overlaps(solid.bottom, solid.top, feet, height)) continue
      const next = solid.shape === 'circle'
        ? awayFromCircle(p, solid.center, solid.radius + radius)
        : awayFromBox(p, solid.center, solid.halfWidth, solid.halfDepth, solid.rotation, radius)
      if (next) {
        p = next
        moved = true
      }
    }
    for (const surface of world.surfaces) {
      if (surface.shape !== 'ramp') continue
      // The stairs are solid underneath: their side or back stops a body below their surface.
      const nearest = closestInBox(p, surface.center, surface.halfWidth, surface.halfDepth, surface.rotation)
      if (rampHeightAt(surface, local(nearest, surface.center, surface.rotation).z) <= feet + STEP_HEIGHT + 1e-6) continue
      const next = awayFromBox(p, surface.center, surface.halfWidth, surface.halfDepth, surface.rotation, radius)
      if (next) {
        p = next
        moved = true
      }
    }
    if (!moved) break
  }
  return p
}

function awayFrom(point: Vec2, nearest: Vec2, radius: number): Vec2 | null {
  const dx = point.x - nearest.x
  const dz = point.z - nearest.z
  const gap = Math.hypot(dx, dz)
  if (gap >= radius) return null
  // Exactly on the line: push along x, any way out is better than none.
  if (gap < 1e-9) return { x: point.x + radius, z: point.z }
  const scale = (radius - gap) / gap
  return { x: point.x + dx * scale, z: point.z + dz * scale }
}

function awayFromCircle(point: Vec2, center: Vec2, reach: number): Vec2 | null {
  const dx = point.x - center.x
  const dz = point.z - center.z
  const gap = Math.hypot(dx, dz)
  if (gap >= reach) return null
  if (gap < 1e-9) return { x: center.x + reach, z: center.z }
  return { x: center.x + (dx / gap) * reach, z: center.z + (dz / gap) * reach }
}

/** Out of a turned box by `radius`: from outside, away from its nearest point; from inside, through its nearest side. */
function awayFromBox(point: Vec2, center: Vec2, halfWidth: number, halfDepth: number, rotation: number, radius: number): Vec2 | null {
  const p = local(point, center, rotation)
  const inside = Math.abs(p.x) <= halfWidth && Math.abs(p.z) <= halfDepth
  if (!inside) return awayFrom(point, closestInBox(point, center, halfWidth, halfDepth, rotation), radius)
  const toX = halfWidth - Math.abs(p.x)
  const toZ = halfDepth - Math.abs(p.z)
  const out = toX < toZ
    ? { x: Math.sign(p.x || 1) * (halfWidth + radius), z: p.z }
    : { x: p.x, z: Math.sign(p.z || 1) * (halfDepth + radius) }
  const turned = rotate(out, rotation)
  return { x: center.x + turned.x, z: center.z + turned.z }
}

/** The point of a turned box nearest `point` (the point itself when inside). */
function closestInBox(point: Vec2, center: Vec2, halfWidth: number, halfDepth: number, rotation: number): Vec2 {
  const p = local(point, center, rotation)
  const clamped = { x: Math.max(-halfWidth, Math.min(halfWidth, p.x)), z: Math.max(-halfDepth, Math.min(halfDepth, p.z)) }
  const turned = rotate(clamped, rotation)
  return { x: center.x + turned.x, z: center.z + turned.z }
}

/** Whether a body standing at `point` overlaps nothing (used to check a stand-up spot). */
export function isClear(world: WalkWorld, point: Vec2, feet: number, radius: number, height: number): boolean {
  const pushed = pushOut(world, point, feet, radius, height)
  return Math.abs(pushed.x - point.x) < 1e-6 && Math.abs(pushed.z - point.z) < 1e-6 && groundAt(world, point, feet) !== null && !ledgeAt(world, point, feet, height)
}
