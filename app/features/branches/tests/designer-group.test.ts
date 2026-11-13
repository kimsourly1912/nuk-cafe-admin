import { describe, expect, it } from 'vitest'
import type { ShopLayout } from '#shared/contracts/shop-layout'
import { copySelected, duplicateSelected, pasteClipboard, removeSelected, shiftSelected, turnSelected } from '../designer/group'
import { distancesToOutline, gapsBetween, segmentTouches, snapToGuides } from '../designer/guides'
import type { PlanSelection } from '../designer/plan'

/** One floor: a table, two pieces and a kitchen corner of two joined walls. */
function layout(): ShopLayout {
  return {
    floors: [{
      id: 'g',
      name: 'Ground',
      height: 300,
      hasRoof: true,
      outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }],
      edges: Array.from({ length: 4 }, () => ({ kind: 'wall' as const, openings: [] })),
      walls: [
        { id: 'w1', from: { x: 600, y: 400 }, to: { x: 900, y: 400 } },
        { id: 'w2', from: { x: 600, y: 400 }, to: { x: 600, y: 800 } },
      ],
      items: [
        { id: 'plant', kind: 'plant', x: 100, y: 100, rotation: 0, width: 50, depth: 50, finishes: {} },
        { id: 'sofa', kind: 'sofa', x: 300, y: 100, rotation: 0, width: 180, depth: 88, finishes: {} },
      ],
    }],
    placements: [{ tableId: 't1', floorId: 'g', x: 200, y: 300, rotation: 0, width: 80, depth: 80, lookId: 'round-cafe' }],
  }
}

const set: PlanSelection[] = [{ kind: 'table', id: 't1' }, { kind: 'item', id: 'plant' }, { kind: 'wall', id: 'w1' }]

describe('several selected together (D278)', () => {
  it('moves the set by one step; a wall joined to a moved wall stretches to follow', () => {
    const next = layout()
    shiftSelected(next, 'g', set, { x: 50, y: -25 })
    expect(next.placements[0]).toMatchObject({ x: 250, y: 275 })
    expect(next.floors[0]!.items[0]).toMatchObject({ x: 150, y: 75 })
    expect(next.floors[0]!.items[1]).toMatchObject({ x: 300, y: 100 })
    expect(next.floors[0]!.walls[0]).toMatchObject({ from: { x: 650, y: 375 }, to: { x: 950, y: 375 } })
    expect(next.floors[0]!.walls[1]).toMatchObject({ from: { x: 650, y: 375 }, to: { x: 600, y: 800 } })
  })

  it('turns the set 90° around a centre, each piece turning with it', () => {
    const next = layout()
    turnSelected(next, 'g', [{ kind: 'table', id: 't1' }, { kind: 'item', id: 'plant' }], { x: 150, y: 200 })
    expect(next.placements[0]).toMatchObject({ x: 50, y: 250, rotation: 90 })
    expect(next.floors[0]!.items[0]).toMatchObject({ x: 250, y: 150, rotation: 90 })
  })

  it('removes tables from the map and deletes furniture and walls', () => {
    const next = layout()
    removeSelected(next, set)
    expect(next.placements).toEqual([])
    expect(next.floors[0]!.items.map(item => item.id)).toEqual(['sofa'])
    expect(next.floors[0]!.walls.map(wall => wall.id)).toEqual(['w2'])
  })

  it('duplicates furniture and walls (new ids, moved), never a table', () => {
    const next = layout()
    const copies = duplicateSelected(next, 'g', set, { x: 50, y: 50 })
    expect(copies.map(copy => copy.kind)).toEqual(['item', 'wall'])
    expect(next.placements).toHaveLength(1)
    const plant = next.floors[0]!.items.find(item => item.id === copies[0]!.id)!
    expect(plant).toMatchObject({ kind: 'plant', x: 150, y: 150 })
    expect(next.floors[0]!.walls.find(wall => wall.id === copies[1]!.id)).toMatchObject({ from: { x: 650, y: 450 }, to: { x: 950, y: 450 } })
  })
})

describe('smart guides and gaps (D278)', () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY })

  it('snaps the nearest line within the threshold, per axis, and draws what it lines up with', () => {
    const snapped = snapToGuides(box(103, 400, 203, 450), [box(0, 0, 100, 100), box(500, 452, 600, 500)], 8)
    expect(snapped).toMatchObject({ dx: -3, dy: 2 })
    expect(snapped.guides.some(guide => guide.axis === 'x' && guide.at === 100)).toBe(true)
    expect(snapped.guides.some(guide => guide.axis === 'y' && guide.at === 452)).toBe(true)
    expect(snapToGuides(box(120, 400, 220, 450), [box(0, 0, 100, 100)], 8)).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('measures the gap across or down between two pieces, and from inside to the sides of a bigger one', () => {
    expect(gapsBetween(box(0, 0, 100, 100), box(150, 20, 250, 80)).map(gap => gap.length)).toEqual([50])
    expect(gapsBetween(box(0, 0, 100, 100), box(0, 160, 100, 200)).map(gap => gap.length)).toEqual([60])
    expect(gapsBetween(box(40, 40, 60, 60), box(0, 0, 100, 200)).map(gap => gap.length)).toEqual([40, 40, 40, 140])
    expect(gapsBetween(box(0, 0, 100, 100), box(50, 50, 150, 150))).toEqual([])
  })

  it('measures from each side of a piece to the walls around it', () => {
    const outline = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }]
    expect(distancesToOutline(box(100, 200, 300, 300), outline).map(gap => gap.length)).toEqual([100, 700, 200, 500])
  })

  it('a box selection picks a wall it crosses, not one beside it', () => {
    expect(segmentTouches(box(0, 0, 100, 100), { x: -50, y: 50 }, { x: 200, y: 50 })).toBe(true)
    expect(segmentTouches(box(0, 0, 100, 100), { x: 150, y: -50 }, { x: 150, y: 200 })).toBe(false)
    expect(segmentTouches(box(0, 0, 100, 100), { x: -10, y: 150 }, { x: 150, y: -10 })).toBe(true)
  })
})

describe('copy and paste (ISS-022)', () => {
  it('copies pieces and walls as they are, and tables by id only', () => {
    const clipboard = copySelected(layout(), 'g', set)!
    expect(clipboard.items.map(item => item.id)).toEqual(['plant'])
    expect(clipboard.walls.map(wall => wall.id)).toEqual(['w1'])
    expect(clipboard.tableIds).toEqual(['t1'])
    expect(copySelected(layout(), 'g', [])).toBeNull()
    expect(copySelected(layout(), 'other', set)).toBeNull()
  })

  it('pastes new copies even after the originals were deleted, never a table', () => {
    const before = layout()
    const clipboard = copySelected(before, 'g', set)!
    const next = layout()
    removeSelected(next, set)
    const copies = pasteClipboard(next, clipboard, { x: 50, y: 50 })
    expect(copies.map(copy => copy.kind)).toEqual(['item', 'wall'])
    expect(next.floors[0]!.items.find(item => item.id === copies[0]!.id)).toMatchObject({ kind: 'plant', x: 150, y: 150 })
    expect(next.floors[0]!.walls.find(wall => wall.id === copies[1]!.id)).toMatchObject({ from: { x: 650, y: 450 }, to: { x: 950, y: 450 } })
    expect(next.placements).toHaveLength(0)
    // The clipboard is its own copy: changing the pasted piece leaves it as it was.
    next.floors[0]!.items[0]!.x = 999
    expect(clipboard.items[0]!.x).toBe(100)
  })
})
