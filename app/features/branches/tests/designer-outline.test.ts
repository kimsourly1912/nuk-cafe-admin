import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Edge, ShopLayout } from '#shared/contracts/shop-layout'
import { edgeLength, floorSchema, layoutSchema, LAYOUT_MAX_FLOORS } from '#shared/contracts/shop-layout'
import { describeIssue } from '../composables/useLayoutEditor'
import { addOpening, areaM2, canClose, closedShape, edgeNames, edgeTakes, fitOpenings, freeSpot, insertCorner, moveCorner, removeCorner, setEdgeKind, setEdgeLength, updateOpening } from '../designer/outline'
import type { FloorShape } from '../designer/outline'
import { canAddFloor, floorName, newFloor, STARTERS } from '../designer/starters'
import { demoLayout } from './demo-layout'

/** The demo's L-shape (clockwise on screen) with a window and a door on its left-hand bottom edge. */
function lShape(): FloorShape {
  const floor = demoLayout().floors[0]!
  return { outline: floor.outline, edges: floor.edges }
}

function square(size = 400, openings: Edge['openings'] = []): FloorShape {
  return { outline: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }], edges: [{ kind: 'wall', openings }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }] }
}

/** Whether a shape is still a valid floor by the shared contract (what the server checks). */
function valid(shape: FloorShape): string[] {
  const result = v.safeParse(floorSchema, { id: 'f', name: 'Ground', height: 300, hasRoof: true, walls: [], items: [], ...shape })
  return (result.issues ?? []).map(issue => issue.message)
}

describe('drawing a new outline', () => {
  it('closes three or more corners with an area into walls without openings', () => {
    expect(canClose([{ x: 0, y: 0 }, { x: 400, y: 0 }])).toBe(false)
    expect(canClose([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }])).toBe(false)
    const shape = closedShape([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }])
    expect(shape.edges).toEqual([{ kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }])
    expect(valid(shape)).toEqual([])
  })
})

describe('moving a corner', () => {
  it('keeps right angles: the corners beside it follow', () => {
    // Corner 3 is the L's inner corner (600, 500): moving it moves its neighbours' shared lines.
    const moved = moveCorner(lShape(), 3, { x: 700, y: 400 })
    expect(moved.outline).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 700, y: 400 }, { x: 700, y: 900 }, { x: 0, y: 900 }])
    expect(valid(moved)).toEqual([])
  })

  it('moves only the corner when right angles are not kept (Alt)', () => {
    const moved = moveCorner(lShape(), 3, { x: 650, y: 550 }, false)
    expect(moved.outline[2]).toEqual({ x: 1000, y: 500 })
    expect(moved.outline[3]).toEqual({ x: 650, y: 550 })
    expect(moved.outline[4]).toEqual({ x: 600, y: 900 })
  })

  it('keeps doors and windows inside a shorter edge, moving or dropping what no longer fits', () => {
    // A 400 cm edge with a 100 cm door at 250: shortened to 300, the door moves back to fit.
    const door = square(400, [{ id: 'd', kind: 'door', offset: 250, width: 100 }])
    const shorter = moveCorner(door, 1, { x: 300, y: 0 })
    expect(shorter.edges[0]!.openings).toEqual([{ id: 'd', kind: 'door', offset: 200, width: 100 }])
    const tiny = moveCorner(door, 1, { x: 30, y: 0 })
    expect(tiny.edges[0]!.openings).toEqual([])
    expect(valid(shorter)).toEqual([])
  })
})

describe('adding and removing corners', () => {
  it('splits an edge in two of its kind, each opening going to the half holding its middle', () => {
    const shape = square(800, [{ id: 'w', kind: 'window', offset: 100, width: 200 }, { id: 'd', kind: 'door', offset: 500, width: 100 }])
    const split = insertCorner(shape, 0)
    expect(split.outline).toHaveLength(5)
    expect(split.outline[1]).toEqual({ x: 400, y: 0 })
    expect(split.edges[0]).toEqual({ kind: 'wall', openings: [{ id: 'w', kind: 'window', offset: 100, width: 200 }] })
    expect(split.edges[1]).toEqual({ kind: 'wall', openings: [{ id: 'd', kind: 'door', offset: 100, width: 100 }] })
    expect(valid(split)).toEqual([])
  })

  it('merges the two edges of a removed corner, keeping both sides\' openings', () => {
    const split = insertCorner(square(800, [{ id: 'w', kind: 'window', offset: 100, width: 200 }, { id: 'd', kind: 'door', offset: 500, width: 100 }]), 0)
    const merged = removeCorner(split, 1)
    expect(merged.outline).toHaveLength(4)
    expect(merged.edges[0]!.openings.map(opening => [opening.id, opening.offset])).toEqual([['w', 100], ['d', 500]])
    expect(valid(merged)).toEqual([])
  })

  it('removing the first corner merges the last edge into the first', () => {
    const shape = square(400)
    shape.edges[3] = { kind: 'railing', openings: [] }
    const merged = removeCorner(shape, 0)
    expect(merged.outline).toEqual([{ x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }])
    expect(merged.edges.map(edge => edge.kind)).toEqual(['wall', 'wall', 'railing'])
    expect(valid(merged)).toEqual([])
  })

  it('never goes below three corners', () => {
    const triangle = closedShape([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }])
    expect(removeCorner(triangle, 0)).toBe(triangle)
  })
})

