/**
 * Plan math for Explore (D275), in metres on the ground: `x` is the plan's x and `z` its y (down
 * the screen), as three.js has them. Rotations in degrees are the plan's: clockwise on screen.
 */

export interface Vec2 {
  x: number
  z: number
}

export function vec(x: number, z: number): Vec2 {
  return { x, z }
}

export function add(a: Vec2, b: Vec2, scale = 1): Vec2 {
  return { x: a.x + b.x * scale, z: a.z + b.z * scale }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z }
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.z)
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function normalize(v: Vec2): Vec2 {
  const size = length(v)
  return size > 1e-9 ? { x: v.x / size, z: v.z / size } : { x: 0, z: 0 }
}

/** The plan's clockwise turn (the designer's `rotatePoint`, with y as z). */
export function rotate(v: Vec2, degrees: number): Vec2 {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: v.x * cos - v.z * sin, z: v.x * sin + v.z * cos }
}

/**
 * The yaw (three.js Y rotation) that turns a model facing +z to face `direction`. The avatar and
 * the designer's figures face +z.
 */
export function yawOf(direction: Vec2): number {
  return Math.atan2(direction.x, direction.z)
}

/** The direction a model faces at `yaw`. */
export function facing(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) }
}

/** The shortest signed turn from `from` to `to`, in radians (−π, π]. */
export function angleBetween(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta <= -Math.PI) delta += Math.PI * 2
  return delta
}

export function closestOnSegment(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-12) return { x: a.x, z: a.z }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared))
  return { x: a.x + dx * t, z: a.z + dz * t }
}

/** Where `p → p + r` meets `q → q + s`, as a fraction of the first; null when they don't. */
export function segmentHit(p: Vec2, r: Vec2, q: Vec2, s: Vec2): number | null {
  const cross = r.x * s.z - r.z * s.x
  if (Math.abs(cross) < 1e-12) return null
  const qp = { x: q.x - p.x, z: q.z - p.z }
  const t = (qp.x * s.z - qp.z * s.x) / cross
  const u = (qp.x * r.z - qp.z * r.x) / cross
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

/** Even-odd test; a point on an edge may land either way. */
export function insidePolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!
    const b = polygon[previous]!
    if ((a.z > point.z) !== (b.z > point.z) && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}
