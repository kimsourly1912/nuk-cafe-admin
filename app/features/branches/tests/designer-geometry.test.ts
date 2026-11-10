import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Floor, ShopLayout } from '#shared/contracts/shop-layout'
import { layoutSchema } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, findLook } from '../designer/catalog'
import { demoLayout, DEMO_TABLES } from './demo-layout'
import { chairPoses, floorViewpoints, outsideOutline, outwardNormal, pointInPolygon, rotatePoint, snap, wallPieces } from '../designer/geometry'

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

  it('flags a table that leaves the outline', () => {
    const layout = demoLayout()
    const floor = layout.floors[0]!
    expect(outsideOutline(floor, layout.placements).size).toBe(0)
    layout.placements[3]!.y = 520
    expect([...outsideOutline(floor, layout.placements)]).toEqual(['demo-t04'])
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
