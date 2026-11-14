import { describe, expect, it } from 'vitest'
import type { Floor, Point } from '#shared/contracts/shop-layout'
import { floorFromV1 } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS } from '../designer/catalog'
import { pointInPolygon, rotatePoint } from '../designer/geometry'
import { createBuildContext, disposeBuildContext, meshesOf } from '../designer/scene/furniture'
import { createMaterialLibrary } from '../designer/scene/materials'
import { buildScene } from '../designer/scene/scene'
import { buildSurroundings, surroundingsKey } from '../designer/scene/surroundings'
import { frontFrame, LANE, planLane, planSpans, toFrame, toPlan } from '../designer/surroundings'
import type { Span } from '../designer/surroundings'
import { demoLayout } from './demo-layout'

// Where the Neighborhood lane goes (step 3h, D274): around any café the owner draws, never in it,
// the same for everyone who opens the branch.

function floor(outline: Point[], door?: { edge: number, offset: number }): Floor {
  // Written as an outline with edges and upgraded (D282): a wall per side, the door on `edge`'s.
  return floorFromV1({
    id: `floor-${outline.length}-${outline[0]!.x}`,
    name: 'Ground',
    height: 300,
    hasRoof: true,
    outline,
    edges: outline.map((_, index) => ({ kind: 'wall' as const, openings: door?.edge === index ? [{ id: 'door', kind: 'door' as const, offset: door.offset, width: 100 }] : [] })),
    walls: [],
    items: [],
  })
}

const rectangle = (width: number, depth: number): Point[] => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }]
const turned = (outline: Point[], degrees: number) => outline.map(point => rotatePoint(point, degrees)).map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }))
const lShape: Point[] = [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 400 }, { x: 450, y: 400 }, { x: 450, y: 800 }, { x: 0, y: 800 }]

const SHAPES: Record<string, Floor[]> = {
  'a narrow shophouse': [floor(rectangle(400, 1200), { edge: 2, offset: 150 })],
  'a wide café': [floor(rectangle(1400, 700), { edge: 2, offset: 600 })],
  'an L-shaped café': [floor(lShape, { edge: 3, offset: 100 })],
  'a café turned 30°': [floor(turned(rectangle(800, 600), 30), { edge: 2, offset: 300 })],
  'an upper floor overhanging the front': [floor(rectangle(600, 600), { edge: 2, offset: 250 }), { ...floor([{ x: -50, y: 0 }, { x: 650, y: 0 }, { x: 650, y: 720 }, { x: -50, y: 720 }]), id: 'upper', name: 'First' }],
  'the demo shophouse': demoLayout().floors,
}

const contains = (outer: Span, inner: Span) => inner.u0 >= outer.u0 && inner.u1 <= outer.u1 && inner.n0 >= outer.n0 && inner.n1 <= outer.n1
const inside = (span: Span, point: { u: number, n: number }) => point.u > span.u0 && point.u < span.u1 && point.n > span.n0 && point.n < span.n1

describe('the café\'s front', () => {
  it('faces out of the ground floor\'s door, and the frame turns both ways', () => {
    const ground = floor(rectangle(600, 400), { edge: 2, offset: 200 })
    const frame = frontFrame({ floors: [ground] })!
    expect(frame.from).toBe('door')
    // The door is on the bottom edge (y = 400), so out is +y on the plan.
    expect(frame.out.x).toBeCloseTo(0, 6)
    expect(frame.out.y).toBeCloseTo(1, 6)
    expect(frame.origin).toEqual({ x: 350, y: 400 })
    const point = { x: 123, y: -45 }
    const there = toFrame(frame, point)
    const back = toPlan(frame, there.u, there.n)
    expect(back.x).toBeCloseTo(point.x, 6)
    expect(back.y).toBeCloseTo(point.y, 6)
    // A piece turned by the frame's angle has its front (+y) out of the café.
    const front = rotatePoint({ x: 0, y: 1 }, frame.angle)
    expect(front.x).toBeCloseTo(frame.out.x, 6)
    expect(front.y).toBeCloseTo(frame.out.y, 6)
  })

  it('uses the saved street door when the ground floor has several doors', () => {
    const ground = floor(rectangle(600, 400), { edge: 0, offset: 100 })
    ground.walls[2]!.openings = [{ id: 'street', kind: 'door', offset: 200, width: 100 }]
    expect(frontFrame({ floors: [ground] })?.origin).toEqual({ x: 150, y: 0 })
    expect(frontFrame({ floors: [ground], scene: { preset: 'neighborhood-lane', entrance: 'street' } })?.origin).toEqual({ x: 350, y: 400 })
  })

  it('without a door, faces out of the longest wall; without a floor, there is none', () => {
    const frame = frontFrame({ floors: [floor(rectangle(900, 400))] })!
    expect(frame.from).toBe('longest-wall')
    expect(Math.abs(frame.out.y)).toBeCloseTo(1, 6)
    expect(frontFrame({ floors: [] })).toBeNull()
  })
})

