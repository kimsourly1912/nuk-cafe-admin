import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Opening, Point, ShopLayout, Wall, WallKind } from '#shared/contracts/shop-layout'
import { edgeLength, floorSchema, isSimpleOutline, layoutSchema, LAYOUT_MAX_FLOORS, OUTLINE_CROSSES, wallLength } from '#shared/contracts/shop-layout'
import { areaM2, canClose, closedShape, edgeNames, insertCorner, moveCorner, moveSide, removeCorner, setEdgeLength, shapeOf, wallNames } from '../designer/outline'
import type { FloorShape } from '../designer/outline'
import { canAddFloor, floorName, newFloor, STARTERS } from '../designer/starters'
import { fitOpenings, freeSpot, wallAlong } from '../designer/walls'
import { demoLayout } from './demo-layout'

/** The demo's L-shape (clockwise on screen) with its walls, upgraded from its outline (D282). */
function lShape(): FloorShape {
  const floor = demoLayout().floors[0]!
  return shapeOf(floor, floor.slabs[0]!)
}

/** A square surface with an outer wall on each side (D282); `openings` on the top wall, `kinds` per side. */
function square(size = 400, openings: Opening[] = [], kinds: (WallKind | null)[] = ['wall', 'wall', 'wall', 'wall']): FloorShape {
  const outline = [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }]
  const walls = outline.flatMap((from, index): Wall[] => {
    const kind = kinds[index]
    if (!kind) return []
    return [{ id: `w${index}`, from, to: outline[(index + 1) % 4]!, side: 'left', thickness: 20, ...(kind !== 'wall' && { kind }), ...(index === 0 && openings.length && { openings }) }]
  })
  return { outline, walls }
}

/** The wall along a surface's side `index`, if any. */
function wallOn(shape: FloorShape, index: number): Wall | undefined {
  const from = shape.outline[index]!
  const to = shape.outline[(index + 1) % shape.outline.length]!
  return shape.walls.find(wall => wallAlong(wall, from, to))
}

/** Whether a shape is still a valid floor by the shared contract (what the server checks). */
function valid(shape: FloorShape): string[] {
  const result = v.safeParse(floorSchema, { id: 'f', name: 'Ground', height: 300, hasRoof: true, slabs: [{ id: 's', outline: shape.outline }], walls: shape.walls, items: [] })
  return (result.issues ?? []).map(issue => issue.message)
}

describe('drawing a new outline', () => {
  it('closes three or more corners with an area into a surface with outer walls around it', () => {
    expect(canClose([{ x: 0, y: 0 }, { x: 400, y: 0 }])).toBe(false)
    expect(canClose([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }])).toBe(false)
    const shape = closedShape([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }])
    expect(shape.walls.map(wall => [wall.side, wall.thickness, wall.openings])).toEqual([['left', 20, undefined], ['left', 20, undefined], ['left', 20, undefined]])
    expect(valid(shape)).toEqual([])
    // Drawn the other way round, the walls still stand outside.
    expect(closedShape([{ x: 0, y: 0 }, { x: 400, y: 300 }, { x: 400, y: 0 }]).walls[0]!.side).toBe('right')
  })
})

describe('moving a corner', () => {
  it('keeps right angles: the corners beside it follow, and so do the walls on them', () => {
    // Corner 3 is the L's inner corner (600, 500): moving it moves its neighbours' shared lines.
    const moved = moveCorner(lShape(), 3, { x: 700, y: 400 })
    expect(moved.outline).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 700, y: 400 }, { x: 700, y: 900 }, { x: 0, y: 900 }])
    for (let index = 0; index < moved.outline.length; index++) expect(wallOn(moved, index), `side ${index}`).toBeDefined()
    expect(valid(moved)).toEqual([])
  })

  it('moves only the corner when right angles are not kept (Alt)', () => {
    const moved = moveCorner(lShape(), 3, { x: 650, y: 550 }, false)
    expect(moved.outline[2]).toEqual({ x: 1000, y: 500 })
    expect(moved.outline[3]).toEqual({ x: 650, y: 550 })
    expect(moved.outline[4]).toEqual({ x: 600, y: 900 })
  })

  it('keeps doors and windows inside a shorter wall, moving or dropping what no longer fits', () => {
    // A 400 cm side with a 100 cm door at 250: shortened to 300, the door moves back to fit.
    const door = square(400, [{ id: 'd', kind: 'door', offset: 250, width: 100 }])
    const shorter = moveCorner(door, 1, { x: 300, y: 0 })
    expect(wallOn(shorter, 0)!.openings).toEqual([{ id: 'd', kind: 'door', offset: 200, width: 100 }])
    const tiny = moveCorner(door, 1, { x: 30, y: 0 })
    expect(wallOn(tiny, 0)!.openings).toBeUndefined()
    expect(valid(shorter)).toEqual([])
  })
})

