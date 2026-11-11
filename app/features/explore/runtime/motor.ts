import type { Vec2 } from './vec'
import { angleBetween, length, yawOf } from './vec'
import type { WalkWorld } from './walk-world'
import { groundAt, ledgeAt, pushOut, STEP_HEIGHT } from './walk-world'

/**
 * The character on foot (D275, docs/plans/explore.md → Controls): camera-relative movement already
 * turned into a world direction by the caller, acceleration, turning, gravity, a grounded jump with
 * coyote time and a jump buffer, steps and stairs, and sliding along what's in the way. Pure and
 * deterministic for a fixed step, so it is tested in Node.
 */

export const MOTOR = {
  walk: 1.6,
  jog: 3.6,
  sprint: 6,
  /** Indoors: a café is not a running track. */
  indoors: 2.4,
  /** Seconds from standing to the target speed, and from moving to a stop. */
  accelerate: 0.15,
  stop: 0.1,
  /** Radians a second: the body arcs toward where it moves. */
  turnRate: (720 * Math.PI) / 180,
  gravity: 20,
  jumpSpeed: 4.5,
  coyote: 0.1,
  jumpBuffer: 0.12,
  radius: 0.3,
  height: 1.7,
  /** A stick tilted less than this walks; more jogs. */
  walkTilt: 0.55,
} as const

export interface MotorState {
  position: Vec2
  /** The feet's height. */
  y: number
  velocity: Vec2
  vy: number
  grounded: boolean
  /** Yaw the body faces (a model facing +z at 0). */
  heading: number
  /** Seconds since the feet left the ground; 0 while grounded. */
  airborne: number
  /** Seconds left of a jump pressed before landing. */
  jumpQueued: number
}

export interface MotorInput {
  /** The way to move in the world, length 0–1 (the stick's tilt or the keys). */
  move: Vec2
  sprint: boolean
  /** Pressed this step. */
  jump: boolean
  indoors: boolean
}

export function createMotor(position: Vec2, y: number, heading: number): MotorState {
  return { position: { ...position }, y, velocity: { x: 0, z: 0 }, vy: 0, grounded: true, heading, airborne: 0, jumpQueued: 0 }
}

/** The speed asked for by a tilt (0–1) of the stick or keys. */
export function targetSpeed(tilt: number, sprint: boolean, indoors: boolean): number {
  if (tilt < 0.05) return 0
  if (indoors) return MOTOR.indoors * Math.min(1, tilt / MOTOR.walkTilt)
  if (sprint) return MOTOR.sprint
  return tilt < MOTOR.walkTilt ? MOTOR.walk * (tilt / MOTOR.walkTilt) : MOTOR.jog
}

/** Moves the motor by one fixed step `dt` (seconds). Mutates and returns `state`. */
export function stepMotor(world: WalkWorld, state: MotorState, input: MotorInput, dt: number): MotorState {
  const tilt = Math.min(1, length(input.move))
  const direction = tilt > 1e-6 ? { x: input.move.x / length(input.move), z: input.move.z / length(input.move) } : { x: 0, z: 0 }
  const speed = targetSpeed(tilt, input.sprint, input.indoors)

  // Horizontal velocity changes toward the target at a constant rate: from standing to a jog in
  // `accelerate` seconds, from a jog to a stop in `stop`. In the air the character keeps most of
  // its momentum.
  const target = { x: direction.x * speed, z: direction.z * speed }
  const rate = (MOTOR.jog / (speed > length(state.velocity) ? MOTOR.accelerate : MOTOR.stop)) * (state.grounded ? 1 : 0.35)
  const change = { x: target.x - state.velocity.x, z: target.z - state.velocity.z }
  const needed = length(change)
  const allowed = rate * dt
  state.velocity = needed <= allowed ? target : { x: state.velocity.x + (change.x / needed) * allowed, z: state.velocity.z + (change.z / needed) * allowed }

  // The body turns toward where it's asked to go, at a limited rate.
  if (tilt > 0.05) {
    const delta = angleBetween(state.heading, yawOf(direction))
    const turn = MOTOR.turnRate * dt
    state.heading += Math.abs(delta) <= turn ? delta : Math.sign(delta) * turn
  }

  // Jump: pressed a little early (buffer) or a little after leaving an edge (coyote) still counts.
  if (input.jump) state.jumpQueued = MOTOR.jumpBuffer
  const canJump = state.grounded || state.airborne < MOTOR.coyote
  if (state.jumpQueued > 0 && canJump && state.vy <= 0) {
    state.vy = MOTOR.jumpSpeed
    state.grounded = false
    state.airborne = MOTOR.coyote
    state.jumpQueued = 0
  }
  state.jumpQueued = Math.max(0, state.jumpQueued - dt)

  // Move, then slide: whatever is in the way pushes the body back along its surface. Nowhere to
  // stand (off the district, into a stair's side) refuses that axis.
  const proposed = { x: state.position.x + state.velocity.x * dt, z: state.position.z + state.velocity.z * dt }
  const next = settle(world, state, proposed) ?? settle(world, state, { x: proposed.x, z: state.position.z }) ?? settle(world, state, { x: state.position.x, z: proposed.z })
  if (next) {
    // The velocity becomes what really happened, never faster than before: a wall that stopped
    // the body stops its velocity into the wall, and a push out of a closing door adds no speed.
    if (dt > 0) {
      const moved = { x: (next.x - state.position.x) / dt, z: (next.z - state.position.z) / dt }
      const before = length(state.velocity)
      const after = length(moved)
      state.velocity = after > before && after > 0 ? { x: (moved.x / after) * before, z: (moved.z / after) * before } : moved
    }
    state.position = next
  }
  else {
    state.velocity = { x: 0, z: 0 }
  }

  // Vertical: on the ground the feet follow it (steps up, small drops down); otherwise gravity.
  const ground = groundAt(world, state.position, state.y)
  if (state.grounded && state.vy <= 0) {
    if (ground !== null && ground >= state.y - STEP_HEIGHT) {
      state.y = ground
      state.vy = 0
      state.airborne = 0
      return state
    }
    state.grounded = false
  }
  state.airborne += dt
  state.vy -= MOTOR.gravity * dt
  state.y += state.vy * dt
  if (ground !== null && state.y <= ground && state.vy <= 0) {
    state.y = ground
    state.vy = 0
    state.grounded = true
    state.airborne = 0
  }
  return state
}

/** Where the body ends up trying `proposed`, or null when there's nothing to stand on there. */
function settle(world: WalkWorld, state: MotorState, proposed: Vec2): Vec2 | null {
  const pushed = pushOut(world, proposed, state.y, MOTOR.radius, MOTOR.height)
  return groundAt(world, pushed, state.y) === null || ledgeAt(world, pushed, state.y, MOTOR.height) ? null : pushed
}
