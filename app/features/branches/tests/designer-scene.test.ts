import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Box3, ExtrudeGeometry, Raycaster, Vector3 } from 'three'
import type { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { FIGURE_KINDS, FIGURE_SIZES, isFigureKind, ITEM_KINDS } from '#shared/contracts/shop-layout'
import type { FigureKind, ItemLook, LayoutItem } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, BUILT_IN_PHOTO, findLook, ITEM_SPECS, pieceFinishes } from '../designer/catalog'
import { demoLayout, DEMO_TABLES } from './demo-layout'
import { buildItem, buildTable, createBuildContext, disposeBuildContext, meshesOf } from '../designer/scene/furniture'
import { createMaterialLibrary } from '../designer/scene/materials'
import { buildFigure } from '../designer/scene/figures'
import { buildScene } from '../designer/scene/scene'

const context = () => createBuildContext(createMaterialLibrary())
const sizeOf = (object: Object3D) => new Box3().setFromObject(object).getSize(new Vector3())
const centerOf = (object: Object3D) => new Box3().setFromObject(object).getCenter(new Vector3())
const chairsOf = (object: Object3D) => object.children.filter(child => ['cafe-chair', 'bentwood-chair', 'bar-stool'].includes(child.userData.kind))

describe('2D and 3D agree on size', () => {
  it.each(ITEM_KINDS.filter(kind => kind !== 'plant' && !isFigureKind(kind)))('a %s fills the footprint the plan draws (within a few cm)', (kind) => {
    const spec = ITEM_SPECS[kind]
    const object = buildItem(context(), { kind, width: spec.width, depth: spec.depth, finishes: {}, floorHeight: 300 })
    object.updateMatrixWorld(true)
    const size = sizeOf(object)
    expect(Math.abs(size.x * 100 - spec.width)).toBeLessThanOrEqual(6)
    expect(Math.abs(size.z * 100 - spec.depth)).toBeLessThanOrEqual(8)
    const center = centerOf(object)
    expect(Math.abs(center.x)).toBeLessThan(0.04)
    expect(new Box3().setFromObject(object).min.y).toBeGreaterThanOrEqual(-0.001)
  })

  it('keeps a resized table’s legs at their thickness and moves them to the new corners', () => {
    const look = findLook(BUILT_IN_LOOKS, 'oak-rectangle')
    const small = buildTable(context(), { ...look, chair: 'none' }, 120, 80, 0)
    const large = buildTable(context(), { ...look, chair: 'none' }, 200, 80, 0)
    expect(sizeOf(small).x).toBeCloseTo(1.2, 2)
    expect(sizeOf(large).x).toBeCloseTo(2.0, 2)
    const legs = (table: Object3D) => table.children.filter(child => child.userData.part !== 'top' && child.position.y < 0.5)
    const radius = (table: Object3D) => new Box3().setFromObject(legs(table)[0]!).getSize(new Vector3()).x
    expect(radius(large)).toBeCloseTo(radius(small), 5)
  })
})

describe('chairs come from seats', () => {
  it('builds one chair per seat and none for a booth', () => {
    expect(chairsOf(buildTable(context(), findLook(BUILT_IN_LOOKS, 'oak-rectangle'), 120, 80, 4))).toHaveLength(4)
    expect(chairsOf(buildTable(context(), findLook(BUILT_IN_LOOKS, 'round-cafe'), 80, 80, 2))).toHaveLength(2)
    expect(chairsOf(buildTable(context(), findLook(BUILT_IN_LOOKS, 'green-booth'), 140, 75, 4))).toHaveLength(0)
  })
})

