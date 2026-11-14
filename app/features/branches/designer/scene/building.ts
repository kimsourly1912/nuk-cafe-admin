import { BoxGeometry, ExtrudeGeometry, Group, Mesh, Path, PointLight, Shape, Vector2, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Floor, FloorSurface, Opening, Point } from '#shared/contracts/shop-layout'
import { edgeLength, wallLength } from '#shared/contracts/shop-layout'
import { floorInteriorPoint, mainSlab, outwardNormal, pointInPolygon, RAILING_HEIGHT_CM, rectCorners, SLAB_THICKNESS_CM, WALL_THICKNESS_CM, wallFacesOut, wallHeight, wallNormal, wallOutward, wallPieces, wallThickness, openingSpan } from '../geometry'
import { drawWalls } from '../walls'
import type { BuildContext } from './furniture'
import type { SurfaceKey } from './materials'
import { cm, yRotation } from './units'

/**
 * A floor of the building (D273, D282): each floor surface's slab (with the stairwell from the
 * floor below cut out), every wall split around its doors and windows (beside its line or on it,
 * as thick and tall as its own or its kind's), railings, the roof over the surfaces and a warm light.
 * Outer walls stand outside their surface, so the room keeps the size drawn on the plan.
 */

export { SLAB_THICKNESS_CM }

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

/** The 3D surface a floor surface is laid with (D285). */
const FLOOR_SURFACE_MATERIAL: Record<FloorSurface, SurfaceKey> = { planks: 'floor-wood', tiles: 'floor-tiles', concrete: 'concrete' }

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

  const stairs = (floorBelow?.items ?? []).filter(item => item.kind === 'stairs')
  for (const surface of floor.slabs) {
    const floorMaterial = surfaces.tinted(FLOOR_SURFACE_MATERIAL[surface.floor ?? (floor.hasRoof ? 'planks' : 'tiles')], surface.color)
    const stairwells = stairs.filter(item => pointInPolygon(item, surface.outline)).map(item => rectCorners(item, item.width + 10, item.depth, item.rotation))
    const slab = new Mesh(slabGeometry(context, surface.outline, SLAB_THICKNESS_CM, stairwells), [floorMaterial, surfaces.surface('slab')])
    slab.position.y = -cm(SLAB_THICKNESS_CM)
    slab.receiveShadow = true
    slab.castShadow = true
    slab.userData.floorId = floor.id
    group.add(slab)
  }

  // Every wall (D278, D282): a wall, half wall or glass with its doors and windows, or a railing.
  for (const drawing of drawWalls(floor.walls)) {
    const { wall, kind, near, far, reach } = drawing
    const length = wallLength(wall)
    if (length < 1) continue
    const normal = wallNormal(wall)
    const middle = (near + far) / 2
    const angle = (Math.atan2(wall.to.y - wall.from.y, wall.to.x - wall.from.x) * 180) / Math.PI
    const wallGroup = new Group()
    wallGroup.rotation.y = yRotation(angle)
    // On the band's middle; `wallEdge` runs past either end as far as a mitred corner reaches.
    const center = { x: (wall.from.x + wall.to.x) / 2 + normal.x * middle, y: (wall.from.y + wall.to.y) / 2 + normal.y * middle }
    wallGroup.position.set(cm(center.x), 0, cm(center.y))
    const openings = wall.openings ?? []
    const height = wallHeight(wall, floor.height)
    // A wall's colour (D285) is its plaster's; a railing's or glass's, its frame's.
    if (kind === 'railing') railingEdge(context, wallGroup, length, openings, height, wall.color)
    else {
      const thickness = wallThickness(wall)
      // The group's z axis on the plan, against the wall's outside: where shutters hang (D285).
      const localZ = new Vector3(0, 0, 1).applyEuler(wallGroup.rotation)
      const out = wallOutward(wall, floor.slabs)
      const outside = localZ.x * out.x + localZ.z * out.y >= 0 ? 1 : -1
      wallEdge(context, wallGroup, { length, height, openings, startExtra: reach.start, endExtra: reach.end, thickness, surface: kind === 'glass' ? 'glass' : 'plaster', color: kind === 'glass' ? undefined : wall.color, leaves: kind === 'wall', outside })
      if (kind === 'glass') {
        // A frame along the top and at each end holds the glass.
        const frame = surfaces.tinted('frame', wall.color)
        addBox(context, wallGroup, length, 4, 6, frame, { x: 0, y: height - 2, z: 0 })
        for (const end of [-length / 2 + 2, length / 2 - 2]) addBox(context, wallGroup, 4, height, 6, frame, { x: end, y: height / 2, z: 0 })
      }
    }
    group.add(wallGroup)
    // An outer wall steps aside in the cutaway when it faces the camera.
    if (wallFacesOut(floor, wall)) {
      const out = wallOutward(wall, floor.slabs)
      walls.push({ object: wallGroup, normal: new Vector3(out.x, 0, out.y), center: new Vector3(cm((wall.from.x + wall.to.x) / 2), 0, cm((wall.from.y + wall.to.y) / 2)) })
    }
  }

  if (floor.hasRoof && floor.slabs.length) {
    const roof = new Group()
    for (const surface of floor.slabs) {
      const roofSlab = new Mesh(slabGeometry(context, surface.outline, SLAB_THICKNESS_CM, []), [surfaces.surface('roof'), surfaces.surface('plaster-outside')])
      // A centimetre below the floor above's slab, so the two never fight where they overlap.
      roofSlab.position.y = cm(floor.height - SLAB_THICKNESS_CM - 1)
      roofSlab.castShadow = true
      roofSlab.receiveShadow = true
      roof.add(roofSlab)
      if (!topmost) continue
      surface.outline.forEach((from, index) => {
        const to = surface.outline[(index + 1) % surface.outline.length]!
        const out = outwardNormal(surface.outline, index)
        const length = edgeLength(surface.outline, index)
        const parapet = new Mesh(blockGeometry(context, length + WALL_THICKNESS_CM * 2, 35, WALL_THICKNESS_CM), surfaces.surface('plaster-outside'))
        parapet.position.set(cm((from.x + to.x) / 2 + (out.x * WALL_THICKNESS_CM) / 2), cm(floor.height + 17.5), cm((from.y + to.y) / 2 + (out.y * WALL_THICKNESS_CM) / 2))
        parapet.rotation.y = yRotation((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI)
        parapet.castShadow = true
        roof.add(parapet)
      })
    }
    roofs.push(roof)
    group.add(roof)
  }

  const main = mainSlab(floor)
  const middle = main && floorInteriorPoint(main.outline)
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
  openings: readonly Opening[]
  startExtra: number
  endExtra: number
  /** The wall's own or its kind's (`wallThickness`). */
  thickness?: number
  surface?: 'plaster' | 'glass'
  /** The plaster's colour (D285); left out: the plaster's own. */
  color?: string
  /** Door leaves in its doorways (a half wall's or glass's doorway is an open gap). */
  leaves?: boolean
  /** Which way along the group's z is the wall's outside (1 or −1): where shutters hang (D285). */
  outside?: number
}

