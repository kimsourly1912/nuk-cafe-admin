import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Floor, Point, Wall } from '#shared/contracts/shop-layout'
import { floorFromV1, floorSchema, wallLength } from '#shared/contracts/shop-layout'
import { addRoom } from '../designer/rooms'

type Structure = Pick<Floor, 'slabs' | 'walls'>

/** 800 × 600, clockwise on screen, a door on the top wall and a railing on the left (upgraded, D282). */
function shop(): Structure {
  const { slabs, walls } = floorFromV1({
    id: 'g',
    name: 'Ground',
    height: 300,
    hasRoof: true,
    outline: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }],
    edges: [
      { kind: 'wall', openings: [{ id: 'door', kind: 'door', offset: 100, width: 90 }] },
      { kind: 'wall', openings: [] },
      { kind: 'wall', openings: [] },
      { kind: 'railing', openings: [] },
    ],
    walls: [],
    items: [],
  })
  return { slabs, walls }
}

function floorOf(result: ReturnType<typeof addRoom>): Structure {
  if (!('floor' in result)) throw new Error(result.refused)
  return result.floor
}

/** Whether a floor is valid by the shared contract (what the server checks). */
function valid(floor: Structure): string[] {
  return (v.safeParse(floorSchema, { id: 'f', name: 'Ground', height: 300, hasRoof: true, items: [], ...floor }).issues ?? []).map(issue => issue.message)
}

/** The total length of the outer walls (those beside their line), in cm. */
const outerLength = (walls: readonly Wall[]) => Math.round(walls.filter(wall => wall.side).reduce((sum, wall) => sum + wallLength(wall), 0))
const onLine = (wall: Wall, y: number) => wall.from.y === y && wall.to.y === y
const touches = (wall: Wall, point: Point) => [wall.from, wall.to].some(end => end.x === point.x && end.y === point.y)

describe('the Room tool (D278, D282)', () => {
  it('makes an empty floor\'s first surface with walls all round', () => {
    const floor = floorOf(addRoom({ slabs: [], walls: [] }, { minX: 0, minY: 0, maxX: 400, maxY: 300 }, false))
    expect(floor.slabs).toHaveLength(1)
    expect(floor.slabs[0]!.outline).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])
    expect(floor.walls).toHaveLength(4)
    expect(floor.walls.every(wall => wall.side && wall.thickness === 20)).toBe(true)
    expect(valid(floor)).toEqual([])
    expect(addRoom({ slabs: [], walls: [] }, { minX: 0, minY: 0, maxX: 400, maxY: 300 }, true)).toHaveProperty('refused')
  })

  it('merges a room into an L: the walls on the shared line go, the door stays, the new sides get walls', () => {
    const floor = floorOf(addRoom(shop(), { minX: 800, minY: 300, maxX: 1200, maxY: 600 }, false))
    expect(floor.slabs).toHaveLength(1)
    expect(floor.slabs[0]!.outline).toHaveLength(6)
    // The L's perimeter: 800 + 300 + 400 + 300 + 1200 + 600.
    expect(outerLength(floor.walls)).toBe(3600)
    expect(floor.walls.flatMap(wall => wall.openings ?? [])).toEqual([{ id: 'door', kind: 'door', offset: 100, width: 90 }])
    expect(floor.walls.some(wall => wall.kind === 'railing')).toBe(true)
    // Nothing stands on the old right side's lower half, now inside.
    expect(floor.walls.some(wall => wall.from.x === 800 && wall.to.x === 800 && Math.min(wall.from.y, wall.to.y) >= 300)).toBe(false)
    expect(valid(floor)).toEqual([])
  })

  it('cuts a notch out: the walls of the part that goes go with its door; the notch gets walls', () => {
    const floor = floorOf(addRoom(shop(), { minX: 0, minY: -50, maxX: 300, maxY: 200 }, true))
    expect(floor.slabs[0]!.outline).toHaveLength(6)
    expect(floor.walls.flatMap(wall => wall.openings ?? [])).toEqual([])
    expect(floor.walls.some(wall => onLine(wall, 200) && touches(wall, { x: 0, y: 200 }))).toBe(true)
    expect(outerLength(floor.walls)).toBe(2800)
    expect(valid(floor)).toEqual([])
  })

  it('a room apart from the floor is a surface of its own; a cut through the middle splits it in two (D282)', () => {
    const apart = floorOf(addRoom(shop(), { minX: 1000, minY: 0, maxX: 1300, maxY: 300 }, false))
    expect(apart.slabs).toHaveLength(2)
    expect(valid(apart)).toEqual([])
    const split = floorOf(addRoom(shop(), { minX: 300, minY: -100, maxX: 500, maxY: 700 }, true))
    expect(split.slabs).toHaveLength(2)
    expect(valid(split)).toEqual([])
    // A cut over the whole floor leaves it empty, walls and all.
    expect(floorOf(addRoom(shop(), { minX: -100, minY: -100, maxX: 900, maxY: 700 }, true))).toEqual({ slabs: [], walls: [] })
  })

  it('refuses a cut that leaves a hole, and a tiny room', () => {
    expect(addRoom(shop(), { minX: 300, minY: 200, maxX: 500, maxY: 400 }, true)).toEqual({ refused: 'That would leave a hole in the floor: cut from its edge.' })
    expect(addRoom(shop(), { minX: 0, minY: 0, maxX: 20, maxY: 300 }, false)).toHaveProperty('refused')
  })

  it('changes no surface for a room inside the floor, and leaves no walls inside it', () => {
    const before = shop()
    const floor = floorOf(addRoom(before, { minX: 100, minY: 100, maxX: 300, maxY: 300 }, false))
    expect(floor.slabs).toEqual(before.slabs)
    expect(outerLength(floor.walls)).toBe(outerLength(before.walls))
  })
})
