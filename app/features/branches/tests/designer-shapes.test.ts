import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { itemSchema, OUTLINE_CROSSES } from '#shared/contracts/shop-layout'
import { arcFromDrag, arcHandles, fittedRadius, polygonShape, radiusDot, radiusFromDrag, shapeLabelSize, shapeOutline, shapePath } from '../designer/shapes'

describe('shape names (ED-09)', () => {
  it('fit inside the shape, smaller on a round one, and stop at 22 cm', () => {
    expect(shapeLabelSize('Stage', 400, 200, false)).toBe(22)
    const square = shapeLabelSize('Round block', 100, 100, false)!
    const round = shapeLabelSize('Round block', 100, 100, true)!
    expect(round).toBeLessThan(square)
    expect(round * 0.6 * 'Round block'.length).toBeLessThanOrEqual(70)
  })

  it('leave the name out when it cannot fit at a readable size', () => {
    expect(shapeLabelSize('A very long shape name here', 20, 20, false)).toBeNull()
  })
})

describe('rounded corners (ED-05)', () => {
  it('keeps the radius within half the shorter side, and drops it at nothing', () => {
    expect(fittedRadius(30, 200, 100)).toBe(30)
    expect(fittedRadius(80, 200, 100)).toBe(50)
    expect(fittedRadius(undefined, 200, 100)).toBeUndefined()
    expect(fittedRadius(5, 1, 1)).toBeUndefined()
  })

  it('a dot dragged in from a corner sets the radius; its dot sits in by the radius', () => {
    // 200 x 100: the top-left corner at (-100, -50); the pointer 20 in each way.
    expect(radiusFromDrag({ x: -80, y: -30 }, 200, 100)).toBe(20)
    // Past the middle: at most half the shorter side.
    expect(radiusFromDrag({ x: 0, y: 0 }, 200, 100)).toBe(50)
    // Outside the shape: none.
    expect(radiusFromDrag({ x: -120, y: -70 }, 200, 100)).toBe(0)
    expect(radiusDot(2, 200, 100, 20, 12)).toEqual({ x: 80, y: 30 })
    // At 0 the dot still sits a little in, so it can be grabbed.
    expect(radiusDot(0, 200, 100, 0, 12)).toEqual({ x: -88, y: -38 })
  })

  it('outlines a rounded rectangle inside its box, none without a radius', () => {
    expect(shapeOutline({ kind: 'block', width: 200, depth: 100 })).toBeNull()
    const outline = shapeOutline({ kind: 'block', width: 200, depth: 100, radius: 50 })!
    expect(Math.max(...outline.outer.map(point => point.x))).toBeCloseTo(100)
    expect(Math.min(...outline.outer.map(point => point.y))).toBeCloseTo(-50)
    expect(outline.hole).toBeNull()
  })
})

describe('arcs and rings (ED-06)', () => {
  const round = { kind: 'block-round', width: 200, depth: 200 }

  it('outlines a sector from the middle, a ring segment, and a whole ring with its hole', () => {
    expect(shapeOutline(round)).toBeNull()
    const half = shapeOutline({ ...round, arcSweep: 180 })!
    expect(half.outer.at(-1)).toEqual({ x: 0, y: 0 })
    expect(Math.min(...half.outer.map(point => point.y))).toBeCloseTo(0)
    const segment = shapeOutline({ ...round, arcSweep: 90, arcInner: 50 })!
    expect(segment.outer.every(point => Math.hypot(point.x, point.y) >= 49.9)).toBe(true)
    const ring = shapeOutline({ ...round, arcInner: 50 })!
    expect(ring.hole).not.toBeNull()
    expect(shapePath(ring).match(/M/g)).toHaveLength(2)
  })

  it('the arc dot: dragged back from a whole circle it opens a wedge; never jumps across the start', () => {
    // From a whole circle, 30° back (anticlockwise) from the right: 330°.
    const back = { x: Math.cos((-30 * Math.PI) / 180) * 90, y: Math.sin((-30 * Math.PI) / 180) * 90 }
    expect(arcFromDrag('sweep', back, round)).toMatchObject({ arcSweep: 330 })
    // Forward from a whole circle stays whole.
    expect(arcFromDrag('sweep', { x: 90, y: 10 }, round).arcSweep).toBeUndefined()
    // From 90°, the pointer at 120°: 120°.
    const at120 = { x: Math.cos((120 * Math.PI) / 180) * 90, y: Math.sin((120 * Math.PI) / 180) * 90 }
    expect(arcFromDrag('sweep', at120, { ...round, arcSweep: 90 })).toMatchObject({ arcSweep: 120 })
  })

  it('the start dot turns the opening and keeps the sweep; the ratio dot sets the hole', () => {
    expect(arcFromDrag('start', { x: 0, y: 90 }, { ...round, arcSweep: 90 })).toEqual({ arcStart: 90, arcSweep: 90, arcInner: undefined })
    expect(arcFromDrag('ratio', { x: 50, y: 0 }, round)).toMatchObject({ arcInner: 50 })
    expect(arcFromDrag('ratio', { x: 0, y: 0 }, round).arcInner).toBeUndefined()
    expect(arcFromDrag('ratio', { x: 100, y: 0 }, round)).toMatchObject({ arcInner: 95 })
  })

  it('shows the start dot only once there is an opening', () => {
    expect(arcHandles(round).start).toBeNull()
    expect(arcHandles({ ...round, arcSweep: 180 }).start).not.toBeNull()
  })
})

describe('a polygon shape (plan Phase 4)', () => {
  const triangle = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 300 }]

  it('stores drawn corners in thousandths of its size around its middle', () => {
    expect(polygonShape(triangle)).toEqual({ x: 200, y: 200, width: 200, depth: 200, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 0, y: 500 }] })
    expect(polygonShape(triangle.slice(0, 2))).toBeNull()
    expect(polygonShape([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }])).toBeNull()
  })

  it('stretches with its size: the plan and 3D draw the same corners', () => {
    const { points } = polygonShape(triangle)!
    expect(shapeOutline({ kind: 'block-poly', width: 400, depth: 100, points })).toEqual({ outer: [{ x: -200, y: -50 }, { x: 200, y: -50 }, { x: 0, y: 50 }], hole: null })
  })

  it('the contract wants corners on a polygon only, and refuses a crossing one', () => {
    const item = (extra: Record<string, unknown>) => (v.safeParse(itemSchema, { id: 'p', kind: 'block-poly', x: 0, y: 0, rotation: 0, width: 200, depth: 200, finishes: {}, ...extra }).issues ?? []).map(issue => issue.message)
    expect(item({ points: polygonShape(triangle)!.points })).toEqual([])
    expect(item({})).toContain('A polygon shape needs its corners, and only it has them')
    expect(item({ kind: 'block', points: polygonShape(triangle)!.points })).toContain('A polygon shape needs its corners, and only it has them')
    expect(item({ points: [{ x: -500, y: -500 }, { x: 500, y: 500 }, { x: 500, y: -500 }, { x: -500, y: 500 }] })).toContain(OUTLINE_CROSSES)
  })
})