describe('an edge\'s kind, length and openings', () => {
  it('open edges carry nothing; railings keep gates and lose windows', () => {
    const shape = square(800, [{ id: 'w', kind: 'window', offset: 100, width: 200 }, { id: 'd', kind: 'door', offset: 500, width: 100 }])
    expect(setEdgeKind(shape, 0, 'railing').edges[0]!.openings.map(opening => opening.id)).toEqual(['d'])
    expect(setEdgeKind(shape, 0, 'open').edges[0]!.openings).toEqual([])
    expect(edgeTakes('railing', 'window')).toBe(false)
    expect(edgeTakes('railing', 'door')).toBe(true)
    expect(edgeTakes('open', 'door')).toBe(false)
  })

  it('sets a length by moving the edge\'s end corner, keeping right angles', () => {
    const longer = setEdgeLength(square(400), 0, 600)
    expect(longer.outline).toEqual([{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }])
    expect(Math.round(edgeLength(longer.outline, 0))).toBe(600)
  })

  it('adds a door in the middle of the widest free stretch, and nothing when there is no room', () => {
    const shape = square(400, [{ id: 'w', kind: 'window', offset: 0, width: 200 }])
    expect(freeSpot(shape.edges[0]!, 400, 90)).toBe(255)
    const withDoor = addOpening(shape, 0, 'door', 'd')
    expect(withDoor.edges[0]!.openings).toContainEqual({ id: 'd', kind: 'door', offset: 255, width: 90 })
    const full = square(400, [{ id: 'w', kind: 'window', offset: 0, width: 400 }])
    expect(addOpening(full, 0, 'door', 'd')).toBe(full)
    expect(addOpening(setEdgeKind(square(400), 0, 'railing'), 0, 'window', 'w').edges[0]!.openings).toEqual([])
    expect(valid(withDoor)).toEqual([])
  })

  it('a widened opening keeps its place and pushes the others out of its way', () => {
    const shape = square(800, [{ id: 'w', kind: 'window', offset: 100, width: 200 }, { id: 'd', kind: 'door', offset: 350, width: 100 }])
    const wider = updateOpening(shape, 0, 'w', { width: 300 })
    expect(wider.edges[0]!.openings).toEqual([{ id: 'w', kind: 'window', offset: 100, width: 300 }, { id: 'd', kind: 'door', offset: 400, width: 100 }])
    expect(valid(wider)).toEqual([])
  })

  it('fits openings in whole centimetres, never overlapping', () => {
    const fitted = fitOpenings({ kind: 'wall', openings: [{ id: 'a', kind: 'door', offset: 0, width: 100 }, { id: 'b', kind: 'door', offset: 50, width: 100 }] }, 250.6)
    expect(fitted.openings).toEqual([{ id: 'a', kind: 'door', offset: 0, width: 100 }, { id: 'b', kind: 'door', offset: 100, width: 100 }])
  })
})

describe('edge names and area', () => {
  it('names edges by the way they face, numbering repeats', () => {
    expect(edgeNames(lShape().outline)).toEqual(['Back edge', 'Right edge 1', 'Front edge 1', 'Right edge 2', 'Front edge 2', 'Left edge'])
    expect(edgeNames(square().outline)).toEqual(['Back edge', 'Right edge', 'Front edge', 'Left edge'])
    // Counter-clockwise corners name the same sides.
    expect(edgeNames([...square().outline].reverse())).toEqual(['Front edge', 'Right edge', 'Back edge', 'Left edge'])
    expect(areaM2(lShape().outline)).toBe(74)
  })
})

describe('starters and new floors', () => {
  it('every starter but Blank is a valid layout with no tables', () => {
    for (const starter of STARTERS) {
      const layout = starter.layout()
      expect(layout.placements).toEqual([])
      if (starter.id === 'blank') expect(layout.floors[0]!.outline).toEqual([])
      else expect((v.safeParse(layoutSchema, layout).issues ?? []).map(issue => issue.message), starter.id).toEqual([])
    }
  })

  it('a Blank layout says to draw its outline before it saves', () => {
    const layout = STARTERS.find(starter => starter.id === 'blank')!.layout()
    const issue = v.safeParse(layoutSchema, layout).issues?.[0]
    expect(describeIssue(issue, layout)).toBe('Draw the Ground floor\'s outline first.')
  })

  it('a new floor goes on top with the top floor\'s outline, plain walls and nothing on it', () => {
    const layout = STARTERS.find(starter => starter.id === 'rooftop')!.layout()
    const floor = newFloor(layout)
    expect(floor.name).toBe('Second')
    expect(floor.outline).toEqual(layout.floors[1]!.outline)
    expect(floor.outline).not.toBe(layout.floors[1]!.outline)
    expect(floor.edges.every(edge => edge.kind === 'wall' && edge.openings.length === 0)).toBe(true)
    expect(floor.items).toEqual([])
    const withFloor: ShopLayout = { ...layout, floors: [...layout.floors, floor] }
    expect(v.safeParse(layoutSchema, withFloor).success).toBe(true)
    expect(floorName(0)).toBe('Ground')
  })

  it('stops at the contract\'s floor limit', () => {
    const layout = STARTERS.find(starter => starter.id === 'wide')!.layout()
    while (canAddFloor(layout)) layout.floors.push(newFloor(layout))
    expect(layout.floors).toHaveLength(LAYOUT_MAX_FLOORS)
    expect(v.safeParse(layoutSchema, layout).success).toBe(true)
  })
})
