import type { Vec2 } from './vec'
import { add, distance, facing, sub, yawOf } from './vec'

export interface VehiclePose {
  position: Vec2
  heading: number
}

interface VehicleRoute {
  points: readonly Vec2[]
  distances: readonly number[]
  length: number
  duration: number
}

export interface RideStop {
  id: string
  label: string
  route: VehicleRoute
}

export interface RideCourse {
  approach: VehicleRoute
  stops: readonly RideStop[]
  leavePickup: Vec2
  leaveDropoff: Vec2
}

export const RIDE_TIMING = { open: 0.4, board: 1.45, exit: 1.45 } as const

export type Ride
  = | { phase: 'idle' }
    | { phase: 'approaching', elapsed: number }
    | { phase: 'waiting', stop?: RideStop, doorTime?: number }
    | { phase: 'boarding' | 'travelling' | 'exiting', stop: RideStop, elapsed: number }
    | { phase: 'stopped', stop: RideStop }
    | { phase: 'leaving', route: VehicleRoute, elapsed: number }

export type RideEvent
  = | { type: 'call' | 'cancel' | 'skip' | 'exit' }
    | { type: 'confirm', id: string }
    | { type: 'open' | 'board', atDoor: boolean }
    | { type: 'tick', dt: number, reducedMotion?: boolean }

export const IDLE_RIDE: Ride = { phase: 'idle' }

export function vehicleRoute(start: Vec2, end: Vec2, speed: number, bends: readonly Vec2[] = []): VehicleRoute {
  const points = [start, ...bends, end]
  const distances = [0]
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1]! + distance(points[i - 1]!, points[i]!))
  const length = distances.at(-1)!
  return { points, distances, length, duration: Math.max(0.4, length / speed) }
}

function pointAt(route: VehicleRoute, metres: number): Vec2 {
  if (metres <= 0) return route.points[0]!
  if (metres >= route.length) return route.points.at(-1)!
  const i = route.distances.findIndex(next => next >= metres)
  const from = route.points[i - 1]!
  const span = route.distances[i]! - route.distances[i - 1]!
  return add(from, sub(route.points[i]!, from), (metres - route.distances[i - 1]!) / span)
}

/** Ease out of a stop and into the next one, with a steady cruise between the ramps. */
function travelled(progress: number): number {
  const ramp = 0.17
  const t = Math.min(1, Math.max(0, progress))
  if (t > 1 - ramp) return 1 - travelled(1 - t)
  return (t < ramp ? t * t / (2 * ramp) : t - ramp / 2) / (1 - ramp)
}

export function routePose(route: VehicleRoute, elapsed: number): VehiclePose {
  const metres = travelled(elapsed / route.duration) * route.length
  return {
    position: pointAt(route, metres),
    heading: yawOf(sub(pointAt(route, metres + 0.08), pointAt(route, metres - 0.08))),
  }
}

/** Vehicle axes match Three.js, with local +x on the passenger side and +z forward. */
export function vehiclePoint(pose: VehiclePose, x: number, z: number): Vec2 {
  return add(add(pose.position, facing(pose.heading + Math.PI / 2), x), facing(pose.heading), z)
}

export function vehiclePose(course: RideCourse, ride: Ride): VehiclePose | null {
  switch (ride.phase) {
    case 'idle': return null
    case 'approaching': return routePose(course.approach, ride.elapsed)
    case 'waiting':
    case 'boarding': return routePose(course.approach, course.approach.duration)
    case 'travelling': return routePose(ride.stop.route, ride.elapsed)
    case 'stopped':
    case 'exiting': return routePose(ride.stop.route, ride.stop.route.duration)
    case 'leaving': return routePose(ride.route, ride.elapsed)
  }
}

export function rideOwnsPlayer(ride: Ride): boolean {
  return ride.phase === 'boarding' || ride.phase === 'travelling' || ride.phase === 'stopped' || ride.phase === 'exiting'
}

export function rideCanCancel(ride: Ride): boolean {
  return ride.phase === 'approaching' || ride.phase === 'waiting'
}

function leave(course: RideCourse, ride: Ride, end: Vec2): Ride {
  const pose = vehiclePose(course, ride)!
  return { phase: 'leaving', elapsed: 0, route: vehicleRoute(pose.position, end, 3.3) }
}

function arrive(stop: RideStop): Ride {
  return { phase: 'stopped', stop }
}

/** All commands pass through here, including keyboard actions and repeat taps. */
export function nextRide(course: RideCourse, ride: Ride, event: RideEvent): Ride {
  switch (event.type) {
    case 'call':
      return ride.phase === 'idle' ? { phase: 'approaching', elapsed: 0 } : ride
    case 'cancel':
      return rideCanCancel(ride) ? leave(course, ride, course.leavePickup) : ride
    case 'confirm': {
      const stop = course.stops.find(stop => stop.id === event.id)
      return ride.phase === 'waiting' && !ride.stop && stop ? { phase: 'waiting', stop } : ride
    }
    case 'open':
      return ride.phase === 'waiting' && ride.stop && ride.doorTime === undefined && event.atDoor ? { ...ride, doorTime: 0 } : ride
    case 'board':
      return ride.phase === 'waiting' && ride.stop && (ride.doorTime ?? -1) >= RIDE_TIMING.open && event.atDoor ? { phase: 'boarding', stop: ride.stop, elapsed: 0 } : ride
    case 'skip':
      return ride.phase === 'travelling' ? arrive(ride.stop) : ride
    case 'exit':
      return ride.phase === 'stopped' ? { phase: 'exiting', stop: ride.stop, elapsed: 0 } : ride
    case 'tick':
      return advanceRide(course, ride, event.dt, event.reducedMotion ?? false)
  }
}

function advanceRide(course: RideCourse, ride: Ride, dt: number, reducedMotion: boolean): Ride {
  const elapsed = ('elapsed' in ride ? ride.elapsed : 0) + dt
  switch (ride.phase) {
    case 'idle': return ride
    case 'approaching': return elapsed >= course.approach.duration ? { phase: 'waiting' } : { ...ride, elapsed }
    case 'waiting': {
      if (ride.doorTime === undefined || ride.doorTime >= RIDE_TIMING.open) return ride
      return { ...ride, doorTime: reducedMotion ? RIDE_TIMING.open : Math.min(RIDE_TIMING.open, ride.doorTime + dt) }
    }
    case 'boarding': return reducedMotion || elapsed >= RIDE_TIMING.board ? { phase: 'travelling', stop: ride.stop, elapsed: 0 } : { ...ride, elapsed }
    case 'travelling': return elapsed >= ride.stop.route.duration ? arrive(ride.stop) : { ...ride, elapsed }
    case 'stopped': return ride
    case 'exiting': return reducedMotion || elapsed >= RIDE_TIMING.exit ? leave(course, ride, course.leaveDropoff) : { ...ride, elapsed }
    case 'leaving': return elapsed >= ride.route.duration ? IDLE_RIDE : { ...ride, elapsed }
  }
}
