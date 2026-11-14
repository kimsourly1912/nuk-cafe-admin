import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { createLayoutGroupSchema, layoutSchema } from '#shared/contracts/shop-layout'
import type { ShopLayout } from '#shared/contracts/shop-layout'
import { alignOffsets, copySelected, groupFromSelection, placeGroup, cycleSelection, distributeOffsets, duplicateSelected, pasteClipboard, removeSelected, shiftSelected, turnSelected } from '../designer/group'
import { distancesToOutline, gapsBetween, segmentTouches, snapToGuides } from '../designer/guides'
import type { PlanSelection } from '../designer/plan'
import { renewRepeatedOpeningIds } from '../designer/walls'

/** One floor: a table, two pieces and a kitchen corner of two joined walls. */
function layout(): ShopLayout {
  return {
    floors: [{
      id: 'g',
      name: 'Ground',
      height: 300,
      hasRoof: true,
      slabs: [{ id: 's', outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }] }],
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
    const copies = pasteClipboard(next, clipboard, 'g', { x: 50, y: 50 })
    expect(copies.map(copy => copy.kind)).toEqual(['item', 'wall'])
    expect(next.floors[0]!.items.find(item => item.id === copies[0]!.id)).toMatchObject({ kind: 'plant', x: 150, y: 150 })
    expect(next.floors[0]!.walls.find(wall => wall.id === copies[1]!.id)).toMatchObject({ from: { x: 650, y: 450 }, to: { x: 950, y: 450 } })
    expect(next.placements).toHaveLength(0)
    // The clipboard is its own copy: changing the pasted piece leaves it as it was.
    next.floors[0]!.items[0]!.x = 999
    expect(clipboard.items[0]!.x).toBe(100)
  })
})

describe('Tab through the floor (ISS-007)', () => {
  it('goes to the next or previous one, round the end, and starts at an end', () => {
    expect(cycleSelection(set, null, 1)).toEqual(set[0])
    expect(cycleSelection(set, null, -1)).toEqual(set[2])
    expect(cycleSelection(set, set[0]!, 1)).toEqual(set[1])
    expect(cycleSelection(set, set[2]!, 1)).toEqual(set[0])
    expect(cycleSelection(set, set[0]!, -1)).toEqual(set[2])
    expect(cycleSelection(set, { kind: 'slab', id: 's' }, 1)).toEqual(set[0])
    expect(cycleSelection([], null, 1)).toBeNull()
  })
})

describe('align (ISS-026)', () => {
  const boxes = [
    { target: { kind: 'item' as const, id: 'a' }, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 } },
    { target: { kind: 'item' as const, id: 'b' }, bounds: { minX: 200, minY: 100, maxX: 260, maxY: 300 } },
  ]
  it('lines each one up with the set\'s edge, centre or middle; already there does not move', () => {
    expect(alignOffsets(boxes, 'left')).toEqual([{ target: boxes[1]!.target, delta: { x: -200, y: 0 } }])
    expect(alignOffsets(boxes, 'right')).toEqual([{ target: boxes[0]!.target, delta: { x: 160, y: 0 } }])
    expect(alignOffsets(boxes, 'center')).toEqual([{ target: boxes[0]!.target, delta: { x: 80, y: 0 } }, { target: boxes[1]!.target, delta: { x: -100, y: 0 } }])
    expect(alignOffsets(boxes, 'top')).toEqual([{ target: boxes[1]!.target, delta: { x: 0, y: -100 } }])
    expect(alignOffsets(boxes, 'bottom')).toEqual([{ target: boxes[0]!.target, delta: { x: 0, y: 250 } }])
    expect(alignOffsets(boxes, 'middle')).toEqual([{ target: boxes[0]!.target, delta: { x: 0, y: 125 } }, { target: boxes[1]!.target, delta: { x: 0, y: -50 } }])
    expect(alignOffsets([boxes[0]!], 'left')).toEqual([])
  })

  it('aligns one piece to its floor when given the floor\'s bounds (ED-11)', () => {
    const floor = { minX: 0, minY: 0, maxX: 1000, maxY: 800 }
    const one = [boxes[1]!]
    const box = one[0]!.bounds
    expect(alignOffsets(one, 'left', floor)).toEqual([{ target: one[0]!.target, delta: { x: -box.minX, y: 0 } }])
    expect(alignOffsets(one, 'bottom', floor)).toEqual([{ target: one[0]!.target, delta: { x: 0, y: 800 - box.maxY } }])
    expect(alignOffsets(one, 'center', floor)).toEqual([{ target: one[0]!.target, delta: { x: Math.round((1000 - box.minX - box.maxX) / 2), y: 0 } }])
    expect(alignOffsets([], 'left', floor)).toEqual([])
  })
})

describe('paste on another floor (ISS-022)', () => {
  it('puts the copies on the floor given, where they were', () => {
    const next = layout()
    next.floors.push({ ...structuredClone(next.floors[0]!), id: 'up', name: 'Upstairs', items: [], walls: [] })
    const copies = pasteClipboard(next, copySelected(layout(), 'g', set)!, 'up', { x: 0, y: 0 })
    expect(next.floors[1]!.items).toEqual([expect.objectContaining({ id: copies[0]!.id, kind: 'plant', x: 100, y: 100 })])
    expect(next.floors[1]!.walls).toHaveLength(1)
    expect(next.floors[0]!.items).toHaveLength(2)
  })
})

