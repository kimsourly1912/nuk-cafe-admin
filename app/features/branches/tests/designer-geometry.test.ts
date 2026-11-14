import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Floor, ShopLayout } from '#shared/contracts/shop-layout'
import { FIGURE_KINDS, FIGURE_SIZES, layoutSchema } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, findLook, keepsCircle } from '../designer/catalog'
import { demoLayout, DEMO_TABLES } from './demo-layout'
import { besideOf, chairPoses, constrainAngle, resizeCursor, wallStrip, drawBounds, floorViewpoints, outwardNormal, pointInPolygon, rectCorners, resizeFromCorner, rotatePoint, rotationFromDrag, snap, wallPieces, nextSnapStep, SNAP_STEPS_CM } from '../designer/geometry'
import type { Sized } from '../designer/geometry'
import { itemFootprint, placementWarnings, tableFootprint } from '../designer/placement-warnings'
import { fitDistance } from '../designer/scene/units'
import { drawWalls, perimeterWalls } from '../designer/walls'

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

  it('refuses openings that overlap, run past their wall, or sit on the wrong kind of wall', () => {
    const withWall = (change: Partial<Floor['walls'][number]>): ShopLayout => {
      const layout = demoLayout()
      // The ground floor's first wall runs 1000 cm along the top (D282: upgraded from its edge).
      layout.floors[0]!.walls[0] = { ...layout.floors[0]!.walls[0]!, ...change }
      return layout
    }
    expect(messages(withWall({ openings: [{ id: 'a', kind: 'door', offset: 950, width: 100 }] }))).toContain('A door or window does not fit its wall')
    expect(messages(withWall({ openings: [{ id: 'a', kind: 'door', offset: 100, width: 100 }, { id: 'b', kind: 'window', offset: 150, width: 100 }] }))).toContain('A door or window does not fit its wall')
    expect(messages(withWall({ kind: 'railing', openings: [{ id: 'a', kind: 'window', offset: 100, width: 100 }] }))).toContain('A window needs a full wall')
  })

  it('refuses fractional centimetres, angles past 359 and a surface of two corners', () => {
    const fractional = demoLayout()
    fractional.placements[0]!.x = 10.5
    expect(messages(fractional).length).toBeGreaterThan(0)
    const turned = demoLayout()
    turned.placements[0]!.rotation = 360
    expect(messages(turned).length).toBeGreaterThan(0)
    const short = demoLayout()
    short.floors[0]!.slabs[0]!.outline.splice(2)
    expect(messages(short)).toContain('An outline needs 3 corners')
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
    expect(pointInPolygon({ x: 300, y: 700 }, floor.slabs[0]!.outline)).toBe(true)
    expect(pointInPolygon({ x: 800, y: 700 }, floor.slabs[0]!.outline)).toBe(false)
  })

  it('flags a rotated table crossing a concave cutout even when all four corners are inside', () => {
    const floor = { ...demoLayout().floors[0]!, walls: [] }
    const table = { tableId: 'table', x: 570, y: 420, width: 380, depth: 380, rotation: 45 }
    const piece = tableFootprint(table, { shape: 'rect', chair: 'none' }, [])
    expect(piece.parts[0]!.every(point => pointInPolygon(point, floor.slabs[0]!.outline))).toBe(true)
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
    const u = [
      { x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 600, y: 900 },
      { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 900 }, { x: 0, y: 900 },
    ]
    floor.slabs = [{ id: 'u', outline: u }]
    floor.walls = []
    floor.items = []
    const [middle] = floorViewpoints(floor)
    expect(middle?.id).toBe('centre')
    expect(pointInPolygon(middle!.eye, u)).toBe(true)

    const narrow = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 0, y: 100 }]
    floor.slabs = [{ id: 'narrow', outline: narrow }]
    floor.walls = perimeterWalls(narrow)
    floor.walls[0] = { ...floor.walls[0]!, openings: [{ id: 'door', kind: 'door', offset: 80, width: 100 }] }
    const points = floorViewpoints(floor)
    expect(points.map(point => point.id)).toEqual(['centre'])
    expect(pointInPolygon(points[0]!.eye, narrow)).toBe(true)
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

  it('grows from the dragged corner in whole centimetres while the opposite corner stays put', () => {
    const grown = resizeFromCorner(table, { ...limits, corner: 2, delta: { x: 33.4, y: 12 } })
    expect(grown).toMatchObject({ width: 153, depth: 92, rotation: 0 })
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

  it('a side changes one size and keeps the opposite side; Shift scales the other about the middle (ED-01)', () => {
    // Right side out 30: wider, the left side stays.
    const right = resizeFromCorner(table, { ...limits, corner: 5, delta: { x: 30, y: 17 } })
    expect(right).toEqual({ x: 115, y: 100, rotation: 0, width: 150, depth: 80 })
    expect(corner(right, 0)).toEqual(corner(table, 0))
    // Top side up 20: deeper, the bottom stays.
    expect(resizeFromCorner(table, { ...limits, corner: 4, delta: { x: 50, y: -20 } })).toEqual({ x: 100, y: 90, rotation: 0, width: 120, depth: 100 })
    // Left side with Shift: 1.5 times, the depth grows about the middle.
    expect(resizeFromCorner(table, { ...limits, corner: 7, delta: { x: -60, y: 0 }, keepRatio: true })).toEqual({ x: 70, y: 100, rotation: 0, width: 180, depth: 120 })
    // A round piece's side keeps it round.
    const round = { ...table, width: 70, depth: 70 }
    expect(resizeFromCorner(round, { ...limits, round: true, corner: 6, delta: { x: 0, y: 30 } })).toMatchObject({ width: 100, depth: 100 })
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

describe('drawing a Shape or Room rectangle (ISS-017)', () => {
  const start = { x: 100, y: 100 }
  it('draws from corner to corner, in any direction', () => {
    expect(drawBounds({ start, end: { x: 300, y: 150 } })).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 150 })
    expect(drawBounds({ start, end: { x: 0, y: 50 } })).toEqual({ minX: 0, minY: 50, maxX: 100, maxY: 100 })
  })

  it('Shift makes a square on the longer side, toward the pointer', () => {
    expect(drawBounds({ start, end: { x: 300, y: 150 }, keepRatio: true })).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 300 })
    expect(drawBounds({ start, end: { x: 50, y: -100 }, keepRatio: true })).toEqual({ minX: -100, minY: -100, maxX: 100, maxY: 100 })
  })

  it('Alt draws from the middle; with Shift a square around it', () => {
    expect(drawBounds({ start, end: { x: 150, y: 125 }, fromCenter: true })).toEqual({ minX: 50, minY: 75, maxX: 150, maxY: 125 })
    expect(drawBounds({ start, end: { x: 150, y: 125 }, fromCenter: true, keepRatio: true })).toEqual({ minX: 50, minY: 50, maxX: 150, maxY: 150 })
  })
})

