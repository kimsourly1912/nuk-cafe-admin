import { BoxGeometry, ExtrudeGeometry, Group, Mesh, Path, PointLight, Shape, Vector2, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Floor, Point } from '#shared/contracts/shop-layout'
import { edgeLength, signedArea } from '#shared/contracts/shop-layout'
import { DOOR_HEIGHT_CM, floorInteriorPoint, outwardNormal, RAILING_HEIGHT_CM, rectCorners, WALL_THICKNESS_CM, wallPieces, WINDOW_SILL_CM, WINDOW_TOP_CM } from '../geometry'
import type { BuildContext } from './furniture'
import { cm, yRotation } from './units'

/**
 * A floor of the building from its outline (D273): the slab (with the stairwell from the floor below
 * cut out), walls split around doors and windows, railings, inside walls, the roof and a warm light.
 * Walls stand outside the outline, so the room keeps the size drawn on the plan.
 */

export const SLAB_THICKNESS_CM = 20

export interface WallNode {
  object: Object3D
  /** Out of the building, in the world (y = 0). */
  normal: Vector3
  /** The wall's middle on the plan, in metres (x, z). */
  center: Vector3
}

export interface FloorBuild {
  group: Group
  walls: WallNode[]
  roofs: Object3D[]
  lights: PointLight[]
}

export interface FloorBuildOptions {
  floor: Floor
  /** For the stairwell: stairs on the floor below come up through this floor's slab. */
  floorBelow?: Floor
  /** Nothing stands on this floor's roof: a parapet finishes it. */
  topmost: boolean
}

