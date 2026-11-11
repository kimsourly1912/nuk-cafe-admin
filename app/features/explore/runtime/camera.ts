import type { Vec2 } from './vec'
import { angleBetween, segmentHit } from './vec'
import type { WalkWorld } from './walk-world'
import { wallBlocks } from './walk-world'

/**
 * The third-person follow camera (D275, docs/plans/explore.md → Camera), as plain math: yaw and
 * pitch from look input, recentring behind the character after a moment without looking while it
 * moves, a closer distance indoors, and correction so no wall or roof stands between camera and
 * character. The three.js camera just copies `pose`.
 *
 * Yaw: the camera looks along (−sin yaw, −cos yaw) on the ground (three.js's default −z at 0).
 * Pitch: how far above the character it sits, in radians; looking down is positive.
 */

export const CAMERA = {
  pivotHeight: 1.5,
  distance: 3.2,
  farDistance: 4.8,
  indoorsDistance: 2.2,
  /** To the right of the character, like the mockups' framing. */
  shoulder: 0.3,
  pitchMin: (-25 * Math.PI) / 180,
  pitchMax: (60 * Math.PI) / 180,
  pitchStart: (14 * Math.PI) / 180,
  recentreAfter: 1.5,
  /** Radians a second. */
  recentreRate: 2.4,
  /** Kept between the camera and a wall in its way, metres. */
  clearance: 0.25,
  /** Kept below a ceiling. */
  ceilingGap: 0.18,
} as const

export interface FollowCamera {
  yaw: number
  pitch: number
  /** Eased toward the wanted distance. */
  distance: number
  /** Seconds since the player last looked. */
  sinceLook: number
  /** V toggles a farther view. */
  far: boolean
}

export interface Point3 {
  x: number
  y: number
  z: number
}

export function createFollowCamera(heading: number): FollowCamera {
  return { yaw: heading + Math.PI, pitch: CAMERA.pitchStart, distance: CAMERA.distance, sinceLook: Infinity, far: false }
}

/** Look input in radians (the caller scales pixels by its device's sensitivity). */
export function lookBy(camera: FollowCamera, yaw: number, pitch: number) {
  if (yaw === 0 && pitch === 0) return
  camera.yaw -= yaw
  camera.pitch = Math.max(CAMERA.pitchMin, Math.min(CAMERA.pitchMax, camera.pitch + pitch))
  camera.sinceLook = 0
}

export interface FollowUpdate {
  heading: number
  moving: boolean
  indoors: boolean
  reducedMotion: boolean
}

export function updateFollow(camera: FollowCamera, dt: number, update: FollowUpdate) {
  camera.sinceLook += dt
  // Like the reference: behind the character again, but never while the player is looking, and
  // with reduced motion the camera doesn't swing on its own.
  if (update.moving && camera.sinceLook > CAMERA.recentreAfter && !update.reducedMotion) {
    const delta = angleBetween(camera.yaw, update.heading + Math.PI)
    const turn = CAMERA.recentreRate * dt
    camera.yaw += Math.abs(delta) <= turn ? delta : Math.sign(delta) * turn
  }
  const wanted = update.indoors ? CAMERA.indoorsDistance : camera.far ? CAMERA.farDistance : CAMERA.distance
  camera.distance += (wanted - camera.distance) * (update.reducedMotion ? 1 : Math.min(1, dt * 4))
}

/** The way the camera looks, on the ground. */
export function cameraForward(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) }
}

export function cameraRight(yaw: number): Vec2 {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) }
}

/** A move asked for relative to the camera (x right, y forward) as a direction in the world. */
export function worldMove(yaw: number, move: { x: number, y: number }): Vec2 {
  const forward = cameraForward(yaw)
  const right = cameraRight(yaw)
  return { x: forward.x * move.y + right.x * move.x, z: forward.z * move.y + right.z * move.x }
}

/**
 * The fraction of `from → to` before the first wall in the way at heights `low`–`high`, or null
 * when nothing is. Closed doors count; open ones don't.
 */
export function firstWall(world: WalkWorld, from: Vec2, to: Vec2, low: number, high: number): number | null {
  const ray = { x: to.x - from.x, z: to.z - from.z }
  let nearest: number | null = null
  for (const wall of world.walls) {
    if (!wallBlocks(world, wall) || wall.top <= low || wall.bottom >= high) continue
    const t = segmentHit(from, ray, wall.a, { x: wall.b.x - wall.a.x, z: wall.b.z - wall.a.z })
    if (t !== null && (nearest === null || t < nearest)) nearest = t
  }
  return nearest
}

/**
 * Like `firstWall`, for a ray that climbs from `fromY` to `toY`: a wall blocks only where the ray
 * crosses it within its height, so the camera follows through an open doorway under its lintel.
 */
export function firstWallAlong(world: WalkWorld, from: Vec2, fromY: number, to: Vec2, toY: number, margin = 0.1): number | null {
  const ray = { x: to.x - from.x, z: to.z - from.z }
  let nearest: number | null = null
  for (const wall of world.walls) {
    if (!wallBlocks(world, wall)) continue
    const t = segmentHit(from, ray, wall.a, { x: wall.b.x - wall.a.x, z: wall.b.z - wall.a.z })
    if (t === null) continue
    const y = fromY + (toY - fromY) * t
    if (y > wall.bottom - margin && y < wall.top + margin && (nearest === null || t < nearest)) nearest = t
  }
  return nearest
}

export interface CameraPose {
  position: Point3
  target: Point3
  /** A wall pulled the camera in front of it. */
  pulledIn: boolean
}

export interface PoseOptions {
  world: WalkWorld
  /** The character's feet. */
  feet: Point3
  /** The ceiling above the character indoors, if any. */
  ceiling: number | null
}

export function cameraPose(camera: FollowCamera, options: PoseOptions): CameraPose {
  const { world, feet, ceiling } = options
  const right = cameraRight(camera.yaw)
  const forward = cameraForward(camera.yaw)
  const pivot = { x: feet.x + right.x * CAMERA.shoulder, z: feet.z + right.z * CAMERA.shoulder }
  const pivotY = feet.y + CAMERA.pivotHeight
  const horizontal = Math.cos(camera.pitch) * camera.distance
  const wanted = { x: pivot.x - forward.x * horizontal, z: pivot.z - forward.z * horizontal }
  let y = pivotY + Math.sin(camera.pitch) * camera.distance
  // Pulled in front of the first wall between the character and where the camera would be.
  const hit = firstWallAlong(world, pivot, pivotY, wanted, y)
  let fraction = 1
  if (hit !== null && horizontal > 0) fraction = Math.max(0.12, (hit * horizontal - CAMERA.clearance) / horizontal)
  const position = {
    x: pivot.x + (wanted.x - pivot.x) * fraction,
    y: pivotY + (y - pivotY) * fraction,
    z: pivot.z + (wanted.z - pivot.z) * fraction,
  }
  y = position.y
  if (ceiling !== null) y = Math.min(y, ceiling - CAMERA.ceilingGap)
  position.y = Math.max(y, feet.y + 0.3)
  return { position, target: { x: pivot.x, y: pivotY - 0.15, z: pivot.z }, pulledIn: fraction < 1 }
}

/** Closer than this to the head, the avatar hides: the camera would be inside it. */
export const HIDE_AVATAR_WITHIN = 0.75
