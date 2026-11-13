import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Floor, ShopLayout } from '#shared/contracts/shop-layout'
import { FIGURE_KINDS, FIGURE_SIZES, layoutSchema } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, findLook } from '../designer/catalog'
import { demoLayout, DEMO_TABLES } from './demo-layout'
import { besideOf, chairPoses, floorViewpoints, outwardNormal, pointInPolygon, rectCorners, resizeFromCorner, rotatePoint, rotationFromDrag, snap, wallPieces } from '../designer/geometry'
import type { Sized } from '../designer/geometry'
import { itemFootprint, placementWarnings, tableFootprint } from '../designer/placement-warnings'
import { fitDistance } from '../designer/scene/units'

const messages = (layout: unknown) => (v.safeParse(layoutSchema, layout).issues ?? []).map(issue => issue.message)
const round = { shape: 'round', chair: 'cafe-chair' } as const
const rect = { shape: 'rect', chair: 'cafe-chair' } as const

describe('the layout contract', () => {
  it('accepts the demo shophouse', () => {
    expect(messages(demoLayout())).toEqual([])
  })

  it('refuses a table placed twice and a placement on a missing floor', () => {
    const layout = demoLayout()
    layout.placements.push({ ...layout.placements[0]! })
    expect(messages(layout)).toContain('A table is placed twice')
    const missing = demoLayout()
    missing.placements[0]!.floorId = 'basement'
    expect(messages(missing)).toContain('A table is on a floor that does not exist')
  })

  it('refuses openings that overlap, run past their edge, or sit on the wrong kind of edge', () => {
    const withEdge = (edge: Floor['edges'][number]): ShopLayout => {
      const layout = demoLayout()
      layout.floors[0]!.edges[0] = edge
      return layout
    }
    expect(messages(withEdge({ kind: 'wall', openings: [{ id: 'a', kind: 'door', offset: 950, width: 100 }] }))).toContain('A door or window does not fit its edge')
    expect(messages(withEdge({ kind: 'wall', openings: [{ id: 'a', kind: 'door', offset: 100, width: 100 }, { id: 'b', kind: 'window', offset: 150, width: 100 }] }))).toContain('A door or window does not fit its edge')
    expect(messages(withEdge({ kind: 'railing', openings: [{ id: 'a', kind: 'window', offset: 100, width: 100 }] }))).toContain('A window needs a wall')
    expect(messages(withEdge({ kind: 'open', openings: [{ id: 'a', kind: 'door', offset: 100, width: 100 }] }))).toContain('An open edge has no doors or windows')
  })

  it('refuses fractional centimetres, angles past 359 and an outline without its edges', () => {
    const fractional = demoLayout()
    fractional.placements[0]!.x = 10.5
    expect(messages(fractional).length).toBeGreaterThan(0)
    const turned = demoLayout()
    turned.placements[0]!.rotation = 360
    expect(messages(turned).length).toBeGreaterThan(0)
    const short = demoLayout()
    short.floors[0]!.edges.pop()
    expect(messages(short)).toContain('Every outline edge needs its kind')
  })

  it('keeps people and pets at their own size, without finishes or a look (step 3g)', () => {
    const withFigure = (figure: Record<string, unknown>) => {
      const layout = demoLayout()
      layout.floors[0]!.items.push({ id: 'figure', kind: 'cat', x: 200, y: 200, rotation: 30, ...FIGURE_SIZES.cat, finishes: {}, ...figure } as Floor['items'][number])
      return layout
    }
    for (const kind of FIGURE_KINDS) expect(messages(withFigure({ kind, ...FIGURE_SIZES[kind] })), kind).toEqual([])
    expect(messages(withFigure({ width: FIGURE_SIZES.cat.width + 5 }))).toContain('People and pets keep their own size')
    expect(messages(withFigure({ finishes: { frame: 'walnut' } }))).toContain('People and pets have no finishes')
    expect(messages(withFigure({ lookId: 'look-1' }))).toContain('Stairs, people and pets have no custom look')
  })

  it('places every demo table at most once and leaves two unplaced', () => {
    const placed = new Set(demoLayout().placements.map(placement => placement.tableId))
    expect(DEMO_TABLES.filter(table => !placed.has(table.id)).map(table => table.label)).toEqual(['T11', 'T12'])
  })
})