describe('adding and removing corners', () => {
  it('cuts the wall along a side in two, each opening going to the half holding its middle', () => {
    const shape = square(800, [{ id: 'w', kind: 'window', offset: 100, width: 200 }, { id: 'd', kind: 'door', offset: 500, width: 100 }])
    const split = insertCorner(shape, 0)
    expect(split.outline).toHaveLength(5)
    expect(split.outline[1]).toEqual({ x: 400, y: 0 })
    expect(wallOn(split, 0)).toMatchObject({ id: 'w0', side: 'left', thickness: 20, openings: [{ id: 'w', kind: 'window', offset: 100, width: 200 }] })
    expect(wallOn(split, 1)).toMatchObject({ side: 'left', thickness: 20, openings: [{ id: 'd', kind: 'door', offset: 100, width: 100 }] })
    expect(valid(split)).toEqual([])
  })

  it('joins the two walls of a removed corner, keeping both sides\' openings', () => {
    const split = insertCorner(square(800, [{ id: 'w', kind: 'window', offset: 100, width: 200 }, { id: 'd', kind: 'door', offset: 500, width: 100 }]), 0)
    const merged = removeCorner(split, 1)
    expect(merged.outline).toHaveLength(4)
    expect(merged.walls).toHaveLength(4)
    expect(wallOn(merged, 0)!.openings!.map(opening => [opening.id, opening.offset])).toEqual([['w', 100], ['d', 500]])
    expect(valid(merged)).toEqual([])
  })

  it('removing the first corner joins the last side\'s wall with the first\'s, of the earlier one\'s kind', () => {
    const merged = removeCorner(square(400, [], ['wall', 'wall', 'wall', 'railing']), 0)
    expect(merged.outline).toEqual([{ x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }])
    expect([0, 1, 2].map(index => wallOn(merged, index)?.kind ?? 'wall')).toEqual(['wall', 'wall', 'railing'])
    expect(valid(merged)).toEqual([])
  })

  it('never goes below three corners', () => {
    const triangle = closedShape([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }])
    expect(removeCorner(triangle, 0)).toBe(triangle)
  })

  // ISS-037: the joined wall has the earlier wall's kind, so it keeps only openings that kind takes.
  it('a side with no wall joined with a walled one: no wall, so its door goes, and the floor still saves', () => {
    const shape = square(500, [], [null, 'wall', 'wall', 'wall'])
    shape.walls[0] = { ...shape.walls[0]!, openings: [{ id: 'd1', kind: 'door', offset: 100, width: 90 }] }
    const merged = removeCorner(shape, 1)
    expect(wallOn(merged, 0)).toBeUndefined()
    expect(merged.walls.flatMap(wall => wall.openings ?? [])).toEqual([])
    expect(valid(merged)).toEqual([])
  })

  it('a railing joined with a wall drops its windows and keeps its doors as gates', () => {
    const shape = square(500, [], ['railing', 'wall', 'wall', 'wall'])
    shape.walls[1] = { ...shape.walls[1]!, openings: [{ id: 'w1', kind: 'window', offset: 50, width: 90 }, { id: 'd1', kind: 'door', offset: 300, width: 90 }] }
    const merged = removeCorner(shape, 1)
    expect(wallOn(merged, 0)!.kind).toBe('railing')
    expect(wallOn(merged, 0)!.openings!.map(opening => opening.id)).toEqual(['d1'])
    expect(valid(merged)).toEqual([])
  })

  it('two walls joined keep every door and window', () => {
    const shape = square(500)
    shape.walls[1] = { ...shape.walls[1]!, openings: [{ id: 'w1', kind: 'window', offset: 50, width: 90 }, { id: 'd1', kind: 'door', offset: 300, width: 90 }] }
    const merged = removeCorner(shape, 1)
    expect(wallOn(merged, 0)!.openings!.map(opening => opening.id).sort()).toEqual(['d1', 'w1'])
    expect(valid(merged)).toEqual([])
  })
})

describe('an outline that crosses itself (ISS-039)', () => {
  it('a corner dragged across the far side makes an outline the contract refuses', () => {
    const crossed = moveCorner(square(500), 2, { x: -300, y: 250 }, false)
    expect(isSimpleOutline(crossed.outline)).toBe(false)
    expect(valid(crossed)).toContain(OUTLINE_CROSSES)
  })

  it('accepts convex, concave and right-angled outlines, and the demo\'s L-shape', () => {
    expect(isSimpleOutline(square(500).outline)).toBe(true)
    expect(isSimpleOutline(lShape().outline)).toBe(true)
    expect(isSimpleOutline([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 100 }, { x: 400, y: 400 }, { x: 0, y: 400 }])).toBe(true)
  })

  it('ignores a zero-length side (two equal corners in a row), as the editor keeps them', () => {
    expect(isSimpleOutline([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }])).toBe(true)
  })

  it('refuses sides that only touch, and a side folding back over the one before', () => {
    // Two squares meeting at one corner (400, 400).
    expect(isSimpleOutline([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 800 }, { x: 400, y: 800 }, { x: 400, y: 400 }, { x: 0, y: 400 }])).toBe(false)
    // A corner on the far side's line, touching it.
    expect(isSimpleOutline([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 200 }, { x: 400, y: 400 }, { x: 0, y: 400 }])).toBe(false)
    // A spike back along the side it came from.
    expect(isSimpleOutline([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 400 }, { x: 0, y: 400 }])).toBe(false)
  })
})

