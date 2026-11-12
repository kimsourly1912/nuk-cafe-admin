import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { InnerWall } from '#shared/contracts/shop-layout'
import { floorSchema, innerWallLength } from '#shared/contracts/shop-layout'
import { addInnerOpening, innerOpeningFits, moveWall, moveWallEnd, removeInnerOpening, setInnerWallKind, setInnerWallLength, updateInnerOpening } from '../designer/walls'

const SQUARE = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }]

/** Whether these inside walls make a valid floor by the shared contract (what the server checks). */
function valid(walls: InnerWall[]): string[] {
  const edges = SQUARE.map(() => ({ kind: 'wall' as const, openings: [] }))
  const result = v.safeParse(floorSchema, { id: 'f', name: 'Ground', height: 300, hasRoof: true, outline: SQUARE, edges, walls, items: [] })
  return (result.issues ?? []).map(issue => issue.message)
}

/** A kitchen's corner: two walls joined at (400, 300). */
function corner(): InnerWall[] {
  return [
    { id: 'a', from: { x: 100, y: 300 }, to: { x: 400, y: 300 } },
    { id: 'b', from: { x: 400, y: 300 }, to: { x: 400, y: 0 } },
  ]
}

describe('inside walls (D278)', () => {
  it('saves a plain wall as before: no kind, no openings', () => {
    expect(setInnerWallKind(corner(), 'a', 'wall')[0]).toEqual({ id: 'a', from: { x: 100, y: 300 }, to: { x: 400, y: 300 } })
    expect(valid(corner())).toEqual([])
  })

  it('takes doors and windows on a wall, doors only on a railing, half wall or glass', () => {
    let walls = setInnerWallLength(corner(), 'a', 600)
    walls = addInnerOpening(walls, 'a', 'door', 'd1')
    walls = addInnerOpening(walls, 'a', 'window', 'w1')
    expect(walls[0]!.openings!.map(opening => opening.kind)).toEqual(['door', 'window'])
    expect(valid(walls)).toEqual([])
    for (const kind of ['railing', 'half', 'glass'] as const) {
      const changed = setInnerWallKind(walls, 'a', kind)
      expect(changed[0]!.kind).toBe(kind)
      expect(changed[0]!.openings!.map(opening => opening.kind)).toEqual(['door'])
      expect(innerOpeningFits(changed[0]!, 'window')).toBe(false)
      expect(addInnerOpening(changed, 'a', 'window', 'w2')).toEqual(changed)
      expect(valid(changed)).toEqual([])
    }
  })

  it('refuses at the contract what the editor never makes: a window in glass, a door past the end', () => {
    const glass: InnerWall = { id: 'g', from: { x: 0, y: 300 }, to: { x: 300, y: 300 }, kind: 'glass', openings: [{ id: 'w', kind: 'window', offset: 0, width: 100 }] }
    expect(valid([glass])).toContain('A window needs a full wall')
    const long: InnerWall = { id: 'l', from: { x: 0, y: 300 }, to: { x: 300, y: 300 }, openings: [{ id: 'd', kind: 'door', offset: 250, width: 90 }] }
    expect(valid([long])).toContain('A door or window does not fit its wall')
  })

  it('moves and resizes openings within the wall; a shorter wall pushes or drops them', () => {
    let walls = addInnerOpening(corner(), 'a', 'door', 'd1')
    walls = updateInnerOpening(walls, 'a', 'd1', { offset: 500, width: 100 })
    expect(walls[0]!.openings![0]).toMatchObject({ offset: 200, width: 100 })
    walls = setInnerWallLength(walls, 'a', 150)
    expect(innerWallLength(walls[0]!)).toBe(150)
    expect(walls[0]!.openings![0]).toMatchObject({ offset: 50, width: 100 })
    walls = setInnerWallLength(walls, 'a', 30)
    expect(walls[0]!.openings).toBeUndefined()
    expect(removeInnerOpening(addInnerOpening(corner(), 'b', 'door', 'd2'), 'b', 'd2')[1]!.openings).toBeUndefined()
  })

  it('drags an end with the joined end of its neighbour, so the corner stays closed', () => {
    const walls = moveWallEnd(corner(), 'a', 'to', { x: 500, y: 300 })
    expect(walls[0]!.to).toEqual({ x: 500, y: 300 })
    expect(walls[1]!.from).toEqual({ x: 500, y: 300 })
    expect(walls[1]!.to).toEqual({ x: 400, y: 0 })
    // An end dragged onto the other end would leave no wall: nothing changes.
    expect(moveWallEnd(corner(), 'a', 'to', { x: 100, y: 300 })).toEqual(corner())
  })

  it('moves a whole wall; the walls joined to it stretch to follow', () => {
    const walls = moveWall(corner(), 'b', { x: 50, y: 0 })
    expect(walls[1]).toMatchObject({ from: { x: 450, y: 300 }, to: { x: 450, y: 0 } })
    expect(walls[0]).toMatchObject({ from: { x: 100, y: 300 }, to: { x: 450, y: 300 } })
    expect(valid(walls)).toEqual([])
  })
})