describe('chairs from seats', () => {
  it('gives a round table one chair per seat, each facing the table', () => {
    const poses = chairPoses(round, 80, 80, 4)
    expect(poses).toHaveLength(4)
    // The first sits above the table (−y) and faces down (+y): rotation 0.
    expect(poses[0]).toMatchObject({ x: 0, rotation: 0 })
    expect(poses[0]!.y).toBeLessThan(-40)
    for (const pose of poses) {
      const facing = rotatePoint({ x: 0, y: 1 }, pose.rotation)
      // Facing points from the chair back towards the centre.
      expect(facing.x * -pose.x + facing.y * -pose.y).toBeGreaterThan(0)
    }
  })

  it('fills a rectangle’s long sides first, then its ends', () => {
    const four = chairPoses(rect, 120, 80, 4)
    expect(four.map(pose => pose.rotation).sort()).toEqual([0, 0, 180, 180])
    const six = chairPoses(rect, 120, 80, 6)
    expect(six.filter(pose => pose.rotation === 90 || pose.rotation === 270)).toHaveLength(2)
  })

  it('turns the chairs of a deeper-than-wide table to its long sides', () => {
    const poses = chairPoses(rect, 80, 160, 2)
    expect(poses.map(pose => pose.rotation).sort((a, b) => a - b)).toEqual([90, 270])
  })

  it('gives booths and looks without chairs none', () => {
    expect(chairPoses({ shape: 'booth', chair: 'none' }, 140, 75, 4)).toEqual([])
    expect(chairPoses({ shape: 'rect', chair: 'none' }, 140, 75, 4)).toEqual([])
  })
})

describe('walls around doors and windows', () => {
  it('leaves a lintel over a door and wall below and above a window', () => {
    const pieces = wallPieces(600, 300, [
      { id: 'w', kind: 'window', offset: 40, width: 180 },
      { id: 'd', kind: 'door', offset: 280, width: 100 },
    ])
    expect(pieces).toEqual([
      { from: 0, to: 40, bottom: 0, top: 300 },
      { from: 40, to: 220, bottom: 0, top: 90 },
      { from: 40, to: 220, bottom: 220, top: 300 },
      { from: 220, to: 280, bottom: 0, top: 300 },
      { from: 280, to: 380, bottom: 210, top: 300 },
      { from: 380, to: 600, bottom: 0, top: 300 },
    ])
  })

  it('points the outward normal out of the floor whichever way the outline runs', () => {
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    expect(outwardNormal(square, 0)).toEqual({ x: 0, y: -1 })
    // Reversed, edge 0 is the bottom one (0,100 → 100,100): out is +y.
    const reversed = outwardNormal([...square].reverse(), 0)
    expect(reversed.y).toBe(1)
    expect(Math.abs(reversed.x)).toBe(0)
  })
})

