import type { ItemKind, LayoutItem, LayoutTable, Point, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import type { SurroundingsPlan } from '~/features/branches'
import { BUILT_IN_LOOKS, chairPoses, DOOR_HEIGHT_CM, findLook, ITEM_SPECS, outwardNormal, pieceHeight, placementExtent, planLane, RAILING_HEIGHT_CM, rectCorners, SLAB_THICKNESS_CM, toPlan } from '~/features/branches'
import type { Vec2 } from './vec'
import { distance, insidePolygon, rotate, sub, yawOf } from './vec'
import type { Solid, Surface, Wall, WalkWorld } from './walk-world'

/**
 * A district (D275, docs/plans/explore.md → Districts): one café and its street, as Explore plays
 * them. Built from the café's layout and the Neighborhood lane the 3D view generates around it
 * (`planLane`, D274), so the walls you bump into are the walls you see. Pure: everything the
 * simulation, the map and the context button need, in metres, no three.js.
 */

export interface DoorInfo {
  id: string
  /** The opening's two ends on the wall line. */
  a: Vec2
  b: Vec2
  mid: Vec2
  /** Out of the café, unit length. */
  out: Vec2
  y: number
}

export interface SeatInfo {
  id: string
  position: Vec2
  /** The yaw a person sitting here faces. */
  yaw: number
  /** The floor it stands on. */
  y: number
  /** The seat's height above that floor. */
  seat: number
}

export interface CounterInfo {
  /** Where a customer stands to order. */
  position: Vec2
  /** Facing the counter. */
  yaw: number
  y: number
}

export interface FloorArea {
  id: string
  name: string
  outline: Vec2[]
  y: number
  /** The underside of what's above (the next floor or the roof); null when open to the sky. */
  ceiling: number | null
}

export type MapAreaKind = 'ground' | 'yard' | 'pavement' | 'lane' | 'planting' | 'building' | 'cafe'

export interface MapArea {
  kind: MapAreaKind
  points: Vec2[]
}

export interface District {
  name: string
  world: WalkWorld
  /** The street's height (the café's ground floor stands a slab above it). */
  street: number
  floors: FloorArea[]
  doors: DoorInfo[]
  seats: SeatInfo[]
  counter: CounterInfo | null
  spawn: { position: Vec2, y: number, heading: number }
  bounds: { minX: number, maxX: number, minZ: number, maxZ: number }
  map: { areas: MapArea[], walls: { a: Vec2, b: Vec2 }[] }
}

export interface DistrictInput {
  name: string
  layout: ShopLayout
  tables: readonly LayoutTable[]
  looks?: readonly TableLook[]
  /** The surroundings' seed (the branch's id), so the street matches the 3D view's. */
  seed: string
}

/** Pieces you can sit on, and their seat's height in metres. */
const SEATS: Partial<Record<ItemKind, number>> = {
  'cafe-chair': 0.46,
  'bentwood-chair': 0.46,
  'bar-stool': 0.75,
  'dining-bench': 0.46,
  'armchair': 0.42,
  'sofa': 0.42,
}

const TABLE_TOP = 0.76
const CHAIR_RADIUS = 0.22
const CHAIR_TOP = 0.9
/** How far in front of the counter a customer stands. */
const COUNTER_GAP_CM = 55

const m = (point: Point): Vec2 => ({ x: point.x / 100, z: point.y / 100 })

export function buildDistrict(input: DistrictInput): District {
  const { layout, tables, looks = BUILT_IN_LOOKS } = input
  const plan = planLane(layout, input.seed)
  if (!plan) throw new Error('A district needs a café with a drawn ground floor.')
  const street = -SLAB_THICKNESS_CM / 100
  const span = (u0: number, u1: number, n0: number, n1: number): Vec2[] => [toPlan(plan.frame, u0, n0), toPlan(plan.frame, u1, n0), toPlan(plan.frame, u1, n1), toPlan(plan.frame, u0, n1)].map(m)
  const walls: Wall[] = []
  const solids: Solid[] = []
  const surfaces: Surface[] = []
  const floors: FloorArea[] = []
  const doors: DoorInfo[] = []
  const seats: SeatInfo[] = []
  let counter: CounterInfo | null = null

  const base = span(plan.base.u0, plan.base.u1, plan.base.n0, plan.base.n1)
  surfaces.push({ shape: 'area', outline: base, holes: [], y: street })
  laneObstacles(plan, span, street, walls, solids)

  const drawn = layout.floors.map((floor, index) => ({ floor, index })).filter(({ floor }) => floor.outline.length >= 3)
  let elevation = 0
  layout.floors.forEach((floor, index) => {
    const y = elevation / 100
    elevation += floor.height
    if (floor.outline.length < 3) return
    const outline = floor.outline.map(m)
    const below = layout.floors[index - 1]
    const holes = (below?.items ?? []).filter(item => item.kind === 'stairs').map(item => rectCorners(item, item.width + 10, item.depth, item.rotation).map(m))
    surfaces.push({ shape: 'area', outline, holes, y })
    const above = drawn.find(entry => entry.index > index)
    floors.push({ id: floor.id, name: floor.name, outline, y, ceiling: above || floor.hasRoof ? y + floor.height / 100 : null })
    const ground = drawn[0]?.index === index

    floor.outline.forEach((corner, edgeIndex) => {
      const next = floor.outline[(edgeIndex + 1) % floor.outline.length]!
      const edge = floor.edges[edgeIndex] ?? { kind: 'wall' as const, openings: [] }
      if (edge.kind === 'open') return
      const top = y + (edge.kind === 'railing' ? RAILING_HEIGHT_CM : floor.height) / 100
      const length = Math.hypot(next.x - corner.x, next.y - corner.y)
      const along = (offset: number): Point => ({ x: corner.x + ((next.x - corner.x) * offset) / length, y: corner.y + ((next.y - corner.y) * offset) / length })
      let cursor = 0
      for (const opening of [...edge.openings].sort((left, right) => left.offset - right.offset)) {
        if (opening.kind !== 'door') continue
        if (opening.offset > cursor) walls.push({ a: m(along(cursor)), b: m(along(opening.offset)), bottom: y, top })
        const a = m(along(opening.offset))
        const b = m(along(opening.offset + opening.width))
        const doorTop = y + Math.min(DOOR_HEIGHT_CM, floor.height) / 100
        walls.push({ a, b, bottom: y, top: doorTop, door: opening.id })
        // Above the door: the camera meets it, a body passes under it.
        if (top > doorTop) walls.push({ a, b, bottom: doorTop, top })
        if (ground) {
          const normal = outwardNormal(floor.outline, edgeIndex)
          doors.push({ id: opening.id, a, b, mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, out: { x: normal.x, z: normal.y }, y })
        }
        cursor = opening.offset + opening.width
      }
      if (cursor < length) walls.push({ a: m(along(cursor)), b: m(next), bottom: y, top })
    })
    for (const wall of floor.walls) walls.push({ a: m(wall.from), b: m(wall.to), bottom: y, top: y + floor.height / 100 })

    for (const item of floor.items) {
      const spec = ITEM_SPECS[item.kind]
      if (item.kind === 'stairs') {
        surfaces.push({ shape: 'ramp', center: m(item), halfWidth: item.width / 200, halfDepth: item.depth / 200, rotation: item.rotation, bottom: y, top: y + floor.height / 100 })
        continue
      }
      if (spec.figure || spec.overhead) continue
      solids.push(itemSolid(item, y))
      const seat = SEATS[item.kind]
      if (seat !== undefined) seats.push({ id: item.id, position: m(item), yaw: yawOf(rotate({ x: 0, z: 1 }, item.rotation)), y, seat })
      if (item.kind === 'service-counter' && ground && !counter) {
        const front = rotate({ x: 0, z: item.depth / 2 + COUNTER_GAP_CM }, item.rotation)
        counter = { position: m({ x: item.x + front.x, y: item.y + front.z }), yaw: yawOf({ x: -front.x, z: -front.z }), y }
      }
    }

    for (const placement of layout.placements.filter(entry => entry.floorId === floor.id)) {
      const table = tables.find(entry => entry.id === placement.tableId)
      if (!table) continue
      const look = findLook(looks, placement.lookId)
      const center = m(placement)
      if (look.shape === 'booth') {
        const extent = placementExtent(placement, look)
        solids.push({ shape: 'box', center, halfWidth: extent.width / 200, halfDepth: extent.depth / 200, rotation: placement.rotation, bottom: y, top: y + 1.1 })
        continue
      }
      solids.push(look.shape === 'round'
        ? { shape: 'circle', center, radius: Math.max(placement.width, placement.depth) / 200, bottom: y, top: y + TABLE_TOP }
        : { shape: 'box', center, halfWidth: placement.width / 200, halfDepth: placement.depth / 200, rotation: placement.rotation, bottom: y, top: y + TABLE_TOP })
      chairPoses(look, placement.width, placement.depth, table.seats).forEach((pose, index) => {
        const offset = rotate({ x: pose.x, z: pose.y }, placement.rotation)
        const position = m({ x: placement.x + offset.x, y: placement.y + offset.z })
        solids.push({ shape: 'circle', center: position, radius: CHAIR_RADIUS, bottom: y, top: y + CHAIR_TOP })
        seats.push({ id: `${table.id}:${index}`, position, yaw: yawOf(rotate({ x: 0, z: 1 }, pose.rotation + placement.rotation)), y, seat: 0.46 })
      })
    }
  })

  const world: WalkWorld = { walls, solids, surfaces, openDoors: new Set() }
  const groundFloor = floors[0]!
  // Across the lane from the café, facing its door: the street and the shop front in view.
  const door = doors[0]
  const spawnPoint = m(toPlan(plan.frame, 260, plan.lane.n1 - 70))
  const look = door ? door.mid : m(toPlan(plan.frame, 0, 0))
  const xs = base.map(point => point.x)
  const zs = base.map(point => point.z)
  return {
    name: input.name,
    world,
    street,
    floors,
    doors,
    seats,
    counter,
    spawn: { position: spawnPoint, y: street, heading: yawOf(sub(look, spawnPoint)) },
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
    map: {
      areas: [
        { kind: 'ground', points: base },
        { kind: 'yard', points: span(plan.yard.u0, plan.yard.u1, plan.yard.n0, plan.yard.n1) },
        { kind: 'pavement', points: span(plan.pavement.u0, plan.pavement.u1, plan.pavement.n0, plan.pavement.n1) },
        { kind: 'lane', points: span(plan.lane.u0, plan.lane.u1, plan.lane.n0, plan.lane.n1) },
        { kind: 'planting', points: span(plan.farSide.u0, plan.farSide.u1, plan.farSide.n0, plan.farSide.n1) },
        ...plan.neighbours.map(block => ({ kind: 'building' as const, points: span(block.u0, block.u1, block.n0, block.n1) })),
        { kind: 'cafe', points: groundFloor.outline },
      ],
      walls: walls.filter(wall => wall.bottom === groundFloor.y && !wall.door && wall.top > groundFloor.y + 1.2).map(wall => ({ a: wall.a, b: wall.b })),
    },
  }
}

function itemSolid(item: LayoutItem, y: number): Solid {
  const top = y + pieceHeight(item) / 100
  if (ITEM_SPECS[item.kind].footprint === 'round') return { shape: 'circle', center: m(item), radius: Math.max(item.width, item.depth) / 200, bottom: y, top }
  return { shape: 'box', center: m(item), halfWidth: item.width / 200, halfDepth: item.depth / 200, rotation: item.rotation, bottom: y, top }
}

/** The lane's shophouses, walls and street furniture (sizes from the 3D builders, rounded up). */
function laneObstacles(plan: SurroundingsPlan, span: (u0: number, u1: number, n0: number, n1: number) => Vec2[], street: number, walls: Wall[], solids: Solid[]) {
  const sides = (points: Vec2[], top: number) => points.forEach((point, index) => walls.push({ a: point, b: points[(index + 1) % points.length]!, bottom: street, top }))
  for (const block of plan.neighbours) sides(span(block.u0, block.u1, block.n0, block.n1), street + (block.floors * block.floorHeight) / 100)
  const line = (n: number, top: number) => {
    const [a, b] = span(plan.base.u0, plan.base.u1, n, n)
    walls.push({ a: a!, b: b!, bottom: street, top })
  }
  line(plan.farSide.n1 - 20, street + 0.79)
  line(plan.yard.n0 + 8, street + 1.8)
  const sizes: Partial<Record<string, { radius: number, top: number }>> = {
    'moto': { radius: 0.75, top: 1.1 },
    'street-lamp': { radius: 0.15, top: 6 },
    'pole': { radius: 0.15, top: 7 },
    'tree': { radius: 0.3, top: 5 },
    'pot': { radius: 0.3, top: 0.7 },
    'bougainvillea': { radius: 0.35, top: 1.4 },
    'water-jar': { radius: 0.35, top: 0.8 },
    'crates': { radius: 0.45, top: 0.6 },
  }
  for (const prop of plan.props) {
    const size = sizes[prop.kind]
    if (size) solids.push({ shape: 'circle', center: m(toPlan(plan.frame, prop.u, prop.n)), radius: size.radius, bottom: street, top: street + size.top })
  }
}

/** The floor the character stands on, if it's inside the café. */
export function floorAt(district: District, position: Vec2, y: number): FloorArea | null {
  return district.floors.find(floor => Math.abs(floor.y - y) < 0.9 && insidePolygon(position, floor.outline)) ?? null
}

/** The nearest door, for the waypoint and the status. */
export function nearestDoor(district: District, position: Vec2): DoorInfo | null {
  let best: DoorInfo | null = null
  for (const door of district.doors) {
    if (!best || distance(door.mid, position) < distance(best.mid, position)) best = door
  }
  return best
}