describe('the Neighborhood lane', () => {
  it.each(Object.keys(SHAPES))('around %s: nothing stands in the café, the lane is in front of it', (shape) => {
    const floors = SHAPES[shape]!
    const plan = planLane({ floors }, 'branch-1')!
    const outlines = floors.flatMap(entry => entry.slabs.map(slab => slab.outline))
    // Every floor of the café is inside its box, and only the café is.
    for (const outline of outlines) {
      for (const point of outline) {
        const at = toFrame(plan.frame, point)
        expect(at.u).toBeGreaterThanOrEqual(plan.building.u0 - 1e-6)
        expect(at.u).toBeLessThanOrEqual(plan.building.u1 + 1e-6)
        expect(at.n).toBeLessThanOrEqual(plan.building.n1 + 1e-6)
      }
    }
    for (const block of plan.neighbours) {
      expect(block.u1 <= plan.building.u0 + 1e-6 || block.u0 >= plan.building.u1 - 1e-6, block.id).toBe(true)
      expect(block.u1 - block.u0).toBeGreaterThanOrEqual(LANE.neighbourWidth[0])
    }
    expect(plan.neighbours.filter(block => block.side === 'left').length).toBeGreaterThanOrEqual(1)
    expect(plan.neighbours.filter(block => block.side === 'right').length).toBeLessThanOrEqual(2)
    expect(plan.pavement.n0).toBeGreaterThanOrEqual(plan.building.n1)
    expect(plan.lane.n0).toBeGreaterThanOrEqual(plan.pavement.n1)
    expect(plan.yard.n1).toBeLessThanOrEqual(plan.building.n0)
    // The lane's middle is out in front, outside the ground floor.
    const middle = toPlan(plan.frame, 0, (plan.lane.n0 + plan.lane.n1) / 2)
    expect(pointInPolygon(middle, outlines[0]!)).toBe(false)
    // Props stand on the base, never in the café or a shophouse.
    for (const prop of [...plan.props, plan.cat]) {
      expect(inside(plan.base, prop), prop.id).toBe(true)
      expect(inside(plan.building, prop), prop.id).toBe(false)
      for (const block of plan.neighbours) expect(inside(block, prop), `${prop.id} in ${block.id}`).toBe(false)
    }
    // The base holds everything.
    for (const span of planSpans(plan)) expect(contains(plan.base, span)).toBe(true)
    expect(contains(plan.base, plan.building)).toBe(true)
    expect(inside(plan.lane, plan.walk.from) && inside(plan.lane, plan.walk.to)).toBe(true)
  })

  it('is the same for every viewer of a branch, and varies between branches', () => {
    const floors = SHAPES['a wide café']!
    expect(planLane({ floors }, 'branch-1')).toEqual(planLane({ floors }, 'branch-1'))
    const variants = new Set(Array.from({ length: 12 }, (_, index) => JSON.stringify(planLane({ floors }, `branch-${index}`)!.neighbours)))
    expect(variants.size).toBeGreaterThan(6)
  })

  it('has no lane without a drawn floor', () => {
    expect(planLane({ floors: [] }, 'branch-1')).toBeNull()
  })
})