describe('the plan', () => {
  it('snaps to the grid', () => {
    expect(snap(37)).toBe(25)
    expect(snap(38)).toBe(50)
    expect(snap(38, 5)).toBe(40)
  })

  it('knows inside from outside an L-shaped floor', () => {
    const floor = demoLayout().floors[0]!
    expect(pointInPolygon({ x: 300, y: 700 }, floor.outline)).toBe(true)
    expect(pointInPolygon({ x: 800, y: 700 }, floor.outline)).toBe(false)
  })

  it('flags a rotated table crossing a concave cutout even when all four corners are inside', () => {
    const floor = { ...demoLayout().floors[0]!, walls: [] }
    const table = { tableId: 'table', x: 570, y: 420, width: 380, depth: 380, rotation: 45 }
    const piece = tableFootprint(table, { shape: 'rect', chair: 'none' }, [])
    expect(piece.parts[0]!.every(point => pointInPolygon(point, floor.outline))).toBe(true)
    expect(placementWarnings(floor, [piece]).get('table')?.outside).toBe(true)
    const within = tableFootprint({ ...table, width: 100, depth: 100 }, { shape: 'rect', chair: 'none' }, [])
    expect(placementWarnings(floor, [within]).has('table')).toBe(false)
  })

  it('warns about a table chair hitting a wall or a fixture and keeps touching pieces valid', () => {
    const floor = { ...demoLayout().floors[0]!, walls: [] }
    const table = { tableId: 'table', x: 300, y: 300, width: 80, depth: 80, rotation: 90 }
    const chairs = chairPoses(round, table.width, table.depth, 1)
    const piece = tableFootprint(table, round, chairs)
    const fixture = itemFootprint({ id: 'divider', kind: 'room-divider', x: 390, y: 300, width: 100, depth: 20, rotation: 90 })
    const clear = itemFootprint({ id: 'divider', kind: 'room-divider', x: 402.5, y: 300, width: 100, depth: 20, rotation: 90 })
    expect(placementWarnings(floor, [fixture], piece).get('table')).toEqual({ outside: false, overlap: true })
    expect(placementWarnings(floor, [clear, piece]).size).toBe(0)
    const withWall = { ...floor, walls: [{ id: 'wall', from: { x: 390, y: 250 }, to: { x: 390, y: 350 } }] }
    expect(placementWarnings(withWall, [piece]).get('table')).toEqual({ outside: false, overlap: true })
    const nearEdge = tableFootprint({ ...table, x: 530, y: 700 }, round, chairs)
    expect(placementWarnings(floor, [nearEdge]).get('table')?.outside).toBe(true)
  })

  it('never warns about people and pets, nor because of them (step 3g)', () => {
    const floor = { ...demoLayout().floors[0]!, walls: [] }
    const table = { tableId: 'table', x: 300, y: 300, width: 80, depth: 80, rotation: 0 }
    const piece = tableFootprint(table, round, chairPoses(round, table.width, table.depth, 4))
    const seated = itemFootprint({ id: 'person', kind: 'person', x: 300, y: 250, rotation: 0, ...FIGURE_SIZES.person })
    const outside = itemFootprint({ id: 'cat', kind: 'cat', x: -400, y: -400, rotation: 0, ...FIGURE_SIZES.cat })
    expect(placementWarnings(floor, [piece, seated, outside]).size).toBe(0)
    expect(placementWarnings(floor, [piece], seated).size).toBe(0)
  })

  it('never warns about a pendant lamp or a parasol over a table; a floor lamp in a chair\'s place does (step 3f)', () => {
    const floor = { ...demoLayout().floors[0]!, walls: [] }
    const table = { tableId: 'table', x: 300, y: 300, width: 80, depth: 80, rotation: 0 }
    const piece = tableFootprint(table, round, chairPoses(round, table.width, table.depth, 4))
    const parasol = itemFootprint({ id: 'parasol', kind: 'parasol', x: 300, y: 300, rotation: 0, width: 240, depth: 240 })
    const pendant = itemFootprint({ id: 'pendant', kind: 'pendant-lamp', x: 300, y: 300, rotation: 0, width: 45, depth: 45 })
    expect(placementWarnings(floor, [piece, parasol, pendant]).size).toBe(0)
    const lamp = itemFootprint({ id: 'lamp', kind: 'floor-lamp', x: 300, y: 300, rotation: 0, width: 45, depth: 45 })
    expect(placementWarnings(floor, [piece], lamp).get('lamp')).toEqual({ outside: false, overlap: true })
  })

  it('uses a point inside a U-shaped floor and skips a door viewpoint outside a narrow room', () => {
    const floor = demoLayout().floors[0]!
    floor.outline = [
      { x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 600, y: 900 },
      { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 900 }, { x: 0, y: 900 },
    ]
    floor.edges = floor.outline.map(() => ({ kind: 'open', openings: [] }))
    floor.items = []
    const [middle] = floorViewpoints(floor)
    expect(middle?.id).toBe('centre')
    expect(pointInPolygon(middle!.eye, floor.outline)).toBe(true)

    floor.outline = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 0, y: 100 }]
    floor.edges = [
      { kind: 'wall', openings: [{ id: 'door', kind: 'door', offset: 80, width: 100 }] },
      ...floor.outline.slice(1).map(() => ({ kind: 'wall' as const, openings: [] })),
    ]
    const points = floorViewpoints(floor)
    expect(points.map(point => point.id)).toEqual(['centre'])
    expect(pointInPolygon(points[0]!.eye, floor.outline)).toBe(true)
  })

  it('works out viewpoints from the layout: no Entrance where there is no door', () => {
    const [ground, first, rooftop] = demoLayout().floors
    expect(floorViewpoints(ground!).map(point => point.id)).toEqual(['entrance', 'stairs', 'window'])
    expect(floorViewpoints(first!, ground).map(point => point.id)).toEqual(['stairs', 'window'])
    expect(floorViewpoints(rooftop!, first).map(point => point.id)).toEqual(['stairs'])
  })

  it('falls back to the first built-in look for an unknown id', () => {
    expect(findLook(BUILT_IN_LOOKS, 'gone')).toBe(BUILT_IN_LOOKS[0])
  })
})