describe('round pieces (ISS-017)', () => {
  it('a round block may be an ellipse; other round pieces stay circles; square ones are free', () => {
    expect(keepsCircle('block-round')).toBe(false)
    expect(keepsCircle('plant')).toBe(true)
    expect(keepsCircle('block')).toBe(false)
  })
})

describe('Shift while drawing walls and corners (ISS-018)', () => {
  const from = { x: 0, y: 0 }
  it('goes to the nearest 45° direction, on whole centimetres (or a given step)', () => {
    expect(constrainAngle(from, { x: 300, y: 50 })).toEqual({ x: 300, y: 0 })
    expect(constrainAngle(from, { x: -40, y: -275 })).toEqual({ x: 0, y: -275 })
    expect(constrainAngle(from, { x: 200, y: 150 })).toEqual({ x: 175, y: 175 })
    expect(constrainAngle(from, { x: -200, y: 175 })).toEqual({ x: -188, y: 188 })
    expect(constrainAngle(from, { x: -200, y: 175 }, 25)).toEqual({ x: -200, y: 200 })
    expect(constrainAngle(from, { x: -300, y: 25 })).toEqual({ x: -300, y: 0 })
  })
})

describe('wall corners (ISS-034)', () => {
  const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
  const close = (points: { x: number, y: number }[] | null | undefined) => points?.map(point => ({ x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 }))

  // The outer walls around a surface (D282): one per side, beside it, outside.
  const bands = (outline: typeof square, kinds = ['wall', 'wall', 'wall', 'wall']) => drawWalls(perimeterWalls(outline).map((wall, index) => (kinds[index] === 'wall' ? wall : { ...wall, kind: 'railing' as const }))).map(drawing => drawing.bands[0])

  it('meets at a clean outside corner, the band outside the floor', () => {
    const drawn = bands(square)
    expect(close(drawn[0])).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 420, y: -20 }, { x: -20, y: -20 }])
    expect(close(drawn[1])).toEqual([{ x: 400, y: 0 }, { x: 400, y: 300 }, { x: 420, y: 320 }, { x: 420, y: -20 }])
    // The same, drawn the other way round.
    const reversed = bands([...square].reverse())
    expect(close(reversed[0])!.map(point => point.y).filter(y => y > 300)).toEqual([320, 320])
  })

  it('ends square where the next wall is a railing', () => {
    const drawn = bands(square, ['wall', 'railing', 'wall', 'wall'])
    expect(drawn[1]).toBeUndefined()
    expect(close(drawn[0])).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: -20 }, { x: -20, y: -20 }])
  })

  it('mitres at 45° and squares a corner too sharp to mitre', () => {
    const a = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }
    const diagonal = { from: { x: 100, y: 0 }, to: { x: 200, y: 100 } }
    const strip = close(wallStrip(a, -6, 6, undefined, diagonal))!
    // The far side's end lies on the diagonal's far side: not at the plain square end (100, 6).
    expect(strip[2]).not.toEqual({ x: 100, y: 6 })
    expect(strip[2]!.y).toBe(6)
    const back = { from: { x: 100, y: 0 }, to: { x: 0, y: 5 } }
    expect(close(wallStrip(a, -6, 6, undefined, back))![2]).toEqual({ x: 100, y: 6 })
  })
})

describe('resize cursors (ISS-030)', () => {
  it('point along the corner, and turn with the piece', () => {
    expect([0, 1, 2, 3].map(corner => resizeCursor(corner, 0))).toEqual(['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'])
    expect(resizeCursor(0, 45)).toBe('ns-resize')
    expect(resizeCursor(1, 45)).toBe('ew-resize')
    expect(resizeCursor(0, 90)).toBe('nesw-resize')
    expect(resizeCursor(2, 360)).toBe('nwse-resize')
  })

  it('sides show the arrow across them (ED-01)', () => {
    expect([4, 5, 6, 7].map(side => resizeCursor(side, 0))).toEqual(['ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'])
    expect(resizeCursor(5, 90)).toBe('ns-resize')
  })
})

describe('the snap step (plan Phase 2)', () => {
  it('G cycles 1, 5, 10 and 25 cm, round the list', () => {
    expect(SNAP_STEPS_CM).toEqual([1, 5, 10, 25])
    expect([1, 5, 10, 25].map(nextSnapStep)).toEqual([5, 10, 25, 1])
    expect(snap(37, 5)).toBe(35)
  })
})
