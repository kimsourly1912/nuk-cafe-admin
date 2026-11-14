import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { createItemLookSchema, createLookSchema, floorSchema, isFinishColor, itemSchema } from '#shared/contracts/shop-layout'
import type { Floor, LayoutItem, TableLook, Wall } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, finishColor, finishSwatch, itemSlotMaterial, lookSlotMaterial } from '../designer/catalog'
import { buildItem, buildTable, createBuildContext, disposeBuildContext, meshesOf } from '../designer/scene/furniture'
import { createMaterialLibrary } from '../designer/scene/materials'
import { buildFloor } from '../designer/scene/building'
import { setSlabFinish } from '../designer/outline'
import { copyStructure, setWallKind, setWallStructure } from '../designer/walls'

/** Free colours (D285, owner D2): a finish is a palette key or `#rrggbb`. */
describe('free colours', () => {
  const chair = (finishes: LayoutItem['finishes']): LayoutItem => ({ id: 'chair', kind: 'cafe-chair', x: 0, y: 0, rotation: 0, width: 48, depth: 53, finishes })

  it('the contract takes a palette key or six lowercase hex digits, and nothing else', () => {
    expect(isFinishColor('#a0522d')).toBe(true)
    for (const bad of ['#A0522D', '#a0522', 'a0522d', '#a0522dff', 'red', '#ggg000']) expect(isFinishColor(bad), bad).toBe(false)
    expect(v.safeParse(itemSchema, chair({ frame: '#a0522d', seat: 'olive' })).success).toBe(true)
    const issues = v.safeParse(itemSchema, chair({ frame: '#A0522D' })).issues ?? []
    expect(issues.map(issue => issue.message)).toContain('Not a finish or a colour')
    expect(v.safeParse(itemSchema, chair({ frame: 'gold' as never })).success).toBe(false)
  })

  it('table looks and piece looks take colours too', () => {
    const look = { name: 'Painted', shape: 'round', base: 'pedestal', chair: 'cafe-chair', finishes: { top: '#ffffff', base: '#123456', frame: 'walnut', seat: '#c0ffee' }, defaultWidth: 80, defaultDepth: 80 }
    expect(v.safeParse(createLookSchema, look).success).toBe(true)
    expect(v.safeParse(createLookSchema, { ...look, finishes: { ...look.finishes, top: '#fff' } }).success).toBe(false)
    expect(v.safeParse(createItemLookSchema, { name: 'Blue chair', kind: 'cafe-chair', finishes: { frame: '#1d4ed8' }, defaultWidth: 48, defaultDepth: 53 }).success).toBe(true)
  })

  it('a colour is drawn with its slot\'s material; a palette key keeps its own', () => {
    expect(finishSwatch('#a0522d', 'fabric')).toEqual({ label: '#A0522D', color: '#a0522d', material: 'fabric' })
    expect(finishSwatch('walnut', 'fabric').material).toBe('wood')
    expect(finishColor('navy')).toBe('#2e4057')
    expect(itemSlotMaterial('cafe-chair', 'frame')).toBe('wood')
    expect(itemSlotMaterial('cafe-chair', 'seat')).toBe('fabric')
    expect(itemSlotMaterial('coffee-station', 'machine')).toBe('metal')
    expect(itemSlotMaterial('block', 'body')).toBe('stone')
    const look = BUILT_IN_LOOKS[0]! as TableLook
    expect(lookSlotMaterial(look, 'top')).toBe('wood')
    expect(lookSlotMaterial(look, 'base')).toBe('metal')
    expect(lookSlotMaterial(look, 'seat')).toBe('fabric')
    expect(lookSlotMaterial({ chair: 'none' }, 'seat')).toBe('fabric')
  })

  it('shares one material per material and colour', () => {
    const materials = createMaterialLibrary()
    expect(materials.finish('#a0522d', 'wood')).toBe(materials.finish('#a0522d', 'wood'))
    expect(materials.finish('#a0522d', 'wood')).not.toBe(materials.finish('#a0522d', 'fabric'))
    expect(materials.finish('walnut', 'fabric')).toBe(materials.finish('walnut'))
    materials.dispose()
  })

  it('the building paints a piece and a table in their colours', () => {
    const context = createBuildContext(createMaterialLibrary())
    const piece = buildItem(context, chair({ frame: '#a0522d', seat: '#c0ffee' }))
    const used = new Set(meshesOf(piece).map(mesh => mesh.material))
    expect(used.has(context.materials.finish('#a0522d', 'wood'))).toBe(true)
    expect(used.has(context.materials.finish('#c0ffee', 'fabric'))).toBe(true)
    const look: TableLook = { ...BUILT_IN_LOOKS[0]!, finishes: { top: '#ffffff', base: '#123456' } }
    const table = buildTable(context, look, 80, 80, 2)
    const tableMaterials = new Set(meshesOf(table).map(mesh => mesh.material))
    expect(tableMaterials.has(context.materials.finish('#ffffff', 'wood'))).toBe(true)
    expect(tableMaterials.has(context.materials.finish('#123456', 'metal'))).toBe(true)
    disposeBuildContext(context)
  })
})