/** One edge's wall as merged solid pieces, plus window glass and frames and door leaves. */
function wallEdge(context: BuildContext, group: Group, options: WallEdgeOptions) {
  const { length, height, openings, startExtra, endExtra, thickness = WALL_THICKNESS_CM, surface = 'plaster', color, leaves = true, outside = 1 } = options
  const pieces = wallPieces(length, height, openings).map(piece => ({
    ...piece,
    from: piece.from === 0 ? -startExtra : piece.from,
    to: piece.to === length ? length + endExtra : piece.to,
  }))
  const boxes = pieces.map((piece) => {
    const geometry = new BoxGeometry(cm(piece.to - piece.from), cm(piece.top - piece.bottom), cm(thickness))
    geometry.translate(cm((piece.from + piece.to) / 2 - length / 2), cm((piece.top + piece.bottom) / 2), 0)
    return geometry
  })
  if (boxes.length) {
    const merged = mergeGeometries(boxes)
    for (const piece of boxes) piece.dispose()
    // Owned by this wall: its size is its own, so it isn't cached.
    context.geometries.set(`wall:${group.uuid}`, merged)
    const mesh = new Mesh(merged, context.materials.tinted(surface, color))
    mesh.castShadow = surface !== 'glass'
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const opening of openings) {
    const x = opening.offset + opening.width / 2 - length / 2
    // A door's or window's colour (D285): a window's frame and shutters, a door's leaf.
    const frame = context.materials.tinted('frame', opening.kind === 'window' ? opening.color : undefined)
    if (opening.kind === 'window') {
      const { bottom, top } = openingSpan(opening, height)
      const glass = addBox(context, group, opening.width - 4, top - bottom - 4, 2, context.materials.surface('glass'), { x, y: (top + bottom) / 2, z: 0 }, false)
      glass.userData.windowId = opening.id
      addBox(context, group, opening.width, 4, thickness + 2, frame, { x, y: bottom + 2, z: 0 })
      addBox(context, group, opening.width, 4, 8, frame, { x, y: top - 2, z: 0 })
      addBox(context, group, 4, top - bottom, 8, frame, { x: x - opening.width / 2 + 2, y: (top + bottom) / 2, z: 0 })
      addBox(context, group, 4, top - bottom, 8, frame, { x: x + opening.width / 2 - 2, y: (top + bottom) / 2, z: 0 })
      // Panes (the default) split it every 90 cm or so; a single pane has none (D285).
      const panes = opening.style === 'single' ? 1 : Math.max(1, Math.round(opening.width / 90))
      for (let mullion = 1; mullion < panes; mullion++) {
        addBox(context, group, 3, top - bottom, 6, frame, { x: x - opening.width / 2 + (mullion * opening.width) / panes, y: (top + bottom) / 2, z: 0 })
      }
      if (opening.style === 'shutters') {
        // Two louvred shutters, open flat against the outside face either side of the window.
        const shutter = context.materials.tinted('shutter-green', opening.color)
        for (const end of [-1, 1]) {
          const panel = addBox(context, group, opening.width / 2, top - bottom, 2, shutter, { x: x + end * (opening.width * 0.75 + 1), y: (top + bottom) / 2, z: outside * (thickness / 2 + 1) })
          panel.userData.shutter = opening.id
        }
      }
    }
    else {
      if (!leaves || opening.leaf === false) continue
      const doorHeight = openingSpan(opening, height).top
      addBox(context, group, opening.width, 5, thickness + 1, context.materials.surface('frame'), { x, y: doorHeight - 2.5, z: 0 })
      // The leaf and its handle name their door, so Explore (D275) can swing them on a hinge.
      // A glazed or louvred leaf is one merged frame (D285), so Explore still finds it as the
      // largest part, the whole leaf's size; a glazed leaf's glass swings with it.
      const leafWidth = opening.width - 6
      const leafHeight = doorHeight - 3
      const at = { x, y: leafHeight / 2, z: -thickness / 2 + 4 }
      const wood = context.materials.finish(opening.color ?? 'walnut', 'wood')
      const leaf = opening.style === 'glazed' || opening.style === 'louvred'
        ? addMesh(group, leafFrame(context, group, opening.id, leafWidth, leafHeight, opening.style), wood, at)
        : addBox(context, group, leafWidth, leafHeight, 4, wood, at)
      const parts = [leaf]
      if (opening.style === 'glazed') parts.push(addBox(context, group, leafWidth - 20, leafHeight - 40, 1, context.materials.surface('glass'), { ...at, y: at.y + 6 }, false))
      // The handle at the leaf's free end, away from its hinge (D282).
      const free = opening.hinge === 'end' ? -1 : 1
      parts.push(addBox(context, group, 2, 18, 4, context.materials.finish('brass'), { x: x + free * (opening.width / 2 - 14), y: Math.min(105, doorHeight - 20), z: -thickness / 2 + 1 }))
      for (const part of parts) part.userData.doorId = opening.id
      leaf.userData.hinge = opening.hinge ?? 'start'
      leaf.userData.swing = opening.swing ?? 'in'
    }
  }
}

