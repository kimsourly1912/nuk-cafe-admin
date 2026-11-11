import type { PublicExploreLayout } from '#shared/contracts/shop-layout'
import { describe, expect, it } from 'vitest'
import { DEMO_SEED, DEMO_TABLES, demoCafe } from '../demo/demo-cafe'
import { buildDistrict } from '../runtime/district'
import { createMotor, stepMotor } from '../runtime/motor'
import type { NetworkBranch } from '../runtime/network'
import { branchChain, distanceKm, formatKm, hopsBetween, nearbyList, neighboursOf, sideToward } from '../runtime/network'
import { publicDistrictInput } from '../runtime/public-district'
import type { Ride, RideStop } from '../runtime/ride'
import { nextRide, rideOwnsPlayer, routePose, vehiclePose } from '../runtime/ride'
import { safeRideCurb } from '../runtime/ride-player'
import { distance, facing, insidePolygon, sub } from '../runtime/vec'
import { isClear } from '../runtime/walk-world'

// Step E4 (D275, docs/plans/explore.md → Districts and gateways): real branches, joined in a chain.

const branch = (id: string, name: string, latitude: number, longitude: number): NetworkBranch => ({ id, name, latitude, longitude })
// Phnom Penh: the Central Market, the riverside, Toul Tom Poung and Siem Reap, far away.
const market = branch('b-market', 'Old Market', 11.5696, 104.9210)
const river = branch('b-river', 'Riverwalk', 11.5720, 104.9300)
const toul = branch('b-toul', 'Toul Tom Poung', 11.5410, 104.9180)
const siemReap = branch('b-siem', 'Siem Reap', 13.3633, 103.8564)

describe('the branch network', () => {
  it('measures real distances between pins', () => {
    expect(distanceKm(market, market)).toBe(0)
    expect(distanceKm(market, river)).toBeCloseTo(1.02, 1)
    expect(distanceKm(market, siemReap)).toBeGreaterThan(220)
    expect(distanceKm(market, siemReap)).toBeLessThan(250)
    expect(formatKm(0.004)).toBe('10 m')
    expect(formatKm(0.85)).toBe('850 m')
    expect(formatKm(1.84)).toBe('1.8 km')
    expect(formatKm(24.4)).toBe('24 km')
  })

  it('chains the branches by the shortest path, the same whatever order they come in', () => {
    const chain = branchChain([siemReap, market, toul, river]).map(entry => entry.id)
    // Siem Reap is an end: joining it in the middle would cross the country twice.
    expect(chain[0] === 'b-siem' || chain.at(-1) === 'b-siem').toBe(true)
    expect(chain).toEqual(['b-siem', 'b-river', 'b-market', 'b-toul'])
    expect(branchChain([toul, river, siemReap, market]).map(entry => entry.id)).toEqual(chain)
    expect(branchChain([market]).map(entry => entry.id)).toEqual(['b-market'])
    expect(branchChain([])).toEqual([])
  })

  it('stays a chain past the exact limit, through every branch once', () => {
    const many = Array.from({ length: 11 }, (_, index) => branch(`b-${String(index).padStart(2, '0')}`, `Branch ${index}`, 11.5 + index * 0.01, 104.9 + (index % 3) * 0.004))
    const chain = branchChain([...many].reverse())
    expect(new Set(chain.map(entry => entry.id)).size).toBe(many.length)
    expect(chain[0]!.id < chain.at(-1)!.id).toBe(true)
  })

  it('names each district\'s gateways and the side toward any destination', () => {
    const chain = branchChain([market, river, toul])
    expect(neighboursOf(chain, 'b-market').map(entry => [entry.side, entry.branch.id])).toEqual([['start', 'b-river'], ['end', 'b-toul']])
    expect(neighboursOf(chain, 'b-river').map(entry => [entry.side, entry.branch.id])).toEqual([['end', 'b-market']])
    expect(neighboursOf(chain, 'unknown')).toEqual([])
    expect(sideToward(chain, 'b-river', 'b-toul')).toBe('end')
    expect(sideToward(chain, 'b-toul', 'b-river')).toBe('start')
    expect(sideToward(chain, 'b-toul', 'b-toul')).toBeNull()
    expect(sideToward(chain, 'b-toul', 'unknown')).toBeNull()
    expect(hopsBetween(chain, 'b-river', 'b-toul')).toBe(2)
  })

  it('lists nearby branches by real distance, and by name without a position', () => {
    const here = { latitude: 11.5700, longitude: 104.9220 }
    const list = nearbyList([siemReap, toul, river, market], here)
    expect(list.near.map(entry => entry.branch.id)).toEqual(['b-market', 'b-river', 'b-toul'])
    expect(list.farther.map(entry => entry.branch.id)).toEqual(['b-siem'])
    expect(list.near[0]!.km).toBeLessThan(0.2)
    const denied = nearbyList([toul, river, siemReap, market], null)
    expect(denied.near.map(entry => entry.branch.name)).toEqual(['Old Market', 'Riverwalk', 'Siem Reap', 'Toul Tom Poung'])
    expect(denied.near.every(entry => entry.km === null)).toBe(true)
    expect(denied.farther).toEqual([])
    expect(nearbyList([], here)).toEqual({ near: [], farther: [] })
  })
})

