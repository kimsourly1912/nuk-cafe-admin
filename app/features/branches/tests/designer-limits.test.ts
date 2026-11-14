import { describe, expect, it, vi } from 'vitest'
import { computed, shallowRef, toRaw } from 'vue'
import { LAYOUT_MAX_FLOOR_BYTES, LAYOUT_MAX_ITEMS_PER_FLOOR, LAYOUT_MAX_WALLS_PER_FLOOR, NO_SCENE } from '#shared/contracts/shop-layout'
import type { Floor, LayoutItem, ShopLayout } from '#shared/contracts/shop-layout'
import { losesStreetDoor, useLayoutDraft } from '../composables/useLayoutDraft'
import { FLOOR_FULL_BYTES, FLOOR_FULL_ITEMS, FLOOR_FULL_WALLS, floorBytes, floorLimitProblem } from '../designer/limits'

function floor(items = 0, walls = 0): Floor {
  return {
    id: 'g',
    name: 'Ground',
    height: 300,
    hasRoof: true,
    outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }],
    edges: [{ kind: 'wall', openings: [{ id: 'street', kind: 'door', offset: 100, width: 90 }] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }, { kind: 'wall', openings: [] }],
    walls: Array.from({ length: walls }, (_, index) => ({ id: `w${index}`, from: { x: 10, y: 10 }, to: { x: 100, y: 10 } })),
    items: Array.from({ length: items }, (_, index) => piece(`i${index}`)),
  }
}
// useLayoutDraft uses Nuxt's auto-imported Vue functions.
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('computed', computed)
vi.stubGlobal('toRaw', toRaw)

const piece = (id: string): LayoutItem => ({ id, kind: 'plant', x: 100, y: 100, rotation: 0, width: 50, depth: 50, finishes: {} })
const layout = (ground: Floor): ShopLayout => ({ floors: [ground], placements: [], scene: NO_SCENE })

describe('a floor\'s limits in the editor (ISS-043)', () => {
  it('lets a floor reach its piece and wall limits, and refuses one more', () => {
    const almost = layout(floor(LAYOUT_MAX_ITEMS_PER_FLOOR - 1, LAYOUT_MAX_WALLS_PER_FLOOR - 1))
    const full = structuredClone(almost)
    full.floors[0]!.items.push(piece('last'))
    full.floors[0]!.walls.push({ id: 'last', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } })
    expect(floorLimitProblem(almost, full)).toBeNull()
    const over = structuredClone(full)
    over.floors[0]!.items.push(piece('over'))
    expect(floorLimitProblem(full, over)).toBe(FLOOR_FULL_ITEMS)
    const overWalls = structuredClone(full)
    overWalls.floors[0]!.walls.push({ id: 'over', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } })
    expect(floorLimitProblem(full, overWalls)).toBe(FLOOR_FULL_WALLS)
  })

  it('refuses a change that takes a floor past its size, and lets one over it shrink', () => {
    const base = layout(floor(1))
    const big = structuredClone(base)
    // A long layer name fills the floor's JSON up to just past the limit.
    const room = LAYOUT_MAX_FLOOR_BYTES - floorBytes(base.floors[0]!)
    big.floors[0]!.items[0]!.name = 'x'.repeat(room)
    expect(floorBytes(big.floors[0]!)).toBeGreaterThan(LAYOUT_MAX_FLOOR_BYTES)
    expect(floorLimitProblem(base, big)).toBe(FLOOR_FULL_BYTES)
    const smaller = structuredClone(big)
    smaller.floors[0]!.items[0]!.name = 'x'.repeat(room - 10)
    expect(floorLimitProblem(big, smaller)).toBeNull()
  })

  it('the draft does not make a refused change, and says why', () => {
    const reasons: string[] = []
    const draft = useLayoutDraft(layout(floor(LAYOUT_MAX_ITEMS_PER_FLOOR)), { onRefused: reason => reasons.push(reason) })
    const before = draft.layout.value
    expect(draft.change(next => void next.floors[0]!.items.push(piece('over')))).toBe(false)
    expect(draft.layout.value).toBe(before)
    expect(draft.canUndo.value).toBe(false)
    expect(reasons).toEqual([FLOOR_FULL_ITEMS])
    expect(draft.change(next => void next.floors[0]!.items.pop())).toBe(true)
  })
})

describe('Explore\'s street door (ISS-038)', () => {
  const explored = (): ShopLayout => ({ ...layout(floor()), scene: { preset: 'neighborhood-lane', entrance: 'street', explore: true } })

  it('notices a change that removes the street door, and only that', () => {
    const before = explored()
    const removed = structuredClone(before)
    removed.floors[0]!.edges[0]!.openings = []
    expect(losesStreetDoor(before, removed)).toBe(true)
    const moved = structuredClone(before)
    moved.floors[0]!.edges[0]!.openings[0]!.offset = 300
    expect(losesStreetDoor(before, moved)).toBe(false)
    expect(losesStreetDoor(layout(floor()), removed)).toBe(false)
  })

  it('the draft clears the door and turns Explore off with the change; undo brings both back', () => {
    const draft = useLayoutDraft(explored())
    draft.change(next => void (next.floors[0]!.edges[0]!.openings = []))
    expect(draft.layout.value.scene).toMatchObject({ entrance: null, explore: false })
    draft.undo()
    expect(draft.layout.value.scene).toMatchObject({ entrance: 'street', explore: true })
  })
})
