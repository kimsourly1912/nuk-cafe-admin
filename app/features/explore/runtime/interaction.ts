import type { Vec2 } from './vec'
import { angleBetween, distance, yawOf } from './vec'

/**
 * Which one thing the context button acts on (D275, docs/plans/explore.md → Context action): the
 * closest eligible target the character faces, with a clear line to it. The current target stays
 * until another is clearly better or it leaves reach, so the button doesn't flicker between two.
 */

export type TargetKind = 'door' | 'seat' | 'counter' | 'ride' | 'gateway' | 'moto'

export interface Target {
  id: string
  kind: TargetKind
  position: Vec2
  /** The floor it stands on. */
  y: number
  reach: number
  /** Not facing it is fine (standing up from a seat). */
  anyFacing?: boolean
}

export interface Viewer {
  position: Vec2
  y: number
  heading: number
}

/** Within this turn of where the character faces. */
export const FACING_LIMIT = (70 * Math.PI) / 180
/** Another target must score this much better to take over. */
const TAKE_OVER = 0.8
/** A target on another floor is out of reach. */
const SAME_FLOOR = 1.2

function score(target: Target, viewer: Viewer): number | null {
  const gap = distance(target.position, viewer.position)
  if (gap > target.reach || Math.abs(target.y - viewer.y) > SAME_FLOOR) return null
  // Standing on top of it: no direction to face, so it counts as faced.
  const turn = gap < 0.15 || target.anyFacing ? 0 : Math.abs(angleBetween(viewer.heading, yawOf({ x: target.position.x - viewer.position.x, z: target.position.z - viewer.position.z })))
  if (turn > FACING_LIMIT) return null
  return gap + turn * 0.6
}

/**
 * The target to offer, or null. `clear(from, to)` says whether nothing stands between (a wall
 * between the character and a door's other side, for example).
 */
export function chooseTarget(targets: readonly Target[], viewer: Viewer, currentId: string | null, clear: (target: Target) => boolean): Target | null {
  let best: Target | null = null
  let bestScore = Infinity
  let current: Target | null = null
  let currentScore = Infinity
  for (const target of targets) {
    const value = score(target, viewer)
    if (value === null || !clear(target)) continue
    if (target.id === currentId) {
      current = target
      currentScore = value
    }
    if (value < bestScore) {
      best = target
      bestScore = value
    }
  }
  if (current && best && best.id !== current.id && bestScore > currentScore * TAKE_OVER) return current
  return best
}