/**
 * A glazed or louvred door's leaf (D285): stiles and rails round a gap for the glass, or round
 * slats every 8 cm. Centred on its middle, like a box, and owned by its wall's group.
 */
function leafFrame(context: BuildContext, group: Group, id: string, width: number, height: number, style: 'glazed' | 'louvred'): BufferGeometry {
  const parts: BufferGeometry[] = []
  const add = (w: number, h: number, d: number, x: number, y: number) => {
    const geometry = new BoxGeometry(cm(w), cm(h), cm(d))
    geometry.translate(cm(x), cm(y), 0)
    parts.push(geometry)
  }
  const stile = 10
  const top = 14
  const bottom = style === 'glazed' ? 26 : 14
  add(stile, height, 4, -width / 2 + stile / 2, 0)
  add(stile, height, 4, width / 2 - stile / 2, 0)
  add(width - stile * 2, top, 4, 0, height / 2 - top / 2)
  add(width - stile * 2, bottom, 4, 0, -height / 2 + bottom / 2)
  if (style === 'louvred') {
    for (let y = -height / 2 + bottom + 4; y < height / 2 - top - 2; y += 8) add(width - stile * 2, 5, 2, 0, y + 2.5)
  }
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  context.geometries.set(`leaf:${group.uuid}:${id}`, merged)
  return merged
}

function addMesh(group: Group, geometry: BufferGeometry, material: Material, at: { x: number, y: number, z: number }): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.position.set(cm(at.x), cm(at.y), cm(at.z))
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

/** Posts, a top rail and thin balusters, merged per edge. */
/** `top`: the rail's height (a railing's own, D282, or `RAILING_HEIGHT_CM`). */
function railingEdge(context: BuildContext, group: Group, length: number, openings: readonly Opening[], top = RAILING_HEIGHT_CM, color?: string) {
  const metal = context.materials.tinted('frame', color)
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
    add(width + (openings.length ? 0 : 4), 5, 6, middle, top - 2.5)
    add(width, 3, 3, middle, 12)
    const posts = Math.max(1, Math.ceil(width / 150))
    for (let post = 0; post <= posts; post++) {
      const x = start + postWidth / 2 + post * (width - postWidth) / posts
      add(postWidth, top, 5, x, top / 2)
    }
    const balusters = Math.floor(width / 12)
    for (let baluster = 1; baluster < balusters; baluster++) {
      add(1.4, top - 18, 1.4, start + baluster * width / balusters, (top - 18) / 2 + 13.5)
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

function addBox(context: BuildContext, group: Group, width: number, height: number, depth: number, material: Material, at: { x: number, y: number, z: number }, shadow = true): Mesh {
  const mesh = new Mesh(blockGeometry(context, Math.round(width * 10) / 10, Math.round(height * 10) / 10, depth), material)
  mesh.position.set(cm(at.x), cm(at.y), cm(at.z))
  mesh.castShadow = shadow
  mesh.receiveShadow = shadow
  group.add(mesh)
  return mesh
}