/** Walls and floor surfaces (D285): a wall's colour, a surface's floor and colour. */
describe('wall and floor finishes', () => {
  const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
  const wall: Wall = { id: 'w', from: { x: 0, y: 0 }, to: { x: 400, y: 0 } }
  const floor = (extra: Partial<Floor> = {}): Floor => ({ id: 'f', name: 'Ground', height: 300, hasRoof: true, items: [], slabs: [{ id: 's', outline: square }], walls: [wall], ...extra })
  const issues = (value: Floor) => (v.safeParse(floorSchema, value).issues ?? []).map(issue => issue.message)

  it('the contract takes a colour on a wall and a floor and colour on a surface', () => {
    expect(issues(floor({ walls: [{ ...wall, color: '#336699' }], slabs: [{ id: 's', outline: square, floor: 'concrete', color: '#aabbcc' }] }))).toEqual([])
    expect(issues(floor({ walls: [{ ...wall, color: 'navy' as never }] }))).toContain('A colour is written #rrggbb')
    expect(issues(floor({ slabs: [{ id: 's', outline: square, floor: 'marble' as never }] })).length).toBeGreaterThan(0)
  })

  it('sets and clears a wall\'s colour, and keeps it through a change of kind', () => {
    const painted = setWallStructure([wall], 'w', { color: '#336699' })
    expect(painted[0]).toEqual({ ...wall, color: '#336699' })
    expect(setWallKind(painted, 'w', 'half')[0]).toMatchObject({ kind: 'half', color: '#336699' })
    expect(setWallStructure(painted, 'w', { thickness: 30 })[0]).toMatchObject({ thickness: 30, color: '#336699' })
    expect(setWallStructure(painted, 'w', { color: null })[0]).toEqual(wall)
  })

  it('sets and clears a surface\'s floor and colour; Copy walls from floor below keeps them', () => {
    const slab = { id: 's', outline: square }
    const laid = setSlabFinish(slab, { floor: 'tiles', color: '#aabbcc' })
    expect(laid).toEqual({ ...slab, floor: 'tiles', color: '#aabbcc' })
    expect(setSlabFinish(laid, { color: null })).toEqual({ ...slab, floor: 'tiles' })
    expect(setSlabFinish(laid, { floor: null, color: null })).toEqual(slab)
    const copied = copyStructure({ slabs: [laid], walls: [{ ...wall, color: '#336699' }] })
    expect(copied.slabs[0]).toMatchObject({ floor: 'tiles', color: '#aabbcc' })
    expect(copied.walls[0]).toMatchObject({ color: '#336699' })
  })

  it('3D paints the wall\'s plaster, a railing\'s metal and the surface\'s floor', () => {
    const context = createBuildContext(createMaterialLibrary())
    const materialsOf = (built: ReturnType<typeof buildFloor>) => new Set(meshesOf(built.group).flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])))
    const plain = materialsOf(buildFloor(context, { floor: floor(), topmost: true }))
    expect(plain.has(context.materials.surface('plaster'))).toBe(true)
    expect(plain.has(context.materials.surface('floor-wood'))).toBe(true)
    const painted = materialsOf(buildFloor(context, { floor: floor({ walls: [{ ...wall, color: '#336699' }, { id: 'r', kind: 'railing', from: { x: 400, y: 0 }, to: { x: 400, y: 300 }, color: '#cc0000' }], slabs: [{ id: 's', outline: square, floor: 'concrete', color: '#aabbcc' }] }), topmost: true }))
    expect(painted.has(context.materials.tinted('plaster', '#336699'))).toBe(true)
    expect(painted.has(context.materials.tinted('frame', '#cc0000'))).toBe(true)
    expect(painted.has(context.materials.tinted('concrete', '#aabbcc'))).toBe(true)
    expect(painted.has(context.materials.surface('floor-wood'))).toBe(false)
    const tiled = materialsOf(buildFloor(context, { floor: floor({ hasRoof: false }), topmost: true }))
    expect(tiled.has(context.materials.surface('floor-tiles'))).toBe(true)
    disposeBuildContext(context)
  })

  it('a tint keeps its surface\'s pattern and is shared', () => {
    const materials = createMaterialLibrary()
    expect(materials.tinted('plaster')).toBe(materials.surface('plaster'))
    expect(materials.tinted('plaster', '#336699')).toBe(materials.tinted('plaster', '#336699'))
    expect(materials.tinted('plaster', '#336699')).not.toBe(materials.surface('plaster'))
    materials.dispose()
  })
})
