import { describe, expect, it } from 'vitest'
import type { Floor, ShopLayout } from '#shared/contracts/shop-layout'
import { addPage, besideFrames, effectiveFrames, floorsOnPage, removePage, renamePage, setFloorPage } from '../designer/pages'

const square = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }]
const floor = (id: string, extra: Partial<Floor> = {}): Floor => ({ id, name: id, height: 300, hasRoof: true, outline: square, edges: square.map(() => ({ kind: 'wall' as const, openings: [] })), walls: [], items: [], ...extra })
const layout = (): ShopLayout => ({ floors: [floor('ground'), floor('up')], placements: [] })

describe('Studio pages (ISS-036)', () => {
  it('puts every floor on the default page until pages are made', () => {
    expect(floorsOnPage(layout(), 'floors').map(f => f.id)).toEqual(['ground', 'up'])
  })

  it('adds and renames a page; a floor moves to it and back', () => {
    const next = layout()
    addPage(next, { id: 'plans', name: 'Plans' })
    expect(next.pages).toEqual([{ id: 'floors', name: 'Floors' }, { id: 'plans', name: 'Plans' }])
    setFloorPage(next, 'up', 'plans')
    expect(next.floors[1]!.pageId).toBe('plans')
    expect(floorsOnPage(next, 'floors').map(f => f.id)).toEqual(['ground'])
    renamePage(next, 'plans', 'Ideas')
    expect(next.pages![1]!.name).toBe('Ideas')
    setFloorPage(next, 'up', 'floors')
    expect(next.floors[1]).not.toHaveProperty('pageId')
  })

  it('never removes a page with floors, nor the last page', () => {
    const next = layout()
    addPage(next, { id: 'plans', name: 'Plans' })
    setFloorPage(next, 'up', 'plans')
    expect(removePage(next, 'plans')).toBe(false)
    expect(removePage(next, 'floors')).toBe(false)
    setFloorPage(next, 'up', 'floors')
    expect(removePage(next, 'plans')).toBe(true)
    expect(next.pages).toEqual([{ id: 'floors', name: 'Floors' }])
    expect(removePage(next, 'floors')).toBe(false)
  })

  it('places a new frame to the right of the others, top-aligned', () => {
    expect(besideFrames([], square)).toEqual({ x: 0, y: 0 })
    expect(besideFrames([floor('a'), floor('b', { canvasX: 1000, canvasY: 50 })], square)).toEqual({ x: 2000, y: 0 })
  })

  it('lays out floors never placed side by side, keeping saved offsets (floors saved before frames)', () => {
    expect(effectiveFrames([floor('ground'), floor('up'), floor('roof')])).toEqual({ ground: { x: 0, y: 0 }, up: { x: 1000, y: 0 }, roof: { x: 2000, y: 0 } })
    expect(effectiveFrames([floor('ground', { canvasX: 50 }), floor('up')])).toEqual({ ground: { x: 50, y: 0 }, up: { x: 1050, y: 0 } })
    expect(effectiveFrames([floor('ground'), floor('up', { canvasX: -900, canvasY: 300 })]).up).toEqual({ x: -900, y: 300 })
  })
})