describe('a side\'s length and openings', () => {
  it('sets a length by moving the side\'s end corner, keeping right angles; the walls follow', () => {
    const longer = setEdgeLength(square(400), 0, 600)
    expect(longer.outline).toEqual([{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }])
    expect(Math.round(edgeLength(longer.outline, 0))).toBe(600)
    expect(Math.round(wallLength(wallOn(longer, 0)!))).toBe(600)
  })

  it('finds the middle of the widest free stretch for a new opening', () => {
    expect(freeSpot([{ id: 'w', kind: 'window', offset: 0, width: 200 }], 400, 90)).toBe(255)
    expect(freeSpot([{ id: 'w', kind: 'window', offset: 0, width: 400 }], 400, 90)).toBeNull()
  })

  it('fits openings in whole centimetres, never overlapping', () => {
    const fitted = fitOpenings([{ id: 'a', kind: 'door', offset: 0, width: 100 }, { id: 'b', kind: 'door', offset: 50, width: 100 }], 250.6)
    expect(fitted).toEqual([{ id: 'a', kind: 'door', offset: 0, width: 100 }, { id: 'b', kind: 'door', offset: 100, width: 100 }])
  })
})

describe('names and area', () => {
  it('names sides by the way they face, numbering repeats', () => {
    expect(edgeNames(lShape().outline)).toEqual(['Back edge', 'Right edge 1', 'Front edge 1', 'Right edge 2', 'Front edge 2', 'Left edge'])
    expect(edgeNames(square().outline)).toEqual(['Back edge', 'Right edge', 'Front edge', 'Left edge'])
    // Counter-clockwise corners name the same sides.
    expect(edgeNames([...square().outline].reverse())).toEqual(['Front edge', 'Right edge', 'Back edge', 'Left edge'])
    expect(areaM2(lShape().outline)).toBe(74)
  })

  it('names walls by the way they face out of the building (D282)', () => {
    const shape = square()
    expect(wallNames({ slabs: [{ id: 's', outline: shape.outline }], walls: shape.walls })).toEqual(['Back wall', 'Right wall', 'Front wall', 'Left wall'])
  })
})

describe('starters and new floors', () => {
  it('every starter is a valid layout with no tables; Blank is an empty floor (D282)', () => {
    for (const starter of STARTERS) {
      const layout = starter.layout()
      expect(layout.placements).toEqual([])
      if (starter.id === 'blank') expect(layout.floors[0]).toMatchObject({ slabs: [], walls: [] })
      expect((v.safeParse(layoutSchema, layout).issues ?? []).map(issue => issue.message), starter.id).toEqual([])
    }
  })

  it('a new floor goes on top, empty (owner D1)', () => {
    const layout = STARTERS.find(starter => starter.id === 'rooftop')!.layout()
    const floor = newFloor(layout)
    expect(floor.name).toBe('Second')
    expect(floor).toMatchObject({ slabs: [], walls: [], items: [] })
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

describe('Edit points (D278)', () => {
  it('drags a whole side sideways: both corners move, the sides next to it stretch, right angles stay', () => {
    const moved = moveSide(square(), 1, 100)
    expect(moved.outline).toEqual([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }])
    expect(wallOn(moved, 1)).toMatchObject({ from: { x: 500, y: 0 }, to: { x: 500, y: 400 } })
    expect(moveSide(square(), 1, -100).outline[1]).toEqual({ x: 300, y: 0 })
    expect(moveSide(square(), 1, 0)).toEqual(square())
    expect(valid(moved)).toEqual([])
  })

  it('keeps a door on a wall that shrinks under it inside the wall', () => {
    const shape = moveSide(square(400, [{ id: 'd', kind: 'door', offset: 300, width: 90 }]), 1, -150)
    const door = wallOn(shape, 0)!.openings![0]!
    expect(door.offset + door.width).toBeLessThanOrEqual(edgeLength(shape.outline, 0))
    expect(valid(shape)).toEqual([])
  })

  it('adds a corner where a side is double-clicked, on the whole centimetre; none on an existing corner', () => {
    const shape = insertCorner(square(), 0, { x: 110.4, y: 12 })
    expect(shape.outline).toEqual([{ x: 0, y: 0 }, { x: 110, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }])
    expect(shape.walls).toHaveLength(5)
    expect(insertCorner(square(), 0, { x: 0.3, y: 0 })).toEqual(square())
    expect(insertCorner(square(), 0).outline[1]).toEqual({ x: 200, y: 0 })
  })

  it('a wall not joined to a moved corner stays where it is', () => {
    const shape = square()
    const inside: Wall = { id: 'kitchen', from: { x: 100, y: 100 }, to: { x: 300, y: 100 } }
    const moved = moveCorner({ ...shape, walls: [...shape.walls, inside] }, 2, { x: 500, y: 500 })
    expect(moved.walls.find(wall => wall.id === 'kitchen')).toEqual(inside)
    const point: Point = { x: 500, y: 500 }
    expect(moved.walls.filter(wall => wall.from.x === point.x || wall.to.x === point.x)).not.toHaveLength(0)
  })
})