describe('corner handles and Duplicate (2B)', () => {
  const table: Sized = { x: 100, y: 100, rotation: 0, width: 120, depth: 80 }
  const limits = { round: false, min: 40, max: 600 }
  const corner = (piece: Sized, index: number) => rectCorners(piece, piece.width, piece.depth, piece.rotation)[index]!

  it('grows from the dragged corner in 5 cm steps while the opposite corner stays put', () => {
    const grown = resizeFromCorner(table, { ...limits, corner: 2, delta: { x: 33, y: 12 } })
    expect(grown).toMatchObject({ width: 155, depth: 90, rotation: 0 })
    // The centre is whole centimetres, so the fixed corner may move by half a centimetre.
    expect(Math.abs(corner(grown, 0).x - corner(table, 0).x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(corner(grown, 0).y - corner(table, 0).y)).toBeLessThanOrEqual(0.5)
    const fromTopLeft = resizeFromCorner(table, { ...limits, corner: 0, delta: { x: -20, y: -20 } })
    expect(fromTopLeft).toEqual({ x: 90, y: 90, rotation: 0, width: 140, depth: 100 })
    expect(corner(fromTopLeft, 2)).toEqual(corner(table, 2))
  })

  it('Shift keeps the ratio, led by the axis moved most, within the limits (ISS-015)', () => {
    // 120 x 80, the corner dragged 60 cm out: 1.5 times both ways.
    expect(resizeFromCorner(table, { ...limits, corner: 2, delta: { x: 60, y: 5 }, keepRatio: true })).toMatchObject({ width: 180, depth: 120 })
    expect(resizeFromCorner(table, { ...limits, corner: 2, delta: { x: 0, y: -40 }, keepRatio: true })).toMatchObject({ width: 60, depth: 40 })
    // The limit stops both sides at the same scale: depth may not go under 40 cm.
    expect(resizeFromCorner(table, { ...limits, corner: 2, delta: { x: -100, y: 0 }, keepRatio: true })).toMatchObject({ width: 60, depth: 40 })
  })

  it('Alt resizes around the centre: both sides move, the centre stays (ISS-015)', () => {
    expect(resizeFromCorner(table, { ...limits, corner: 2, delta: { x: 20, y: 10 }, fromCenter: true })).toEqual({ x: 100, y: 100, rotation: 0, width: 160, depth: 100 })
    expect(resizeFromCorner(table, { ...limits, corner: 2, delta: { x: 30, y: 0 }, fromCenter: true, keepRatio: true })).toEqual({ x: 100, y: 100, rotation: 0, width: 180, depth: 120 })
  })

  it('follows the piece\'s turn: on a table turned 90°, dragging down the screen widens it', () => {
    const turned = { ...table, rotation: 90 }
    const grown = resizeFromCorner(turned, { ...limits, corner: 2, delta: { x: 0, y: 40 } })
    expect(grown).toEqual({ x: 100, y: 120, rotation: 90, width: 160, depth: 80 })
    const fixed = corner(turned, 0)
    expect(corner(grown, 0).x).toBeCloseTo(fixed.x)
    expect(corner(grown, 0).y).toBeCloseTo(fixed.y)
  })

  it('keeps within the size limits, and a round piece round', () => {
    expect(resizeFromCorner(table, { ...limits, corner: 2, delta: { x: -500, y: -500 } })).toMatchObject({ width: 40, depth: 40 })
    expect(resizeFromCorner(table, { ...limits, corner: 2, delta: { x: 900, y: 900 } })).toMatchObject({ width: 600, depth: 600 })
    const round = { ...table, width: 70, depth: 70 }
    expect(resizeFromCorner(round, { ...limits, round: true, corner: 2, delta: { x: 30, y: 10 } })).toMatchObject({ width: 100, depth: 100, x: 115, y: 115 })
    expect(resizeFromCorner(round, { ...limits, round: true, corner: 1, delta: { x: 2, y: 25 } })).toMatchObject({ width: 45, depth: 45 })
  })

  it('puts a copy beside the original, clear of it, turned the same way', () => {
    expect(besideOf({ x: 0, y: 40, rotation: 0 }, 100, 60)).toEqual({ x: 125, y: 40 })
    expect(besideOf({ x: 0, y: 40, rotation: 90 }, 200, 60)).toEqual({ x: 75, y: 40 })
  })
})

describe('building fit', () => {
  it('fits the bounding sphere into the narrower horizontal field of view on a phone', () => {
    const radius = 6
    const portrait = 390 / 660
    const distance = fitDistance(radius, 32, portrait)
    const horizontal = Math.atan(Math.tan(16 * Math.PI / 180) * portrait)
    expect(Math.asin(radius / distance)).toBeLessThan(horizontal)
    expect(distance).toBeGreaterThan(fitDistance(radius, 32, 1))
    expect(fitDistance(radius, 32, 2)).toBe(fitDistance(radius, 32, 1))
  })
})

describe('rotating from a corner (ISS-033)', () => {
  const center = { x: 0, y: 0 }
  it('turns by as much as the pointer turned around the centre', () => {
    expect(rotationFromDrag({ center, start: { x: 50, y: -50 }, current: { x: 50, y: 50 }, origin: 0 })).toBe(90)
    expect(rotationFromDrag({ center, start: { x: 50, y: -50 }, current: { x: -50, y: -50 }, origin: 30 })).toBe(300)
    expect(rotationFromDrag({ center, start: { x: 50, y: -50 }, current: { x: 50, y: -50 }, origin: 45 })).toBe(45)
  })

  it('snaps to the step when asked, and turns freely otherwise', () => {
    const current = rotatePoint({ x: 50, y: -50 }, 20)
    expect(rotationFromDrag({ center, start: { x: 50, y: -50 }, current, origin: 0 })).toBe(20)
    expect(rotationFromDrag({ center, start: { x: 50, y: -50 }, current, origin: 0, step: 15 })).toBe(15)
  })
})
