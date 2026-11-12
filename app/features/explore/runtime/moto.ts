import { MOTOR } from './motor'
import type { Vec2 } from './vec'
import { add, closestOnSegment, distance, facing, insidePolygon } from './vec'
import type { WalkWorld } from './walk-world'
import { groundAt, isClear } from './walk-world'

export const MOTO = {
  speed: 8,
  reverse: 1.5,
  accelerate: 4.5,
  brake: 9,
  coast: 2.8,
  dismountSpeed: 0.5,
  radius: 0.29,
  axle: 0.62,
  wheelRadius: 0.27,
  seat: 0.77,
} as const

export interface MotoPose {
  position: Vec2
  heading: number
}

export interface MotoState extends MotoPose {
  speed: number
  steer: number
  wheelTurn: number
}

export interface MotoGround {
  world: WalkWorld
  road: readonly Vec2[]
  street: number
}

interface MotoInput {
  steer: number
  gas: boolean
  brake: boolean
}

export function createMoto(pose: MotoPose): MotoState {
  return { ...pose, speed: 0, steer: 0, wheelTurn: 0 }
}

export function motoFits({ world, road, street }: MotoGround, pose: MotoPose): boolean {
  const forward = facing(pose.heading)
  return [-MOTO.axle, 0, MOTO.axle].every((offset) => {
    const point = add(pose.position, forward, offset)
    return insidePolygon(point, road)
      && road.every((a, index) => distance(point, closestOnSegment(point, a, road[(index + 1) % road.length]!)) >= MOTO.radius)
      && isClear(world, point, street, MOTO.radius, MOTOR.height)
  })
}

/** Steering is independent of camera yaw. The brake reaches zero before it can apply reverse. */
export function stepMoto(ground: MotoGround, moto: MotoState, input: MotoInput, dt: number) {
  const speed = moto.speed
  if (input.brake) {
    if (speed > 0) moto.speed = Math.max(0, speed - MOTO.brake * dt)
    else if (input.gas) moto.speed = Math.min(0, speed + MOTO.brake * dt)
    else moto.speed = Math.max(-MOTO.reverse, speed - 2 * dt)
  }
  else if (input.gas) {
    moto.speed = speed < 0 ? Math.min(0, speed + MOTO.brake * dt) : Math.min(MOTO.speed, speed + MOTO.accelerate * dt)
  }
  else {
    moto.speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - MOTO.coast * dt)
  }
  moto.steer += (input.steer - moto.steer) * Math.min(1, dt * 10)
  const travel = moto.speed * dt
  if (travel === 0) return
  const turn = moto.steer * Math.sign(travel) * Math.min(2.2, Math.abs(moto.speed) * 0.65) * dt
  const next = { position: add(moto.position, facing(moto.heading + turn / 2), travel), heading: moto.heading + turn }
  if (!motoFits(ground, next)) {
    moto.speed = 0
    return
  }
  moto.position = next.position
  moto.heading = next.heading
  moto.wheelTurn += travel / MOTO.wheelRadius
}

/** Both sides are tried, curb side first. Check the whole step, including thin walls and drops. */
export function motoDismount({ world, street }: MotoGround, moto: MotoPose, curb: Vec2): (Vec2 & { y: number }) | null {
  const right = facing(moto.heading + Math.PI / 2)
  const preferred = distance(add(moto.position, right), curb) <= distance(add(moto.position, right, -1), curb) ? 1 : -1
  for (const side of [preferred, -preferred]) {
    let landing: (Vec2 & { y: number }) | null = null
    for (const reach of [0.25, 0.5, 0.75, 0.95]) {
      const point = add(moto.position, right, side * reach)
      const y = groundAt(world, point, street)
      if (y === null || Math.abs(y - street) > 0.25 || !isClear(world, point, y, MOTOR.radius, MOTOR.height)) {
        landing = null
        break
      }
      landing = { ...point, y }
    }
    if (landing) return landing
  }
  return null
}

export function nearestMotoCurb(position: Vec2, curbs: MotoStreet['curbs']): Vec2 {
  const a = closestOnSegment(position, ...curbs[0])
  const b = closestOnSegment(position, ...curbs[1])
  return distance(position, a) <= distance(position, b) ? a : b
}

export interface MotoStreet {
  road: Vec2[]
  curbs: [[Vec2, Vec2], [Vec2, Vec2]]
  parking: MotoPose[]
  recovery: MotoPose[]
}