const gateways = [{ side: 'start' as const, branchId: 'b-river', name: 'Riverwalk' }, { side: 'end' as const, branchId: 'b-toul', name: 'Toul Tom Poung' }]
const district = buildDistrict({ name: 'Old Market', layout: demoCafe(), tables: DEMO_TABLES, seed: DEMO_SEED, gateways })
const lane = district.map.areas.find(area => area.kind === 'lane')!.points

describe('a district\'s gateways', () => {
  it('stands an arch across each end of the lane, facing out, with a clear arrival', () => {
    const [start, end] = district.gateways
    expect(district.gateways.map(gateway => [gateway.side, gateway.branchId])).toEqual([['start', 'b-river'], ['end', 'b-toul']])
    for (const gateway of district.gateways) {
      expect(insidePolygon(gateway.position, lane)).toBe(true)
      expect(isClear(district.world, gateway.arrival.position, district.street, 0.3, 1.7)).toBe(true)
      // The arrival faces back into the district, away from the arch, which is behind it.
      const ahead = facing(gateway.arrival.heading)
      expect(ahead.x * gateway.out.x + ahead.z * gateway.out.z).toBeCloseTo(-1)
      const behind = sub(gateway.position, gateway.arrival.position)
      expect(behind.x * gateway.out.x + behind.z * gateway.out.z).toBeGreaterThan(1)
    }
    expect(start!.out.x * end!.out.x + start!.out.z * end!.out.z).toBeCloseTo(-1)
  })

  it('lets a body walk between the posts and out under the arch', () => {
    const gateway = district.gateways[1]!
    const motor = createMotor(gateway.arrival.position, district.street, gateway.arrival.heading)
    for (let step = 0; step < 240; step++) stepMotor(district.world, motor, { move: gateway.out, sprint: false, jump: false, indoors: false }, 1 / 60)
    const past = sub(motor.position, gateway.position)
    expect(past.x * gateway.out.x + past.z * gateway.out.z).toBeGreaterThan(0.5)
  })

  it('gives the tuk-tuk a leg out to each arch and in to the café\'s curb, on the lane', () => {
    const pickup = routePose(district.rideCourse.approach, district.rideCourse.approach.duration)
    for (const side of ['start', 'end'] as const) {
      const { out, in: arrive } = district.rideLegs[side]
      expect([...out.points, ...arrive.points].every(point => insidePolygon(point, lane))).toBe(true)
      expect(distance(out.points[0]!, pickup.position)).toBeLessThan(1e-9)
      const gateway = district.gateways.find(entry => entry.side === side)!
      expect(distance(out.points.at(-1)!, gateway.position)).toBeLessThan(2.5)
      // Every arrival stops where the E2 drop-off does: the passenger side at a clear curb.
      const stopped = routePose(arrive, arrive.duration)
      expect(safeRideCurb(district.world, stopped, district.street)).toBeTruthy()
      expect(distance(stopped.position, routePose(district.rideCourse.stops[0]!.route, Infinity).position)).toBeLessThan(0.05)
    }
  })

  it('uses the chosen street door as the entrance', () => {
    expect(district.entrance?.id).toBe('front-door')
  })
})

