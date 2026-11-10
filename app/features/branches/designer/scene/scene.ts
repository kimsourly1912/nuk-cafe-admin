import { Box3, CircleGeometry, Group, Mesh, Vector3 } from 'three'
import type { LayoutTable, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { findLook } from '../catalog'
import { boundsOf } from '../geometry'
import type { FloorBuild } from './building'
import { buildFloor, SLAB_THICKNESS_CM } from './building'
import type { BuildContext } from './furniture'
import { buildItem, buildTable } from './furniture'
import { cm, yRotation } from './units'

/**
 * The whole building from one saved layout (D273): a pure function of the layout, the branch's
 * tables and the looks. The 3D view rebuilds it whenever the layout changes; nothing in it is
 * edited in place.
 */

export interface SceneInput {
  layout: ShopLayout
  tables: readonly LayoutTable[]
  looks: readonly TableLook[]
}

export interface FloorNode extends FloorBuild {
  id: string
  name: string
  index: number
  /** Where its floor surface sits when the building is whole, in metres. */
  elevation: number
  height: number
  /** On the floor group: beside the building, for its name. */
  labelAnchor: Vector3
  /** The middle of its plan, on the floor group. */
  center: Vector3
}

export interface TableNode {
  tableId: string
  label: string
  seats: number
  floorId: string
  object: Group
  /** On the table's floor group, above the table: where its chip floats. */
  labelAnchor: Vector3
}

export interface BuiltScene {
  root: Group
  floors: FloorNode[]
  tables: Map<string, TableNode>
  /** The building without the ground, as built. */
  bounds: Box3
}

export function buildScene(context: BuildContext, input: SceneInput): BuiltScene {
  const { layout, tables, looks } = input
  const root = new Group()
  const floors: FloorNode[] = []
  const tableNodes = new Map<string, TableNode>()
  let elevation = 0
  layout.floors.forEach((floor, index) => {
    const built = buildFloor(context, { floor, floorBelow: layout.floors[index - 1], topmost: index === layout.floors.length - 1 })
    built.group.position.y = cm(elevation)
    built.group.userData.baseY = cm(elevation)
    for (const item of floor.items) {
      const object = buildItem(context, { kind: item.kind, width: item.width, depth: item.depth, finishes: item.finishes, floorHeight: floor.height })
      object.position.set(cm(item.x), 0, cm(item.y))
      object.rotation.y = yRotation(item.rotation)
      object.userData.itemId = item.id
      built.group.add(object)
    }
    const plan = boundsOf(floor.outline)
    floors.push({
      ...built,
      id: floor.id,
      name: floor.name,
      index,
      elevation: cm(elevation),
      height: cm(floor.height),
      labelAnchor: new Vector3(cm(plan.maxX + 90), cm(floor.height / 2), cm((plan.minY + plan.maxY) / 2)),
      center: new Vector3(cm((plan.minX + plan.maxX) / 2), 0, cm((plan.minY + plan.maxY) / 2)),
    })
    root.add(built.group)
    elevation += floor.height
  })

  for (const placement of layout.placements) {
    const table = tables.find(candidate => candidate.id === placement.tableId)
    const floor = floors.find(candidate => candidate.id === placement.floorId)
    if (!table || !floor) continue
    const object = buildTable(context, findLook(looks, placement.lookId), placement.width, placement.depth, table.seats)
    object.position.set(cm(placement.x), 0, cm(placement.y))
    object.rotation.y = yRotation(placement.rotation)
    object.userData.tableId = table.id
    floor.group.add(object)
    tableNodes.set(table.id, {
      tableId: table.id,
      label: table.label,
      seats: table.seats,
      floorId: floor.id,
      object,
      labelAnchor: new Vector3(cm(placement.x), 1.2, cm(placement.y)),
    })
  }

  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root)
  return { root, floors, tables: tableNodes, bounds }
}

/** A large disc under the building that takes its shadow. */
export function buildGround(context: BuildContext, bounds: Box3): Mesh {
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  const radius = Math.max(size.x, size.z) * 1.4 + 6
  const geometry = new CircleGeometry(radius, 64)
  geometry.rotateX(-Math.PI / 2)
  context.geometries.set(`ground:${radius}`, geometry)
  const ground = new Mesh(geometry, context.materials.surface('ground'))
  ground.position.set(center.x, -cm(SLAB_THICKNESS_CM) - 0.005, center.z)
  ground.receiveShadow = true
  return ground
}