describe('the building from the layout', () => {
  it('puts each placed table on its floor, at the plan’s position', () => {
    const layout = demoLayout()
    const scene = buildScene(context(), { layout, tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
    expect(scene.tables.size).toBe(layout.placements.length)
    for (const placement of layout.placements) {
      const node = scene.tables.get(placement.tableId)!
      expect(node.object.parent?.userData.floorId).toBe(placement.floorId)
      expect(node.object.position.x).toBeCloseTo(placement.x / 100, 5)
      expect(node.object.position.z).toBeCloseTo(placement.y / 100, 5)
    }
    // Floors stack by their heights: ground 320 cm, first 300 cm.
    expect(scene.floors.map(floor => floor.elevation)).toEqual([0, 3.2, 6.2])
  })

  it('turns a table clockwise on the plan the same way in 3D', () => {
    const layout = demoLayout()
    layout.floors = [layout.floors[0]!]
    layout.placements = [{ tableId: 'demo-t03', floorId: 'ground', x: 500, y: 300, rotation: 90, width: 120, depth: 80, lookId: 'oak-rectangle' }]
    const tables = DEMO_TABLES.map(table => (table.id === 'demo-t03' ? { ...table, seats: 1 } : table))
    const scene = buildScene(context(), { layout, tables, looks: BUILT_IN_LOOKS })
    const table = scene.tables.get('demo-t03')!.object
    scene.root.updateMatrixWorld(true)
    // One seat sits above the table on the plan (−y); turned 90° clockwise it moves to the right (+x).
    const chair = chairsOf(table)[0]!.getWorldPosition(new Vector3())
    expect(chair.x).toBeGreaterThan(5.4)
    expect(chair.z).toBeCloseTo(3, 1)
  })

  it('builds a wall or railing for every edge that has one', () => {
    const scene = buildScene(context(), { layout: demoLayout(), tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
    expect(scene.floors.map(floor => floor.walls.length)).toEqual([6, 6, 8])
    expect(scene.floors.map(floor => floor.roofs.length)).toEqual([1, 1, 0])
  })

  it('leaves the saved gate clear through the whole railing', () => {
    const layout = demoLayout()
    const floor = layout.floors[0]!
    floor.edges[0] = { kind: 'railing', openings: [{ id: 'gate', kind: 'door', offset: 150, width: 120 }] }
    const scene = buildScene(context(), { layout, tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
    const railing = scene.floors[0]!.walls[0]!.object
    const through = (x: number) => new Raycaster(new Vector3(x, 1.02, -2), new Vector3(0, 0, 1)).intersectObject(railing, true)
    expect(through(2.1)).toHaveLength(0)
    expect(through(0.75).length).toBeGreaterThan(0)
    expect(through(3.5).length).toBeGreaterThan(0)
  })

  it('releases floor and roof slabs when the scene geometry is cleared', () => {
    const build = context()
    const scene = buildScene(build, { layout: demoLayout(), tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
    const slabs = meshesOf(scene.root).map(mesh => mesh.geometry).filter(geometry => geometry instanceof ExtrudeGeometry)
    let disposed = 0
    for (const slab of slabs) slab.addEventListener('dispose', () => disposed++)
    expect(slabs).toHaveLength(5)
    disposeBuildContext(build)
    expect(disposed).toBe(slabs.length)
    expect(build.geometries.size).toBe(0)
  })
})

describe('chair and fixture looks (step 3d)', () => {
  const look: ItemLook = { id: 'rattan', name: 'Rattan', kind: 'cafe-chair', finishes: { frame: 'pale-oak', seat: 'navy' }, defaultWidth: 46, defaultDepth: 52 }
  const piece = (extra: Partial<LayoutItem>): LayoutItem => ({ id: 'chair', kind: 'cafe-chair', x: 0, y: 0, rotation: 0, width: 46, depth: 52, finishes: { frame: 'walnut', seat: 'olive' }, ...extra })

  it('a piece with one of the cafe\'s looks takes its finishes; without one, or its look gone or of another kind, its own', () => {
    expect(pieceFinishes(piece({ lookId: 'rattan' }), [look])).toEqual({ frame: 'pale-oak', seat: 'navy' })
    expect(pieceFinishes(piece({}), [look])).toEqual({ frame: 'walnut', seat: 'olive' })
    expect(pieceFinishes(piece({ lookId: 'gone' }), [look])).toEqual({ frame: 'walnut', seat: 'olive' })
    expect(pieceFinishes(piece({ kind: 'bar-stool', lookId: 'rattan' }), [look])).toEqual({ frame: 'walnut', seat: 'olive' })
  })

  it('the building draws a piece in its look\'s finishes', () => {
    const build = context()
    const layout = demoLayout()
    layout.floors[0]!.items = [piece({ lookId: 'rattan' })]
    const scene = buildScene(build, { layout, tables: DEMO_TABLES, looks: BUILT_IN_LOOKS, itemLooks: [look] })
    const chair = scene.floors[0]!.group.children.find(child => child.userData.itemId === 'chair')!
    const materials = new Set(meshesOf(chair).map(mesh => mesh.material))
    expect(materials.has(build.materials.finish('pale-oak'))).toBe(true)
    expect(materials.has(build.materials.finish('walnut'))).toBe(false)
  })
})

describe('built-in pictures (step 3d)', () => {
  it('every built-in look, piece (but stairs), person and pet ships its picture, and nothing else is in the folder', () => {
    const folder = fileURLToPath(new URL('../../../../public/shop-designer/looks/', import.meta.url))
    const expected = [...BUILT_IN_LOOKS.map(builtIn => builtIn.photo!.url), ...ITEM_KINDS.flatMap(kind => ITEM_SPECS[kind].photo ?? [])]
    expect(expected).toHaveLength(BUILT_IN_LOOKS.length + ITEM_KINDS.length - 1)
    expect(readdirSync(folder).map(file => BUILT_IN_PHOTO(file.replace(/\.webp$/, ''))).sort()).toEqual([...expected].sort())
    for (const url of expected) expect(statSync(`${folder}${url.split('/').at(-1)}`).size).toBeLessThan(60_000)
  })
})

describe('people and pets (step 3g)', () => {
  const placedFigure = (kind: FigureKind, id = `${kind}-1`) => {
    const layout = demoLayout()
    layout.floors[1]!.items.push({ id, kind, x: 250, y: 180, rotation: 90, ...FIGURE_SIZES[kind], finishes: {} })
    return buildScene(context(), { layout, tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
  }
  const materialsOf = (object: Object3D) => meshesOf(object).map(mesh => mesh.material)

  it('stands each figure at its place and turn, over a contact shadow, casting no shadow', () => {
    const scene = placedFigure('cat')
    const floor = scene.floors[1]!
    expect(scene.figures.map(figure => [figure.itemId, figure.kind, figure.floorId])).toEqual([['cat-1', 'cat', floor.id]])
    const { anchor, body } = scene.figures[0]!
    expect(anchor.parent).toBe(floor.group)
    expect(body.parent).toBe(anchor)
    expect([anchor.position.x, anchor.position.z]).toEqual([2.5, 1.8])
    expect(anchor.rotation.y).toBeCloseTo(-Math.PI / 2, 5)
    const meshes = meshesOf(anchor)
    expect(meshes[0]!.userData.part).toBe('contact-shadow')
    expect(meshes.length).toBeGreaterThan(5)
    expect(meshes.every(mesh => !mesh.castShadow)).toBe(true)
  })

  it.each(FIGURE_KINDS)('a %s fits its footprint, stands on the floor and has its height', (kind) => {
    const spec = ITEM_SPECS[kind]
    const { body } = buildFigure(context(), kind, 'figure-1')
    body.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(body)
    const size = bounds.getSize(new Vector3())
    expect(size.x * 100, 'width').toBeLessThanOrEqual(spec.width + 2)
    expect(size.z * 100, 'depth').toBeLessThanOrEqual(spec.depth + 2)
    // Not lost in its footprint either: it fills most of one side.
    expect(Math.max(size.x * 100 / spec.width, size.z * 100 / spec.depth)).toBeGreaterThan(0.7)
    expect(size.y * 100, 'height').toBeGreaterThan(spec.height - 8)
    expect(size.y * 100, 'height').toBeLessThan(spec.height + 8)
    expect(bounds.min.y).toBeCloseTo(0, 3)
    const center = bounds.getCenter(new Vector3())
    expect(Math.abs(center.x)).toBeLessThan(0.01)
    expect(Math.abs(center.z)).toBeLessThan(0.01)
  })

  it('dresses a figure by its id: the same for every viewer, varied between figures', () => {
    const build = context()
    const same = [buildFigure(build, 'person', 'guest-7'), buildFigure(build, 'person', 'guest-7')]
    expect(materialsOf(same[0]!.body)).toEqual(materialsOf(same[1]!.body))
    const looks = new Set(Array.from({ length: 12 }, (_, index) => materialsOf(buildFigure(build, 'person', `guest-${index}`).body).map(material => (material as { uuid: string }).uuid).join()))
    expect(looks.size).toBeGreaterThan(3)
  })

  it('moves a little when its idle plays, and the same time gives the same pose', () => {
    const { body, idle } = buildFigure(context(), 'dog', 'dog-1')
    const pose = () => {
      const poses: number[] = []
      body.traverse(object => poses.push(object.rotation.y, object.rotation.z, object.scale.x, object.scale.y))
      return poses
    }
    idle(0)
    const start = pose()
    idle(0.4)
    expect(pose()).not.toEqual(start)
    idle(0)
    expect(pose()).toEqual(start)
  })
})