describe('a ride to another branch', () => {
  const course = { ...district.rideCourse, stops: [...district.rideCourse.stops, { id: 'branch:b-toul', label: 'Toul Tom Poung', route: district.rideLegs.end.out, branchId: 'b-toul' }] }
  const remote = course.stops.at(-1)!
  const leg: RideStop = { id: remote.id, label: remote.label, route: district.rideLegs.start.in }
  const travelling: Ride = { phase: 'travelling', stop: remote, elapsed: 0 }

  it('names its destination with the call (Ride here), only a known one', () => {
    const called = nextRide(course, { phase: 'idle' }, { type: 'call', stopId: remote.id })
    expect(called).toEqual({ phase: 'approaching', elapsed: 0, stop: remote })
    expect(nextRide(course, called, { type: 'tick', dt: course.approach.duration })).toEqual({ phase: 'waiting', stop: remote })
    expect(nextRide(course, { phase: 'idle' }, { type: 'call', stopId: 'branch:unknown' })).toEqual({ phase: 'idle' })
  })

  it('waits under the gateway, then rides the next district\'s leg', () => {
    const crossing = nextRide(course, travelling, { type: 'tick', dt: remote.route.duration })
    expect(crossing).toEqual({ phase: 'crossing', stop: remote, skip: false })
    expect(rideOwnsPlayer(crossing)).toBe(true)
    expect(nextRide(course, crossing, { type: 'tick', dt: 30 })).toBe(crossing)
    expect(nextRide(course, crossing, { type: 'exit' })).toBe(crossing)
    // A leg that itself leads elsewhere isn't an arrival leg.
    expect(nextRide(course, crossing, { type: 'entered', leg: remote })).toBe(crossing)
    const entered = nextRide(course, crossing, { type: 'entered', leg })
    expect(entered).toEqual({ phase: 'travelling', stop: leg, elapsed: 0 })
    expect(nextRide(course, entered, { type: 'tick', dt: leg.route.duration })).toEqual({ phase: 'stopped', stop: leg })
  })

  it('arrives at the same curb whether the passenger skips or waits', () => {
    const skipped = nextRide(course, { ...travelling, elapsed: 1 }, { type: 'skip' })
    expect(skipped).toEqual({ phase: 'crossing', stop: remote, skip: true })
    const skippedArrival = nextRide(course, skipped, { type: 'entered', leg })
    const waited = nextRide(course, nextRide(course, nextRide(course, travelling, { type: 'tick', dt: remote.route.duration }), { type: 'entered', leg }), { type: 'tick', dt: leg.route.duration })
    expect(skippedArrival).toEqual(waited)
    expect(vehiclePose(course, skippedArrival)).toEqual(vehiclePose(course, waited))
    // Skip pressed while waiting under the gateway also skips the next leg.
    const crossing = nextRide(course, travelling, { type: 'tick', dt: remote.route.duration })
    expect(nextRide(course, nextRide(course, crossing, { type: 'skip' }), { type: 'entered', leg })).toEqual(skippedArrival)
  })

  it('is held before the gateway when the next district fails: Retry keeps the route, Exit gets out here', () => {
    const crossing = nextRide(course, travelling, { type: 'tick', dt: remote.route.duration })
    const held = nextRide(course, crossing, { type: 'failed' })
    expect(held).toEqual({ phase: 'held', stop: remote })
    expect(vehiclePose(course, held)).toEqual(vehiclePose(course, crossing))
    expect(nextRide(course, held, { type: 'entered', leg })).toBe(held)
    expect(nextRide(course, held, { type: 'retry' })).toEqual({ phase: 'crossing', stop: remote, skip: false })
    const exiting = nextRide(course, held, { type: 'exit' })
    expect(exiting.phase).toBe('exiting')
    expect(nextRide(course, travelling, { type: 'failed' })).toBe(travelling)
    expect(nextRide(course, travelling, { type: 'retry' })).toBe(travelling)
  })
})

describe('a published branch\'s drawing', () => {
  const published: PublicExploreLayout = {
    floors: demoCafe().floors,
    placements: demoCafe().placements.map(({ tableId: _tableId, ...placement }, index) => ({ ...placement, seats: index % 2 ? 4 : 2 })),
    scene: { preset: 'none', entrance: 'front-door', explore: true },
    looks: [],
    itemLooks: [],
  }

  it('builds with stand-in tables from the seat counts and always the Neighborhood lane', () => {
    const input = publicDistrictInput({ id: 'b-market', name: 'Old Market' }, published)
    expect(input.tables.map(table => table.seats)).toEqual(published.placements.map(placement => placement.seats))
    expect(input.tables.every(table => table.id.startsWith('placed-') && table.label === '')).toBe(true)
    expect(input.layout.placements.map(placement => placement.tableId)).toEqual(input.tables.map(table => table.id))
    expect(input.layout.scene).toEqual({ preset: 'neighborhood-lane', entrance: 'front-door', explore: true })
    expect(input.seed).toBe('b-market')
    const built = buildDistrict(input)
    expect(built.name).toBe('Old Market')
    expect(built.entrance?.id).toBe('front-door')
    // Two chairs for a two-seat table, four for a four-seat one.
    expect(built.seats.filter(seat => seat.id.startsWith('placed-0:'))).toHaveLength(2)
    expect(built.seats.filter(seat => seat.id.startsWith('placed-1:'))).toHaveLength(4)
  })
})
