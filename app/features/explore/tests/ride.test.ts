import { describe, expect, it } from 'vitest'
import { DEMO_CAFE_NAME, DEMO_SEED, DEMO_TABLES, demoCafe } from '../demo/demo-cafe'
import { buildDistrict } from '../runtime/district'
import type { Ride } from '../runtime/ride'
import { IDLE_RIDE, nextRide, RIDE_TIMING, rideOwnsPlayer, routePose, vehiclePose } from '../runtime/ride'
import { lookFromSeat, passengerCamera } from '../runtime/ride-camera'
import { rideDoor, riderPose, safeRideCurb } from '../runtime/ride-player'
import { distance, insidePolygon } from '../runtime/vec'

const district = buildDistrict({ name: DEMO_CAFE_NAME, layout: demoCafe(), tables: DEMO_TABLES, seed: DEMO_SEED })
const { rideCourse: course, street, world } = district
const [front, row] = course.stops
const pickup = routePose(course.approach, course.approach.duration)
const waiting: Ride = { phase: 'waiting', stop: front }
const open: Ride = { ...waiting, doorTime: RIDE_TIMING.open }
const board = nextRide(course, open, { type: 'board', atDoor: true })
const travelling = nextRide(course, board, { type: 'tick', dt: RIDE_TIMING.board })

describe('Explore tuk-tuk', () => {
  it('keeps one request, allows cancellation before pickup, and frees the next request after departure', () => {
    const called = nextRide(course, IDLE_RIDE, { type: 'call' })
    expect(called.phase).toBe('approaching')
    expect(nextRide(course, called, { type: 'call' })).toBe(called)
    const partial = nextRide(course, called, { type: 'tick', dt: 0.4 })
    const cancelled = nextRide(course, partial, { type: 'cancel' })
    expect(cancelled.phase).toBe('leaving')
    expect(vehiclePose(course, cancelled)?.position).toEqual(vehiclePose(course, partial)?.position)
    expect(rideOwnsPlayer(cancelled)).toBe(false)
    expect(nextRide(course, cancelled, { type: 'tick', dt: 60 })).toBe(IDLE_RIDE)
  })

  it('accepts a known destination only once the vehicle stops at the pickup', () => {
    const called = nextRide(course, IDLE_RIDE, { type: 'call' })
    expect(nextRide(course, called, { type: 'confirm', id: 'front' })).toBe(called)
    const met = nextRide(course, called, { type: 'tick', dt: course.approach.duration })
    expect(met).toEqual({ phase: 'waiting' })
    expect(nextRide(course, met, { type: 'confirm', id: 'unknown' })).toBe(met)
    const confirmed = nextRide(course, met, { type: 'confirm', id: 'front' })
    expect(confirmed).toEqual(waiting)
    expect(nextRide(course, confirmed, { type: 'confirm', id: 'shophouses' })).toBe(confirmed)
  })

  it('requires a reachable curbside door and a fully open hinge before boarding', () => {
    expect(nextRide(course, waiting, { type: 'board', atDoor: true })).toBe(waiting)
    expect(nextRide(course, waiting, { type: 'open', atDoor: false })).toBe(waiting)
    const opening = nextRide(course, waiting, { type: 'open', atDoor: true })
    expect(nextRide(course, opening, { type: 'board', atDoor: true })).toBe(opening)
    expect(nextRide(course, opening, { type: 'tick', dt: RIDE_TIMING.open })).toEqual(open)
    expect(nextRide(course, open, { type: 'board', atDoor: false })).toBe(open)
    expect(board.phase).toBe('boarding')
    expect(vehiclePose(course, board)).toEqual(pickup)
  })

  it('ignores duplicate Get in, cancel after boarding, and Exit while moving', () => {
    expect(nextRide(course, board, { type: 'board', atDoor: true })).toBe(board)
    expect(nextRide(course, board, { type: 'cancel' })).toBe(board)
    expect(nextRide(course, board, { type: 'exit' })).toBe(board)
    expect(travelling.phase).toBe('travelling')
    expect(nextRide(course, travelling, { type: 'exit' })).toBe(travelling)
    expect(nextRide(course, travelling, { type: 'cancel' })).toBe(travelling)
  })

  it('takes both routes to the same curb whether the passenger skips or waits', () => {
    expect(front).toBeDefined()
    expect(row).toBeDefined()
    for (const stop of course.stops) {
      const moving: Ride = { phase: 'travelling', elapsed: 0.8, stop }
      const skipped = nextRide(course, moving, { type: 'skip' })
      const ended = nextRide(course, moving, { type: 'tick', dt: stop.route.duration })
      expect(skipped).toEqual(ended)
      const vehicle = vehiclePose(course, ended)!
      expect(vehiclePose(course, skipped)).toEqual(vehicle)
      const exit = nextRide(course, skipped, { type: 'exit' })
      expect(vehiclePose(course, exit)).toEqual(vehicle)
      const curb = safeRideCurb(world, vehicle, street)!
      expect(curb).toBeTruthy()
      expect(riderPose({ ...exit, elapsed: RIDE_TIMING.exit } as Ride, vehicle, street, curb, curb)).toEqual(curb)
      const departed = nextRide(course, exit, { type: 'tick', dt: RIDE_TIMING.exit })
      expect(rideOwnsPlayer(departed)).toBe(false)
      expect(rideDoor(departed)).toBe(0)
    }
  })

  it('keeps the demo route on the lane and anchors clear on the curb', () => {
    const lane = district.map.areas.find(area => area.kind === 'lane')!.points
    for (const stop of course.stops) {
      expect(stop.route.points.every(point => insidePolygon(point, lane))).toBe(true)
      const first = routePose(stop.route, 0)
      expect(first).toEqual(pickup)
      const last = routePose(stop.route, stop.route.duration)
      expect(safeRideCurb(world, last, street)).toBeTruthy()
      expect(distance(first.position, last.position)).toBeGreaterThan(3)
    }
    expect(safeRideCurb(world, pickup, street)).toBeTruthy()
  })

  it('finds a nearby safe exit if a prop blocks the preferred curb spot', () => {
    const curb = safeRideCurb(world, pickup, street)!
    const blocked = { ...world, solids: [...world.solids, { shape: 'circle' as const, center: curb, radius: 0.1, bottom: street, top: street + 1 }] }
    const fallback = safeRideCurb(blocked, pickup, street)
    expect(fallback).not.toBeNull()
    expect(fallback).not.toEqual(curb)
  })

  it('clamps cabin look and switches camera while keeping the moving vehicle pose', () => {
    const view = { outside: false, yaw: 0, pitch: 0 }
    const vehicle = vehiclePose(course, travelling)!
    lookFromSeat(view, 10, 10)
    expect(view.yaw).toBeCloseTo(-110 * Math.PI / 180)
    expect(view.pitch).toBeCloseTo(Math.PI / 6)
    const cabin = passengerCamera(view, vehicle, street, world)
    view.outside = true
    const chase = passengerCamera(view, vehicle, street, world)
    expect(distance(chase.position, vehicle.position)).toBeGreaterThan(distance(cabin.position, vehicle.position))
    view.outside = false
    expect(passengerCamera(view, vehicle, street, world)).toEqual(cabin)
  })
})