describe('the Neighborhood lane in 3D', () => {
  const build = (seed = 'branch-1', floors = SHAPES['a wide café']!) => buildSurroundings(createMaterialLibrary(), { floors }, 'neighborhood-lane', seed)!

  it('builds nothing for No surroundings or a layout without floors', () => {
    expect(buildSurroundings(createMaterialLibrary(), { floors: SHAPES['a wide café']! }, 'none', 'branch-1')).toBeNull()
    expect(buildSurroundings(createMaterialLibrary(), { floors: [] }, 'neighborhood-lane', 'branch-1')).toBeNull()
  })

  it('merges by material into a few dozen draw calls, casting no sun shadow', () => {
    const lane = build()
    const meshes = meshesOf(lane.root)
    const figureMeshes = lane.figures.flatMap(figure => meshesOf(figure))
    expect(meshes.length - figureMeshes.length).toBeLessThanOrEqual(80)
    expect(meshes.every(mesh => !mesh.castShadow)).toBe(true)
    // One group per shophouse, so the cutaway can hide one whole.
    expect(lane.blocks.length).toBe(planLane({ floors: SHAPES['a wide café']! }, 'branch-1')!.neighbours.length)
    expect(lane.blocks.every(block => meshesOf(block.object).length >= 3)).toBe(true)
  })

  it('surrounds the café\'s building, the same for the same branch', () => {
    const floors = SHAPES['a café turned 30°']!
    const layout = { ...demoLayout(), floors, placements: [] }
    const building = buildScene(createBuildContext(createMaterialLibrary()), { layout, tables: [], looks: BUILT_IN_LOOKS })
    const lane = build('branch-1', floors)
    expect(lane.bounds.containsPoint(building.bounds.min.clone().setY(lane.bounds.min.y + 0.01))).toBe(true)
    expect(lane.bounds.containsPoint(building.bounds.max.clone().setY(lane.bounds.min.y + 0.01))).toBe(true)
    const again = build('branch-1', floors)
    expect(again.bounds.equals(lane.bounds)).toBe(true)
    expect(meshesOf(again.root).length).toBe(meshesOf(lane.root).length)
  })

  it('walks the passer-by along the lane and back; the same time gives the same place', () => {
    const lane = build()
    const [walker] = lane.figures
    const at = (seconds: number) => {
      lane.idle(seconds)
      return walker!.position.clone()
    }
    const start = at(0)
    const later = at(3)
    expect(later.distanceTo(start)).toBeGreaterThan(1.5)
    expect(at(3).equals(later)).toBe(true)
    // Turned to face where it walks: one way, then the other.
    const plan = planLane({ floors: SHAPES['a wide café']! }, 'branch-1')!
    const length = (plan.walk.to.u - plan.walk.from.u) / 100
    lane.idle(length / 0.75 / 2)
    const outward = walker!.rotation.y
    lane.idle((length / 0.75) * 1.5)
    expect(walker!.rotation.y).toBeCloseTo(-outward, 5)
  })

  it('frees every geometry it made with its build context', () => {
    const lane = build()
    expect(lane.context.geometries.size).toBeGreaterThan(10)
    disposeBuildContext(lane.context)
    expect(lane.context.geometries.size).toBe(0)
  })
})

describe('building the street again (ISS-041)', () => {
  it('only when the footprint, street door, scene or seed change, not for furniture', () => {
    const layout = demoLayout()
    const key = surroundingsKey(layout, 'neighborhood-lane', 'b1')
    const moved = structuredClone(layout)
    moved.floors[0]!.items.push({ id: 'new-plant', kind: 'plant', x: 300, y: 300, rotation: 0, width: 50, depth: 50, finishes: {} })
    expect(surroundingsKey(moved, 'neighborhood-lane', 'b1')).toBe(key)
    const wider = structuredClone(layout)
    wider.floors[0]!.slabs[0]!.outline = wider.floors[0]!.slabs[0]!.outline.map(point => ({ x: point.x * 2, y: point.y }))
    expect(surroundingsKey(wider, 'neighborhood-lane', 'b1')).not.toBe(key)
    expect(surroundingsKey(layout, 'neighborhood-lane', 'b2')).not.toBe(key)
    expect(surroundingsKey(layout, 'none', 'b1')).toBe('none')
  })
})
