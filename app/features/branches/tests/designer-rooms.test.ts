import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { floorSchema } from '#shared/contracts/shop-layout'
import type { FloorShape } from '../designer/outline'
import { addRoom } from '../designer/rooms'

/** 800 × 600, clockwise on screen, a door on the top edge and a railing on the left. */
function shop(): FloorShape {
  return {
    outline: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }],
    edges: [
      { kind: 'wall', openings: [{ id: 'door', kind: 'door', offset: 100, width: 90 }] },
      { kind: 'wall', openings: [] },
      { kind: 'wall', openings: [] },
      { kind: 'railing', openings: [] },
    ],
  }
}

function shapeOf(result: ReturnType<typeof addRoom>): FloorShape {
  if (!('shape' in result)) throw new Error(result.refused)
  return result.shape
}

/** Whether a shape is a valid floor by the shared contract (what the server checks). */
function valid(shape: FloorShape): string[] {
  return (v.safeParse(floorSchema, { id: 'f', name: 'Ground', height: 300, hasRoof: true, walls: [], items: [], ...shape }).issues ?? []).map(issue => issue.message)
}

describe('the Room tool (D278)', () => {
  it('makes a blank floor\'s outline from the rectangle', () => {
    const shape = shapeOf(addRoom({ outline: [], edges: [] }, { minX: 0, minY: 0, maxX: 400, maxY: 300 }, false))
    expect(shape.outline).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])
    expect(valid(shape)).toEqual([])
    expect(addRoom({ outline: [], edges: [] }, { minX: 0, minY: 0, maxX: 400, maxY: 300 }, true)).toHaveProperty('refused')
  })

  it('merges a room into an L, keeping the old edges\' kinds and doors; the new edges are walls', () => {
    const shape = shapeOf(addRoom(shop(), { minX: 800, minY: 300, maxX: 1200, maxY: 600 }, false))
    expect(shape.outline).toEqual([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 300 }, { x: 1200, y: 300 }, { x: 1200, y: 600 }, { x: 0, y: 600 }])
    expect(shape.edges[0]).toEqual({ kind: 'wall', openings: [{ id: 'door', kind: 'door', offset: 100, width: 90 }] })
    expect(shape.edges.at(-1)!.kind).toBe('railing')
    expect(shape.edges.slice(1, 5).every(edge => edge.kind === 'wall' && edge.openings.length === 0)).toBe(true)
    expect(valid(shape)).toEqual([])
  })

  it('cuts a notch out with Alt; a door on the part that goes goes with it', () => {
    const shape = shapeOf(addRoom(shop(), { minX: 0, minY: -50, maxX: 300, maxY: 200 }, true))
    expect(shape.outline).toHaveLength(6)
    expect(shape.edges.flatMap(edge => edge.openings)).toEqual([])
    expect(valid(shape)).toEqual([])
  })

  it('refuses a room apart from the floor, a cut that splits it or leaves a hole, and a tiny room', () => {
    expect(addRoom(shop(), { minX: 1000, minY: 0, maxX: 1300, maxY: 300 }, false)).toEqual({ refused: 'A new room must touch or overlap the floor.' })
    expect(addRoom(shop(), { minX: 300, minY: -100, maxX: 500, maxY: 700 }, true)).toEqual({ refused: 'That cut would split the floor in two.' })
    expect(addRoom(shop(), { minX: 300, minY: 200, maxX: 500, maxY: 400 }, true)).toEqual({ refused: 'That would leave a hole in the floor: floors have one outline.' })
    expect(addRoom(shop(), { minX: -100, minY: -100, maxX: 900, maxY: 700 }, true)).toEqual({ refused: 'That cut would remove the whole floor.' })
    expect(addRoom(shop(), { minX: 0, minY: 0, maxX: 20, maxY: 300 }, false)).toHaveProperty('refused')
  })

  it('changes nothing for a room inside the floor', () => {
    expect(shapeOf(addRoom(shop(), { minX: 100, minY: 100, maxX: 300, maxY: 300 }, false))).toEqual(shop())
  })
})
