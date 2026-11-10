import { Box3, Vector3 } from 'three'
import type { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { ITEM_KINDS } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, findLook, ITEM_SPECS } from '../designer/catalog'
import { demoLayout, DEMO_TABLES } from './demo-layout'
import { buildItem, buildTable, createBuildContext } from '../designer/scene/furniture'
import { createMaterialLibrary } from '../designer/scene/materials'
import { buildScene } from '../designer/scene/scene'

const context = () => createBuildContext(createMaterialLibrary())
const sizeOf = (object: Object3D) => new Box3().setFromObject(object).getSize(new Vector3())
const centerOf = (object: Object3D) => new Box3().setFromObject(object).getCenter(new Vector3())
const chairsOf = (object: Object3D) => object.children.filter(child => ['cafe-chair', 'bentwood-chair', 'bar-stool'].includes(child.userData.kind))

describe('2D and 3D agree on size', () => {
  it.each(ITEM_KINDS.filter(kind => kind !== 'plant'))('a %s fills the footprint the plan draws (within a few cm)', (kind) => {
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
})
