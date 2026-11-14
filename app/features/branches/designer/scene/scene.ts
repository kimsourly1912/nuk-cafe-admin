import { Box3, CircleGeometry, Group, Mesh, PlaneGeometry, Vector3 } from 'three'
import type { Object3D } from 'three'
import { isFigureKind } from '#shared/contracts/shop-layout'
import type { FigureKind, ItemLook, LayoutTable, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { findItemLook, findLook, ITEM_SPECS, pieceFinishes, pieceHeight } from '../catalog'
import { boundsOf, floorPoints } from '../geometry'
import type { FloorBuild } from './building'
import { buildFloor, SLAB_THICKNESS_CM } from './building'
import { buildFigure } from './figures'
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
  /** The cafe's chair and fixture looks (step 3d): a piece with one takes its finishes. */
  itemLooks?: readonly ItemLook[]
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

/** A piece of furniture, a fixture, stairs or a figure, as the 3D view picks it (step 3e). */
export interface ItemNode {
  itemId: string
  /** Its look's name, or its kind's ("Bar stool"). */
  label: string
  floorId: string
  object: Group
  /** On the piece's floor group, above the piece: where its chip floats. */
  labelAnchor: Vector3
}

/**
 * A person or pet (step 3g, D274), standing where the plan puts it: the generated figure (`body`)
 * and its idle motion. When the kind has a model file, the viewer loads it into the anchor and hides
 * the generated one.
 */
export interface FigureNode {
  itemId: string
  kind: FigureKind
  floorId: string
  anchor: Group
  body: Object3D
  idle: (seconds: number) => void
}

export interface BuiltScene {
  root: Group
  floors: FloorNode[]
  tables: Map<string, TableNode>
  /** Every piece by its id (step 3e): not the tables, which are `tables`. */
  items: Map<string, ItemNode>
  figures: FigureNode[]
  /** The building without the ground, as built. */
  bounds: Box3
}

export function buildScene(context: BuildContext, input: SceneInput): BuiltScene {
  const { layout, tables, looks, itemLooks = [] } = input
  const root = new Group()
  const floors: FloorNode[] = []
  const tableNodes = new Map<string, TableNode>()
  const itemNodes = new Map<string, ItemNode>()
  const figures: FigureNode[] = []
  const topmost = layout.floors.findLastIndex(floor => floor.slabs.length > 0)
  let elevation = 0
  layout.floors.forEach((floor, index) => {
    const baseY = cm(elevation)
    elevation += floor.height
    // An empty floor (D282) has nothing to build; walls alone still stand.
    if (!floor.slabs.length && !floor.walls.length) return
    const built = buildFloor(context, { floor, floorBelow: layout.floors[index - 1], topmost: index === topmost })
    built.group.position.y = baseY
    built.group.userData.baseY = baseY
    for (const item of floor.items) {
      let object: Group
      if (isFigureKind(item.kind)) {
        const figure = buildFigure(context, item.kind, item.id)
        object = figureAnchor(context, item.kind, item.width, item.depth)
        object.add(figure.body)
        figures.push({ itemId: item.id, kind: item.kind, floorId: floor.id, anchor: object, body: figure.body, idle: figure.idle })
      }
      else {
        const shape = { radius: item.radius, arcStart: item.arcStart, arcSweep: item.arcSweep, arcInner: item.arcInner }
        object = buildItem(context, { kind: item.kind, width: item.width, depth: item.depth, height: item.height, finishes: pieceFinishes(item, itemLooks), floorHeight: floor.height, shape })
      }
      object.position.set(cm(item.x), 0, cm(item.y))
      object.rotation.y = yRotation(item.rotation)
      // Flipped (ED-07) in its own frame, before the turn, as on the plan.
      object.scale.set(item.flipX ? -1 : 1, 1, item.flipY ? -1 : 1)
      object.userData.itemId = item.id
      built.group.add(object)
      const look = findItemLook(itemLooks, item.lookId)
      const label = item.name ?? (look && look.kind === item.kind ? look.name : ITEM_SPECS[item.kind].label)
      const top = item.kind === 'stairs' ? floor.height : pieceHeight(item)
      itemNodes.set(item.id, { itemId: item.id, label, floorId: floor.id, object, labelAnchor: new Vector3(cm(item.x), cm(top + 30), cm(item.y)) })
    }
    const plan = boundsOf(floorPoints(floor))
    floors.push({
      ...built,
      id: floor.id,
      name: floor.name,
      index,
      elevation: baseY,
      height: cm(floor.height),
      labelAnchor: new Vector3(cm(plan.maxX + 90), cm(floor.height / 2), cm((plan.minY + plan.maxY) / 2)),
      center: new Vector3(cm((plan.minX + plan.maxX) / 2), 0, cm((plan.minY + plan.maxY) / 2)),
    })
    root.add(built.group)
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
  return { root, floors, tables: tableNodes, items: itemNodes, figures, bounds }
}

/**
 * Where a figure stands, with a soft contact shadow the size of its footprint. Figures cast no
 * shadow of their own: an animated one would redraw the sun's shadow every frame.
 */
function figureAnchor(context: BuildContext, kind: FigureKind, width: number, depth: number): Group {
  const anchor = new Group()
  anchor.userData.figure = kind
  const geometry = context.geometries.get(`contact:${width}:${depth}`) ?? new PlaneGeometry(cm(width) * 1.3, cm(depth) * 1.3).rotateX(-Math.PI / 2)
  context.geometries.set(`contact:${width}:${depth}`, geometry)
  const shadow = new Mesh(geometry, context.materials.surface('contact-shadow'))
  shadow.position.y = 0.004
  shadow.renderOrder = 1
  shadow.userData.part = 'contact-shadow'
  anchor.add(shadow)
  return anchor
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