describe('distribute (owner, 2026-11-13)', () => {
  const box = (id: string, minX: number, width: number) => ({ target: { kind: 'item' as const, id }, bounds: { minX, minY: 0, maxX: minX + width, maxY: 50 } })
  it('gives three or more equal gaps, the outer two staying put', () => {
    // 0–100, 120–170, 400–500: 300 cm of room minus 50 cm in the middle, so 125 cm each side.
    expect(distributeOffsets([box('c', 400, 100), box('a', 0, 100), box('b', 120, 50)], 'x')).toEqual([{ target: { kind: 'item', id: 'b' }, delta: { x: 105, y: 0 } }])
    expect(distributeOffsets([box('a', 0, 100), box('b', 225, 50), box('c', 400, 100)], 'x')).toEqual([])
    expect(distributeOffsets([box('a', 0, 100), box('b', 300, 50)], 'x')).toEqual([])
  })
})

describe('copied doors and windows get ids of their own (ISS-042)', () => {
  /** The demo floor, with a door in wall w1. */
  function withDoor(): ShopLayout {
    const next = layout()
    next.floors[0]!.walls[0]!.openings = [{ id: 'o1', kind: 'door', offset: 100, width: 90 }]
    return next
  }
  const doorIds = (next: ShopLayout) => next.floors.flatMap(floor => floor.walls.flatMap(wall => (wall.openings ?? []).map(opening => opening.id)))
  const messages = (next: ShopLayout) => (v.safeParse(layoutSchema, next).issues ?? []).map(issue => issue.message)

  it('duplicate gives the copy\'s door a new id, and the layout saves', () => {
    const next = withDoor()
    duplicateSelected(next, 'g', [{ kind: 'wall', id: 'w1' }], { x: 0, y: 50 })
    const ids = doorIds(next)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('o1')
    expect(ids[1]).toMatch(/^door-/)
    expect(messages(next)).toEqual([])
  })

  it('each paste gives its doors new ids', () => {
    const next = withDoor()
    const clipboard = copySelected(next, 'g', [{ kind: 'wall', id: 'w1' }])!
    pasteClipboard(next, clipboard, 'g', { x: 0, y: 50 })
    pasteClipboard(next, clipboard, 'g', { x: 0, y: 100 })
    expect(new Set(doorIds(next)).size).toBe(3)
    expect(messages(next)).toEqual([])
  })

  it('the contract refuses a door id used twice in a layout', () => {
    const next = withDoor()
    next.floors[0]!.walls[1]!.openings = [{ id: 'o1', kind: 'door', offset: 100, width: 90 }]
    expect(messages(next)).toContain('Door and window ids repeat')
  })

  it('a layout saved with repeated ids gets new ones on load, keeping the first (an outer wall\'s street door)', () => {
    const next = withDoor()
    // Upgraded outer walls come first on a floor (D282).
    next.floors[0]!.walls.unshift({ id: 'front', from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, side: 'left', thickness: 20, openings: [{ id: 'o1', kind: 'door', offset: 100, width: 90 }] })
    next.floors[0]!.walls[2]!.openings = [{ id: 'o1', kind: 'door', offset: 100, width: 90 }]
    const floors = renewRepeatedOpeningIds(next.floors)
    expect(floors[0]!.walls[0]!.openings![0]!.id).toBe('o1')
    const renewed = { ...next, floors }
    expect(messages(renewed)).toEqual([])
    expect(doorIds(renewed).filter(id => id === 'o1')).toHaveLength(1)
    // Nothing repeats: the same floors back, untouched.
    const clean = withDoor()
    expect(renewRepeatedOpeningIds(clean.floors)).toBe(clean.floors)
  })
})

describe('saved groups (plan Phase 5, D284)', () => {
  const pieces: PlanSelection[] = [{ kind: 'item', id: 'plant' }, { kind: 'wall', id: 'w1' }, { kind: 'table', id: 't1' }]

  it('makes a group around the selection\'s middle, without tables or layer flags', () => {
    const next = layout()
    next.floors[0]!.items[0]!.locked = true
    const group = groupFromSelection(next, 'g', pieces)!
    // The plant at (100, 100) and the wall from (600, 400) to (900, 400): middle (500, 250).
    expect(group.items).toEqual([{ id: 'plant', kind: 'plant', x: -400, y: -150, rotation: 0, width: 50, depth: 50, finishes: {} }])
    expect(group.walls).toEqual([{ id: 'w1', from: { x: 100, y: 150 }, to: { x: 400, y: 150 } }])
    expect(v.safeParse(createLayoutGroupSchema, { name: 'Corner', ...group }).success).toBe(true)
    expect(groupFromSelection(next, 'g', [{ kind: 'table', id: 't1' }])).toBeNull()
  })

  it('places new copies around a point, with new ids, and drops a look the cafe no longer has', () => {
    const next = layout()
    const group = { items: [{ id: 'plant', kind: 'plant' as const, x: -50, y: 0, rotation: 0, width: 50, depth: 50, finishes: {}, lookId: 'gone' }], walls: [{ id: 'w', from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, openings: [{ id: 'd', kind: 'door' as const, offset: 0, width: 90 }] }] }
    const copies = placeGroup(next, 'g', group, { x: 300, y: 300 }, new Set())
    expect(copies.map(copy => copy.kind)).toEqual(['item', 'wall'])
    const item = next.floors[0]!.items.find(candidate => candidate.id === copies[0]!.id)!
    expect(item).toMatchObject({ x: 250, y: 300 })
    expect(item.lookId).toBeUndefined()
    const wall = next.floors[0]!.walls.find(candidate => candidate.id === copies[1]!.id)!
    expect(wall).toMatchObject({ from: { x: 300, y: 300 }, to: { x: 500, y: 300 } })
    expect(wall.openings![0]!.id).not.toBe('d')
    // Twice: no id repeats, so the layout saves.
    placeGroup(next, 'g', group, { x: 300, y: 500 }, new Set(['gone']))
    expect(v.safeParse(layoutSchema, next).issues?.map(issue => issue.message)).toBeUndefined()
  })
})
