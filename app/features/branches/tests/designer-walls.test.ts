import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { Wall } from '#shared/contracts/shop-layout'
import { floorSchema, wallLength } from '#shared/contracts/shop-layout'
import { openingSpan, wallPieces } from '../designer/geometry'
import { addWallOpening, copyStructure, drawWalls, followPoints, joinWalls, moveWall, moveWallEnd, removeWallOpening, setOpeningShape, setWallKind, setWallLength, setWallStructure, splitWall, updateWallOpening, wallOpeningFits } from '../designer/walls'

const SQUARE = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }]

/** Whether these inside walls make a valid floor by the shared contract (what the server checks). */
function valid(walls: Wall[]): string[] {
  const result = v.safeParse(floorSchema, { id: 'f', name: 'Ground', height: 300, hasRoof: true, slabs: [{ id: 's', outline: SQUARE }], walls, items: [] })
  return (result.issues ?? []).map(issue => issue.message)
}

/** A kitchen's corner: two walls joined at (400, 300). */
function corner(): Wall[] {
  return [
    { id: 'a', from: { x: 100, y: 300 }, to: { x: 400, y: 300 } },
    { id: 'b', from: { x: 400, y: 300 }, to: { x: 400, y: 0 } },
  ]
}

describe('inside walls (D278)', () => {
  it('saves a plain wall as before: no kind, no openings', () => {
    expect(setWallKind(corner(), 'a', 'wall')[0]).toEqual({ id: 'a', from: { x: 100, y: 300 }, to: { x: 400, y: 300 } })
    expect(valid(corner())).toEqual([])
  })

  it('takes doors and windows on a wall, doors only on a railing, half wall or glass', () => {
    let walls = setWallLength(corner(), 'a', 600)
    walls = addWallOpening(walls, 'a', 'door', 'd1')
    walls = addWallOpening(walls, 'a', 'window', 'w1')
    expect(walls[0]!.openings!.map(opening => opening.kind)).toEqual(['door', 'window'])
    expect(valid(walls)).toEqual([])
    for (const kind of ['railing', 'half', 'glass'] as const) {
      const changed = setWallKind(walls, 'a', kind)
      expect(changed[0]!.kind).toBe(kind)
      expect(changed[0]!.openings!.map(opening => opening.kind)).toEqual(['door'])
      expect(wallOpeningFits(changed[0]!, 'window')).toBe(false)
      expect(addWallOpening(changed, 'a', 'window', 'w2')).toEqual(changed)
      expect(valid(changed)).toEqual([])
    }
  })

  it('refuses at the contract what the editor never makes: a window in glass, a door past the end', () => {
    const glass: Wall = { id: 'g', from: { x: 0, y: 300 }, to: { x: 300, y: 300 }, kind: 'glass', openings: [{ id: 'w', kind: 'window', offset: 0, width: 100 }] }
    expect(valid([glass])).toContain('A window needs a full wall')
    const long: Wall = { id: 'l', from: { x: 0, y: 300 }, to: { x: 300, y: 300 }, openings: [{ id: 'd', kind: 'door', offset: 250, width: 90 }] }
    expect(valid([long])).toContain('A door or window does not fit its wall')
  })

  it('moves and resizes openings within the wall; a shorter wall pushes or drops them', () => {
    let walls = addWallOpening(corner(), 'a', 'door', 'd1')
    walls = updateWallOpening(walls, 'a', 'd1', { offset: 500, width: 100 })
    expect(walls[0]!.openings![0]).toMatchObject({ offset: 200, width: 100 })
    walls = setWallLength(walls, 'a', 150)
    expect(wallLength(walls[0]!)).toBe(150)
    expect(walls[0]!.openings![0]).toMatchObject({ offset: 50, width: 100 })
    walls = setWallLength(walls, 'a', 30)
    expect(walls[0]!.openings).toBeUndefined()
    expect(removeWallOpening(addWallOpening(corner(), 'b', 'door', 'd2'), 'b', 'd2')[1]!.openings).toBeUndefined()
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

describe('walls of any kind and how they are built (D282)', () => {
  it('keeps a wall\'s side, thickness, height and layer name through every edit', () => {
    const walls: Wall[] = [{ id: 'a', from: { x: 0, y: 0 }, to: { x: 500, y: 0 }, side: 'left', thickness: 20, height: 250, name: 'Front' }]
    const kinded = setWallKind(walls, 'a', 'half')[0]!
    expect(kinded).toMatchObject({ side: 'left', thickness: 20, height: 250, name: 'Front', kind: 'half' })
    const opened = addWallOpening(walls, 'a', 'door', 'd1')[0]!
    expect(opened).toMatchObject({ side: 'left', thickness: 20, name: 'Front', openings: [{ id: 'd1' }] })
  })

  it('sets and clears thickness, height and side', () => {
    const walls: Wall[] = [{ id: 'a', from: { x: 0, y: 0 }, to: { x: 500, y: 0 } }]
    const built = setWallStructure(walls, 'a', { thickness: 30, height: 200, side: 'right' })[0]!
    expect(built).toMatchObject({ thickness: 30, height: 200, side: 'right' })
    expect(valid([built])).toEqual([])
    expect(setWallStructure([built], 'a', { thickness: null, height: null, side: null })[0]).toEqual(walls[0])
  })

  it('draws an outer wall beside its line and swings its doors into the room', () => {
    // Along the top of a clockwise floor: outside is up (the screen's left looking right).
    const [drawing] = drawWalls([{ id: 'a', from: { x: 0, y: 0 }, to: { x: 500, y: 0 }, side: 'left', thickness: 20, openings: [{ id: 'd', kind: 'door', offset: 100, width: 90 }] }])
    expect([drawing!.near, drawing!.far]).toEqual([0, -20])
    expect(drawing!.doors[0]!.swing.y).toBeGreaterThan(0)
    const [centred] = drawWalls([{ id: 'b', from: { x: 0, y: 0 }, to: { x: 500, y: 0 } }])
    expect([centred!.near, centred!.far]).toEqual([-6, 6])
  })

  it('mitres two outer walls at a corner, so the 3D wall reaches its outer corner', () => {
    const [top, right] = drawWalls([
      { id: 'top', from: { x: 0, y: 0 }, to: { x: 500, y: 0 }, side: 'left', thickness: 20 },
      { id: 'right', from: { x: 500, y: 0 }, to: { x: 500, y: 400 }, side: 'left', thickness: 20 },
    ])
    expect(top!.reach.end).toBeCloseTo(20)
    expect(right!.reach.start).toBeCloseTo(20)
    // Loose ends: an outer wall stops at its end, a centred one runs half its thickness past it.
    expect(top!.reach.start).toBe(0)
  })

  it('joined points: a moved corner takes the wall ends on it along', () => {
    const walls: Wall[] = [{ id: 'a', from: { x: 0, y: 0 }, to: { x: 500, y: 0 } }, { id: 'b', from: { x: 500, y: 0 }, to: { x: 500, y: 400 } }]
    const moved = followPoints(walls, [{ from: { x: 500, y: 0 }, to: { x: 600, y: 0 } }])
    expect(moved.map(wall => [wall.from, wall.to])).toEqual([[{ x: 0, y: 0 }, { x: 600, y: 0 }], [{ x: 600, y: 0 }, { x: 500, y: 400 }]])
  })

  it('splits a wall at a point and joins two walls back, keeping doors on the right half', () => {
    const wall: Wall = { id: 'a', from: { x: 0, y: 0 }, to: { x: 800, y: 0 }, side: 'left', openings: [{ id: 'd1', kind: 'door', offset: 100, width: 90 }, { id: 'd2', kind: 'door', offset: 600, width: 90 }] }
    const [first, second] = splitWall(wall, { x: 400, y: 0 }, 'b')
    expect(first.openings?.map(opening => opening.id)).toEqual(['d1'])
    expect(second).toMatchObject({ id: 'b', from: { x: 400, y: 0 }, side: 'left', openings: [{ id: 'd2', offset: 200 }] })
    expect(joinWalls(first, second)).toMatchObject({ id: 'a', from: { x: 0, y: 0 }, to: { x: 800, y: 0 }, openings: [{ id: 'd1', offset: 100 }, { id: 'd2', offset: 600 }] })
  })

  it('copies a floor\'s surfaces and walls with new ids and without doors or windows (owner D1)', () => {
    const copied = copyStructure({ slabs: [{ id: 's', outline: SQUARE }], walls: [{ id: 'a', from: { x: 0, y: 0 }, to: { x: 800, y: 0 }, side: 'left', thickness: 20, openings: [{ id: 'd', kind: 'door', offset: 0, width: 90 }], name: 'Front' }] })
    expect(copied.slabs[0]!.id).not.toBe('s')
    expect(copied.walls[0]).toEqual({ id: expect.stringMatching(/^wall-/), from: { x: 0, y: 0 }, to: { x: 800, y: 0 }, side: 'left', thickness: 20 })
  })
})

describe('doors and windows built as wanted (owner D3, plan Phase 3)', () => {
  const host = (openings: Wall['openings']): Wall[] => [{ id: 'a', from: { x: 0, y: 0 }, to: { x: 600, y: 0 }, side: 'left', thickness: 20, openings }]

  it('a door is 210 cm and a window 90 to 220 cm unless set; never above the wall', () => {
    expect(openingSpan({ kind: 'door' }, 300)).toEqual({ bottom: 0, top: 210 })
    expect(openingSpan({ kind: 'window' }, 300)).toEqual({ bottom: 90, top: 220 })
    expect(openingSpan({ kind: 'door', height: 250 }, 300)).toEqual({ bottom: 0, top: 250 })
    expect(openingSpan({ kind: 'window', sill: 30, height: 200 }, 300)).toEqual({ bottom: 30, top: 230 })
    expect(openingSpan({ kind: 'window', sill: 100, height: 300 }, 280)).toEqual({ bottom: 100, top: 280 })
    // The wall above a tall door and below a low window stays solid.
    expect(wallPieces(600, 300, [{ id: 'w', kind: 'window', offset: 100, width: 100, sill: 30, height: 200 }])).toContainEqual({ from: 100, to: 200, bottom: 0, top: 30 })
  })

  it('stores only what differs from the default, and only on the kind that has it', () => {
    const door = setOpeningShape(host([{ id: 'd', kind: 'door', offset: 100, width: 90 }]), 'a', 'd', { height: 240, swing: 'out', hinge: 'end', leaf: true })[0]!.openings![0]!
    expect(door).toEqual({ id: 'd', kind: 'door', offset: 100, width: 90, height: 240, swing: 'out', hinge: 'end' })
    const back = setOpeningShape(host([door]), 'a', 'd', { height: null, swing: 'in', hinge: 'start', leaf: false })[0]!.openings![0]!
    expect(back).toEqual({ id: 'd', kind: 'door', offset: 100, width: 90, leaf: false })
    const window = setOpeningShape(host([{ id: 'w', kind: 'window', offset: 100, width: 90 }]), 'a', 'w', { sill: 40, swing: 'out' })[0]!.openings![0]!
    expect(window).toEqual({ id: 'w', kind: 'window', offset: 100, width: 90, sill: 40 })
  })

  it('the contract refuses a sill on a door and a leaf on a window', () => {
    const messages = (openings: Wall['openings']) => (v.safeParse(floorSchema, { id: 'f', name: 'Ground', height: 300, hasRoof: true, slabs: [], walls: host(openings), items: [] }).issues ?? []).map(issue => issue.message)
    expect(messages([{ id: 'd', kind: 'door', offset: 0, width: 90, sill: 10 }])).toContain('Only a window has a sill')
    expect(messages([{ id: 'w', kind: 'window', offset: 0, width: 90, swing: 'out' }])).toContain('Only a door has a leaf')
    expect(messages([{ id: 'd', kind: 'door', offset: 0, width: 90, height: 240, swing: 'out', hinge: 'end', leaf: false }])).toEqual([])
  })

  it('draws a door from its hinge, into the room or out; an open doorway has no leaf', () => {
    const swing = (opening: NonNullable<Wall['openings']>[number]) => drawWalls(host([opening]))[0]!.doors[0]
    // An outer wall along the top (outside up): a door opens down, into the room.
    expect(swing({ id: 'd', kind: 'door', offset: 100, width: 90 })).toEqual({ id: 'd', hinge: { x: 100, y: 0 }, swing: { x: 100, y: 90 } })
    expect(swing({ id: 'd', kind: 'door', offset: 100, width: 90, hinge: 'end', swing: 'out' })).toEqual({ id: 'd', hinge: { x: 190, y: 0 }, swing: { x: 190, y: -90 } })
    expect(swing({ id: 'd', kind: 'door', offset: 100, width: 90, leaf: false })).toBeUndefined()
  })
})