export function buildFloor(context: BuildContext, options: FloorBuildOptions): FloorBuild {
  const { floor, floorBelow, topmost } = options
  const group = new Group()
  group.userData.floorId = floor.id
  const walls: WallNode[] = []
  const roofs: Object3D[] = []
  const lights: PointLight[] = []
  const surfaces = context.materials

  const stairwells = (floorBelow?.items ?? [])
    .filter(item => item.kind === 'stairs')
    .map(item => rectCorners(item, item.width + 10, item.depth, item.rotation))
  const floorMaterial = surfaces.surface(floor.hasRoof ? 'floor-wood' : 'floor-tiles')
  const slab = new Mesh(slabGeometry(context, floor.outline, SLAB_THICKNESS_CM, stairwells), [floorMaterial, surfaces.surface('slab')])
  slab.position.y = -cm(SLAB_THICKNESS_CM)
  slab.receiveShadow = true
  slab.castShadow = true
  slab.userData.floorId = floor.id
  group.add(slab)

  const area = signedArea(floor.outline)
  floor.edges.forEach((edge, index) => {
    if (edge.kind === 'open') return
    const from = floor.outline[index]!
    const to = floor.outline[(index + 1) % floor.outline.length]!
    const length = edgeLength(floor.outline, index)
    if (length < 1) return
    const normal = outwardNormal(floor.outline, index)
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
    const edgeGroup = new Group()
    edgeGroup.rotation.y = yRotation(angle)
    if (edge.kind === 'wall') {
      const startConvex = isConvex(floor.outline, index, area)
      const endConvex = isConvex(floor.outline, (index + 1) % floor.outline.length, area)
      const offset = WALL_THICKNESS_CM / 2
      edgeGroup.position.set(cm((from.x + to.x) / 2 + normal.x * offset), 0, cm((from.y + to.y) / 2 + normal.y * offset))
      wallEdge(context, edgeGroup, { length, height: floor.height, openings: edge.openings, startExtra: startConvex ? WALL_THICKNESS_CM : 0, endExtra: endConvex ? WALL_THICKNESS_CM : 0 })
    }
    else {
      edgeGroup.position.set(cm((from.x + to.x) / 2 + normal.x * 3), 0, cm((from.y + to.y) / 2 + normal.y * 3))
      railingEdge(context, edgeGroup, length, edge.openings)
    }
    group.add(edgeGroup)
    walls.push({ object: edgeGroup, normal: new Vector3(normal.x, 0, normal.y), center: new Vector3(cm((from.x + to.x) / 2), 0, cm((from.y + to.y) / 2)) })
  })

  for (const wall of floor.walls) {
    const length = Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y)
    if (length < 1) continue
    const angle = (Math.atan2(wall.to.y - wall.from.y, wall.to.x - wall.from.x) * 180) / Math.PI
    const mesh = new Mesh(blockGeometry(context, length + 12, floor.height, 12), surfaces.surface('plaster'))
    mesh.position.set(cm((wall.from.x + wall.to.x) / 2), cm(floor.height / 2), cm((wall.from.y + wall.to.y) / 2))
    mesh.rotation.y = yRotation(angle)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  if (floor.hasRoof) {
    const roof = new Group()
    const roofSlab = new Mesh(slabGeometry(context, floor.outline, SLAB_THICKNESS_CM, []), [surfaces.surface('roof'), surfaces.surface('plaster-outside')])
    // A centimetre below the floor above's slab, so the two never fight where they overlap.
    roofSlab.position.y = cm(floor.height - SLAB_THICKNESS_CM - 1)
    roofSlab.castShadow = true
    roofSlab.receiveShadow = true
    roof.add(roofSlab)
    if (topmost) {
      floor.outline.forEach((from, index) => {
        const to = floor.outline[(index + 1) % floor.outline.length]!
        const normal = outwardNormal(floor.outline, index)
        const length = edgeLength(floor.outline, index)
        const parapet = new Mesh(blockGeometry(context, length + WALL_THICKNESS_CM * 2, 35, WALL_THICKNESS_CM), surfaces.surface('plaster-outside'))
        parapet.position.set(cm((from.x + to.x) / 2 + (normal.x * WALL_THICKNESS_CM) / 2), cm(floor.height + 17.5), cm((from.y + to.y) / 2 + (normal.y * WALL_THICKNESS_CM) / 2))
        parapet.rotation.y = yRotation((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI)
        parapet.castShadow = true
        roof.add(parapet)
      })
    }
    roofs.push(roof)
    group.add(roof)
  }

  const middle = floorInteriorPoint(floor.outline)
  if (middle) {
    if (floor.hasRoof) {
      const lamp = new Mesh(lampShadeGeometry(context), surfaces.surface('lamp'))
      lamp.position.set(cm(middle.x), cm(floor.height - 28), cm(middle.y))
      group.add(lamp)
    }
    const light = new PointLight('#ffc98a', floor.hasRoof ? 9 : 4, 0, 2)
    light.position.set(cm(middle.x), cm(floor.height - 40), cm(middle.y))
    lights.push(light)
    group.add(light)
  }

  return { group, walls, roofs, lights }
}

/** Corner `index` points out of the floor (an L's outer corners), so the walls meeting there need filling. */
function isConvex(outline: readonly Point[], index: number, area: number): boolean {
  const previous = outline[(index - 1 + outline.length) % outline.length]!
  const corner = outline[index]!
  const next = outline[(index + 1) % outline.length]!
  const cross = (corner.x - previous.x) * (next.y - corner.y) - (corner.y - previous.y) * (next.x - corner.x)
  return Math.sign(cross) === Math.sign(area)
}

function slabGeometry(context: BuildContext, outline: readonly Point[], thickness: number, holes: Point[][]): BufferGeometry {
  // Plan (x, y) → shape (x, −y); turned by −90° about x, the shape lies flat with y → z.
  const shape = new Shape(outline.map(point => toShape(point)))
  for (const hole of holes) shape.holes.push(new Path(hole.map(point => toShape(point))))
  const geometry = new ExtrudeGeometry(shape, { depth: cm(thickness), bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  context.geometries.set(`slab:${geometry.uuid}`, geometry)
  return geometry
}

function toShape(point: Point): Vector2 {
  return new Vector2(cm(point.x), -cm(point.y))
}

function blockGeometry(context: BuildContext, width: number, height: number, depth: number): BufferGeometry {
  const key = `block:${width}:${height}:${depth}`
  let geometry = context.geometries.get(key)
  if (!geometry) {
    geometry = new BoxGeometry(cm(width), cm(height), cm(depth))
    context.geometries.set(key, geometry)
  }
  return geometry
}

function lampShadeGeometry(context: BuildContext): BufferGeometry {
  const key = 'lamp-shade'
  let geometry = context.geometries.get(key)
  if (!geometry) {
    geometry = new BoxGeometry(cm(40), cm(6), cm(40))
    context.geometries.set(key, geometry)
  }
  return geometry
}

interface WallEdgeOptions {
  length: number
  height: number
  openings: Floor['edges'][number]['openings']
  startExtra: number
  endExtra: number
}

/** One edge's wall as merged solid pieces, plus window glass and frames and door leaves. */
function wallEdge(context: BuildContext, group: Group, options: WallEdgeOptions) {
  const { length, height, openings, startExtra, endExtra } = options
  const pieces = wallPieces(length, height, openings).map(piece => ({
    ...piece,
    from: piece.from === 0 ? -startExtra : piece.from,
    to: piece.to === length ? length + endExtra : piece.to,
  }))
  const boxes = pieces.map((piece) => {
    const geometry = new BoxGeometry(cm(piece.to - piece.from), cm(piece.top - piece.bottom), cm(WALL_THICKNESS_CM))
    geometry.translate(cm((piece.from + piece.to) / 2 - length / 2), cm((piece.top + piece.bottom) / 2), 0)
    return geometry
  })
  if (boxes.length) {
    const merged = mergeGeometries(boxes)
    for (const piece of boxes) piece.dispose()
    // Owned by this wall: its size is its own, so it isn't cached.
    context.geometries.set(`wall:${group.uuid}`, merged)
    const mesh = new Mesh(merged, context.materials.surface('plaster'))
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  const frame = context.materials.surface('frame')
  for (const opening of openings) {
    const x = opening.offset + opening.width / 2 - length / 2
    if (opening.kind === 'window') {
      const bottom = Math.min(WINDOW_SILL_CM, height)
      const top = Math.min(WINDOW_TOP_CM, height)
      addBox(context, group, opening.width - 4, top - bottom - 4, 2, context.materials.surface('glass'), { x, y: (top + bottom) / 2, z: 0 }, false)
      addBox(context, group, opening.width, 4, WALL_THICKNESS_CM + 2, frame, { x, y: bottom + 2, z: 0 })
      addBox(context, group, opening.width, 4, 8, frame, { x, y: top - 2, z: 0 })
      addBox(context, group, 4, top - bottom, 8, frame, { x: x - opening.width / 2 + 2, y: (top + bottom) / 2, z: 0 })
      addBox(context, group, 4, top - bottom, 8, frame, { x: x + opening.width / 2 - 2, y: (top + bottom) / 2, z: 0 })
      const panes = Math.max(1, Math.round(opening.width / 90))
      for (let mullion = 1; mullion < panes; mullion++) {
        addBox(context, group, 3, top - bottom, 6, frame, { x: x - opening.width / 2 + (mullion * opening.width) / panes, y: (top + bottom) / 2, z: 0 })
      }
    }
    else {
      const doorHeight = Math.min(DOOR_HEIGHT_CM, height)
      addBox(context, group, opening.width - 6, doorHeight - 3, 4, context.materials.finish('walnut'), { x, y: (doorHeight - 3) / 2, z: -WALL_THICKNESS_CM / 2 + 4 })
      addBox(context, group, opening.width, 5, WALL_THICKNESS_CM + 1, frame, { x, y: doorHeight - 2.5, z: 0 })
      addBox(context, group, 2, 18, 4, context.materials.finish('brass'), { x: x + opening.width / 2 - 14, y: 105, z: -WALL_THICKNESS_CM / 2 + 1 })
    }
  }
}

/** Posts, a top rail and thin balusters, merged per edge. */
function railingEdge(context: BuildContext, group: Group, length: number, openings: Floor['edges'][number]['openings']) {
  const metal = context.materials.surface('frame')
  const parts: BufferGeometry[] = []
  const add = (width: number, height: number, depth: number, x: number, y: number) => {
    const geometry = new BoxGeometry(cm(width), cm(height), cm(depth))
    geometry.translate(cm(x), cm(y), 0)
    parts.push(geometry)
  }
  function segment(from: number, to: number) {
    const width = to - from
    if (width <= 0) return
    const start = from - length / 2
    const middle = start + width / 2
    const postWidth = Math.min(5, width)
    add(width + (openings.length ? 0 : 4), 5, 6, middle, RAILING_HEIGHT_CM - 2.5)
    add(width, 3, 3, middle, 12)
    const posts = Math.max(1, Math.ceil(width / 150))
    for (let post = 0; post <= posts; post++) {
      const x = start + postWidth / 2 + post * (width - postWidth) / posts
      add(postWidth, RAILING_HEIGHT_CM, 5, x, RAILING_HEIGHT_CM / 2)
    }
    const balusters = Math.floor(width / 12)
    for (let baluster = 1; baluster < balusters; baluster++) {
      add(1.4, RAILING_HEIGHT_CM - 18, 1.4, start + baluster * width / balusters, (RAILING_HEIGHT_CM - 18) / 2 + 13.5)
    }
  }
  let cursor = 0
  for (const opening of [...openings].sort((a, b) => a.offset - b.offset)) {
    segment(cursor, opening.offset)
    cursor = opening.offset + opening.width
  }
  segment(cursor, length)
  if (!parts.length) return
  const merged = mergeGeometries(parts)
  for (const piece of parts) piece.dispose()
  context.geometries.set(`railing:${group.uuid}`, merged)
  const mesh = new Mesh(merged, metal)
  mesh.castShadow = true
  group.add(mesh)
}

function addBox(context: BuildContext, group: Group, width: number, height: number, depth: number, material: Material, at: { x: number, y: number, z: number }, shadow = true) {
  const mesh = new Mesh(blockGeometry(context, Math.round(width * 10) / 10, Math.round(height * 10) / 10, depth), material)
  mesh.position.set(cm(at.x), cm(at.y), cm(at.z))
  mesh.castShadow = shadow
  mesh.receiveShadow = shadow
  group.add(mesh)
}
