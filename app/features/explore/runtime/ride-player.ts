import type { Point3 } from './camera'
import { MOTOR } from './motor'
import type { Ride, VehiclePose } from './ride'
import { RIDE_TIMING, vehiclePoint } from './ride'
import type { Vec2 } from './vec'
import { add, angleBetween, facing } from './vec'
import type { WalkWorld } from './walk-world'
import { groundAt, isClear } from './walk-world'

export interface PassengerPose extends Point3 {
  heading: number
  seated: number
}

const blend = (start: number, end: number, progress: number) => start + (end - start) * progress
const unit = (value: number) => Math.max(0, Math.min(1, value))

function between(from: PassengerPose, to: PassengerPose, fraction: number): PassengerPose {
  const t = unit(fraction)
  const ease = t * t * (3 - 2 * t)
  return {
    x: blend(from.x, to.x, ease),
    z: blend(from.z, to.z, ease),
    y: blend(from.y, to.y, ease),
    heading: from.heading + angleBetween(from.heading, to.heading) * ease,
    seated: blend(from.seated, to.seated, ease),
  }
}

export function passengerCurb(pose: VehiclePose): Vec2 {
  return vehiclePoint(pose, 1.23, -0.48)
}

export function safeRideCurb(world: WalkWorld, pose: VehiclePose, street: number): PassengerPose | null {
  const curb = passengerCurb(pose)
  const along = facing(pose.heading)
  for (const offset of [0, -0.45, 0.45, -0.8, 0.8]) {
    const spot = add(curb, along, offset)
    const y = groundAt(world, spot, street)
    if (y !== null && isClear(world, spot, y, MOTOR.radius, MOTOR.height)) {
      return { ...spot, y, heading: pose.heading + Math.PI / 2, seated: 0 }
    }
  }
  return null
}

export function rideDoor(ride: Ride): number {
  if (ride.phase === 'waiting') return unit((ride.doorTime ?? 0) / RIDE_TIMING.open)
  if (ride.phase === 'boarding') return unit((RIDE_TIMING.board - ride.elapsed) / 0.32)
  if (ride.phase === 'exiting') return unit(Math.min(ride.elapsed / 0.32, (RIDE_TIMING.exit - ride.elapsed) / 0.32))
  return 0
}

export function riderPose(ride: Ride, vehicle: VehiclePose, street: number, boardFrom: PassengerPose, curb: PassengerPose | null): PassengerPose {
  const seat = { ...vehiclePoint(vehicle, 0.13, -0.82), y: street + 0.26, heading: vehicle.heading, seated: 1 }
  const step = { ...vehiclePoint(vehicle, 0.66, -0.35), y: street + 0.26, heading: vehicle.heading - Math.PI / 2, seated: 0 }
  if (ride.phase === 'boarding') {
    const t = ride.elapsed / RIDE_TIMING.board
    return t < 0.45 ? between(boardFrom, step, t / 0.45) : between(step, seat, (t - 0.45) / 0.35)
  }
  if (ride.phase === 'exiting' && curb) {
    const t = ride.elapsed / RIDE_TIMING.exit
    const out = { ...step, heading: curb.heading }
    return t < 0.58 ? between(seat, out, (t - 0.18) / 0.4) : between(out, curb, (t - 0.58) / 0.22)
  }
  return seat
}
