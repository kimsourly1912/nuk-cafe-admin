import { BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, LatheGeometry, Mesh, Quaternion, TorusGeometry, Vector2, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Finish, ItemKind, TableLook } from '#shared/contracts/shop-layout'
import { ITEM_SPECS, itemFinish, lookFinish } from '../catalog'
import { BOOTH_BENCH_DEPTH_CM, chairPoses } from '../geometry'
import type { MaterialLibrary } from './materials'
import { cm, yRotation } from './units'

/**
 * Furniture generated from code (D273): anything that resizes keeps its legs, rails and cushions
 * at their real thickness, and only moves them to the new size. Every builder returns a group whose
 * origin is the centre of its footprint on the floor, front towards +z (the plan's +y), all in
 * metres. Geometries are cached by size and shared.
 */

export interface BuildContext {
  materials: MaterialLibrary
  geometries: Map<string, BufferGeometry>
}

export function createBuildContext(materials: MaterialLibrary): BuildContext {
  return { materials, geometries: new Map() }
}

export function disposeBuildContext(context: BuildContext) {
  for (const geometry of context.geometries.values()) geometry.dispose()
  context.geometries.clear()
}

interface At {
  x: number
  y: number
  z: number
}

const TABLE_HEIGHT_CM = 74

function cached(context: BuildContext, key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = context.geometries.get(key)
  if (!geometry) {
    geometry = make()
    context.geometries.set(key, geometry)
  }
  return geometry
}

/** A mesh placed in centimetres. */
function part(geometry: BufferGeometry, material: Material, at: At, name?: string): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.position.set(cm(at.x), cm(at.y), cm(at.z))
  mesh.castShadow = true
  mesh.receiveShadow = true
  if (name) mesh.userData.part = name
  return mesh
}

function box(context: BuildContext, width: number, height: number, depth: number, radius = 0): BufferGeometry {
  const key = `box:${width}:${height}:${depth}:${radius}`
  return cached(context, key, () => radius > 0
    ? new RoundedBoxGeometry(cm(width), cm(height), cm(depth), 3, cm(Math.min(radius, width / 2, height / 2, depth / 2)))
    : new BoxGeometry(cm(width), cm(height), cm(depth)))
}

function cylinder(context: BuildContext, top: number, bottom: number, height: number, segments = 20): BufferGeometry {
  return cached(context, `cyl:${top}:${bottom}:${height}:${segments}`, () => new CylinderGeometry(cm(top), cm(bottom), cm(height), segments))
}

/** A disc with softened edges (a tabletop, a foot, a seat), lying flat, centred on its middle. */
function disc(context: BuildContext, radius: number, thickness: number, bevel = 1): BufferGeometry {
  return cached(context, `disc:${radius}:${thickness}:${bevel}`, () => {
    const half = thickness / 2
    const profile = [
      new Vector2(0, -half),
      new Vector2(radius - bevel, -half),
      new Vector2(radius, -half + bevel),
      new Vector2(radius, half - bevel),
      new Vector2(radius - bevel, half),
      new Vector2(0, half),
    ].map(point => new Vector2(cm(point.x), cm(point.y)))
    return new LatheGeometry(profile, 64)
  })
}

/** A round rod from one point to another (legs that splay, handrails), in centimetres. */
function rod(context: BuildContext, from: At, to: At, radius: number, material: Material): Mesh {
  const start = new Vector3(from.x, from.y, from.z)
  const end = new Vector3(to.x, to.y, to.z)
  const length = start.distanceTo(end)
  const mesh = part(cylinder(context, radius, radius, Math.round(length * 10) / 10, 12), material, {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    z: (from.z + to.z) / 2,
  })
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize()))
  return mesh
}

function torus(context: BuildContext, radius: number, tube: number, arc = Math.PI * 2): BufferGeometry {
  return cached(context, `torus:${radius}:${tube}:${arc.toFixed(3)}`, () => new TorusGeometry(cm(radius), cm(tube), 10, 40, arc))
}

export interface ItemBuild {
  kind: ItemKind
  width: number
  depth: number
  finishes: Partial<Record<string, Finish>>
  /**
   * How tall it is (step 3e, a chair's or fixture's own height in its kind's range); left out, the
   * kind's default. Parts keep their real thickness: a taller chair has a higher seat, not thicker legs.
   */
  height?: number
  /** The floor's height, for stairs. */
  floorHeight?: number
}

export function buildItem(context: BuildContext, item: ItemBuild): Group {
  const finish = (key: string) => context.materials.finish(itemFinish(item.kind, item.finishes, key))
  const group = new Group()
  const height = item.height ?? ITEM_SPECS[item.kind].height
  switch (item.kind) {
    case 'cafe-chair':
      cafeChair(context, group, item.width, item.depth, height, finish('frame'), finish('seat'))
      break
    case 'bentwood-chair':
      bentwoodChair(context, group, item.width, item.depth, height, finish('frame'))
      break
    case 'bar-stool':
      barStool(context, group, item.width, height, finish('frame'), finish('seat'))
      break
    case 'dining-bench':
      diningBench(context, group, item.width, item.depth, height, finish('frame'), finish('seat'))
      break
    case 'service-counter':
      serviceCounter(context, group, item.width, item.depth, height, finish('cabinet'), finish('top'))
      break
    case 'display-shelf':
      displayShelf(context, group, item.width, item.depth, height, finish('frame'))
      break
    case 'planter':
      planter(context, group, item.width, item.depth, height, finish('box'))
      break
    case 'plant':
      plant(context, group, item.width, height, finish('pot'))
      break
    case 'room-divider':
      roomDivider(context, group, item.width, item.depth, height, finish('frame'))
      break
    case 'armchair':
      armchair(context, group, item.width, item.depth, height, finish('frame'), finish('seat'))
      break
    case 'sofa':
      sofa(context, group, item.width, item.depth, height, finish('frame'), finish('seat'))
      break
    case 'coffee-table':
      coffeeTable(context, group, item.width, item.depth, height, finish('top'), finish('base'))
      break
    case 'coffee-station':
      coffeeStation(context, group, item.width, item.depth, height, finish('cabinet'), finish('top'), finish('machine'))
      break
    case 'pastry-case':
      pastryCase(context, group, item.width, item.depth, height, finish('cabinet'), finish('frame'))
      break
    case 'menu-board':
      menuBoard(context, group, item.width, item.depth, height, finish('frame'))
      break
    case 'pendant-lamp':
      pendantLamp(context, group, item.width, height, item.floorHeight ?? height + 60, finish('shade'))
      break
    case 'floor-lamp':
      floorLamp(context, group, item.width, height, finish('base'), finish('shade'))
      break
    case 'water-jar':
      waterJar(context, group, item.width, height, finish('jar'))
      break
    case 'parasol':
      parasol(context, group, item.width, height, finish('canopy'), finish('pole'))
      break
    case 'bicycle':
      bicycle(context, group, height, finish('frame'))
      break
    case 'stairs':
      stairs(context, group, item.width, item.depth, item.floorHeight ?? 300, finish('tread'))
      break
  }
  group.userData.kind = item.kind
  return group
}

/**
 * A dining table in its look, with one chair per seat (D273) or a booth's benches. The top is
 * named `top`, so a selection can light it up.
 */
export function buildTable(context: BuildContext, look: TableLook, width: number, depth: number, seats: number): Group {
  const group = new Group()
  const top = context.materials.finish(lookFinish(look, 'top'))
  const base = context.materials.finish(lookFinish(look, 'base'))
  const height = TABLE_HEIGHT_CM
  if (look.shape === 'round') {
    const radius = Math.max(width, depth) / 2
    // A cylinder's caps map the grain straight across, as on a real tabletop (a lathe's would ring).
    group.add(part(cylinder(context, radius, radius - 0.6, 3.6, 64), top, { x: 0, y: height - 1.8, z: 0 }, 'top'))
  }
  else {
    group.add(part(box(context, width, 4, depth, 1.4), top, { x: 0, y: height - 2, z: 0 }, 'top'))
  }
  if (look.base === 'pedestal') {
    const foot = Math.max(22, Math.min(width, depth) * 0.32)
    group.add(part(cylinder(context, 3.4, 3.4, height - 7), base, { x: 0, y: (height - 7) / 2 + 2, z: 0 }))
    group.add(part(disc(context, foot, 3, 1.2), base, { x: 0, y: 1.5, z: 0 }))
    group.add(part(disc(context, 12, 2, 0.6), base, { x: 0, y: height - 5, z: 0 }))
  }
  else {
    const legHeight = height - 4
    const insetX = look.shape === 'round' ? width * 0.3 : width / 2 - 6
    const insetZ = look.shape === 'round' ? depth * 0.3 : depth / 2 - 6
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      group.add(part(cylinder(context, 2.4, 1.8, legHeight, 16), base, { x: sx * insetX, y: legHeight / 2, z: sz * insetZ }))
    }
    if (look.shape !== 'round') {
      group.add(part(box(context, width - 14, 6, 2.4), base, { x: 0, y: height - 7, z: depth / 2 - 6 }))
      group.add(part(box(context, width - 14, 6, 2.4), base, { x: 0, y: height - 7, z: -(depth / 2 - 6) }))
    }
  }
  if (look.shape === 'booth') {
    const frame = context.materials.finish(lookFinish(look, 'frame'))
    const seat = context.materials.finish(lookFinish(look, 'seat'))
    for (const side of [1, -1]) {
      const bench = boothBench(context, width + 10, frame, seat)
      bench.position.z = cm(side * (depth / 2 + BOOTH_BENCH_DEPTH_CM / 2))
      bench.rotation.y = side > 0 ? 0 : Math.PI
      group.add(bench)
    }
  }
  const chairKind = look.chair
  if (chairKind === 'none') return group
  for (const pose of chairPoses(look, width, depth, seats)) {
    const chair = buildItem(context, { kind: chairKind, width: chairKind === 'bar-stool' ? 40 : 46, depth: chairKind === 'bar-stool' ? 40 : 50, finishes: { frame: lookFinish(look, 'frame'), seat: lookFinish(look, 'seat') } })
    chair.position.set(cm(pose.x), 0, cm(pose.y))
    chair.rotation.y = yRotation(pose.rotation)
    group.add(chair)
  }
  return group
}

/** A booth's bench: seat towards −z (the table), its tall back on +z. */
function boothBench(context: BuildContext, width: number, frame: Material, seat: Material): Group {
  const bench = new Group()
  const depth = BOOTH_BENCH_DEPTH_CM
  bench.add(part(box(context, width, 38, depth - 4, 2), frame, { x: 0, y: 19, z: 2 }))
  bench.add(part(box(context, width - 2, 9, depth - 12, 4), seat, { x: 0, y: 42, z: -2 }))
  bench.add(part(box(context, width, 70, 12, 2), frame, { x: 0, y: 70, z: depth / 2 - 6 }))
  bench.add(part(box(context, width - 4, 50, 8, 4), seat, { x: 0, y: 74, z: depth / 2 - 15 }))
  return bench
}

/** The seat is 37 cm under the top of the back at any height (45 cm at the default 82). */
function cafeChair(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material, seat: Material) {
  const seatHeight = height - 37
  const x = width / 2 - 4.5
  const z = depth / 2 - 5
  for (const side of [1, -1]) {
    group.add(part(cylinder(context, 1.7, 1.3, seatHeight - 5, 14), frame, { x: side * x, y: (seatHeight - 5) / 2, z }))
    group.add(rod(context, { x: side * x, y: 0.8, z: -z - 1 }, { x: side * (x - 1), y: height - 10, z: -z - 3.5 }, 1.6, frame))
  }
  group.add(part(box(context, width - 7, 5, depth - 9, 1.5), frame, { x: 0, y: seatHeight - 7.5, z: 0 }))
  group.add(part(box(context, width - 1, 7.5, depth - 6, 3.2), seat, { x: 0, y: seatHeight - 1.5, z: 1 }))
  const back = part(box(context, width - 3, 27, 6, 2.8), seat, { x: 0, y: height - 16, z: -z - 2 })
  back.rotation.x = -0.12
  group.add(back)
}

/** The seat is 42 cm under the top of the hoop (46 cm at the default 88). */
function bentwoodChair(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material) {
  const seatHeight = height - 42
  const hoopY = height - 14
  const radius = Math.min(width, depth) / 2 - 1
  group.add(part(disc(context, radius, 3.5, 1.2), frame, { x: 0, y: seatHeight, z: 0 }))
  const ring = part(torus(context, radius - 0.5, 1.1), frame, { x: 0, y: seatHeight - 3, z: 0 })
  ring.rotation.x = Math.PI / 2
  group.add(ring)
  for (let leg = 0; leg < 4; leg++) {
    const angle = Math.PI / 4 + (leg * Math.PI) / 2
    const top = radius - 5
    const bottom = radius - 1
    group.add(rod(context, { x: Math.cos(angle) * top, y: seatHeight - 3, z: Math.sin(angle) * top }, { x: Math.cos(angle) * bottom, y: 0.8, z: Math.sin(angle) * bottom }, 1.3, frame))
  }
  const legRing = part(torus(context, radius - 3.5, 0.8), frame, { x: 0, y: Math.round(seatHeight * 0.435), z: 0 })
  legRing.rotation.x = Math.PI / 2
  group.add(legRing)
  const backZ = -(radius - 2)
  for (const side of [1, -1]) group.add(rod(context, { x: side * 12, y: seatHeight, z: backZ }, { x: side * 13, y: hoopY, z: backZ - 4 }, 1.2, frame))
  const hoop = part(torus(context, 13, 1.2, Math.PI), frame, { x: 0, y: hoopY, z: backZ - 4 })
  hoop.rotation.x = -0.15
  group.add(hoop)
  const inner = part(torus(context, 8, 0.9, Math.PI), frame, { x: 0, y: hoopY - 8, z: backZ - 3 })
  inner.rotation.x = -0.15
  group.add(inner)
}

/** The footrest ring sits at 37% of the height (28 cm at the default 75). */
function barStool(context: BuildContext, group: Group, width: number, height: number, frame: Material, seat: Material) {
  const radius = width / 2 - 1
  group.add(part(cylinder(context, radius, radius - 1, 6, 32), seat, { x: 0, y: height - 3, z: 0 }))
  group.add(part(disc(context, radius - 1, 3, 1), frame, { x: 0, y: height - 7.5, z: 0 }))
  for (let leg = 0; leg < 4; leg++) {
    const angle = Math.PI / 4 + (leg * Math.PI) / 2
    group.add(rod(context, { x: Math.cos(angle) * 11, y: height - 8, z: Math.sin(angle) * 11 }, { x: Math.cos(angle) * (radius - 1), y: 0.8, z: Math.sin(angle) * (radius - 1) }, 1.4, frame))
  }
  const ring = part(torus(context, 15.5, 1), frame, { x: 0, y: Math.round(height * 0.373), z: 0 })
  ring.rotation.x = Math.PI / 2
  group.add(ring)
}

function diningBench(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material, seat: Material) {
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    group.add(part(box(context, 4.5, height - 8, 4.5, 0.8), frame, { x: sx * (width / 2 - 6), y: (height - 8) / 2, z: sz * (depth / 2 - 5) }))
  }
  group.add(part(box(context, width - 12, 4, 3, 0.6), frame, { x: 0, y: Math.round(height * 0.3), z: 0 }))
  group.add(part(box(context, width, 4, depth, 1), frame, { x: 0, y: height - 7, z: 0 }))
  group.add(part(box(context, width - 2, 6, depth - 2, 2.5), seat, { x: 0, y: height - 2, z: 0 }))
}

function serviceCounter(context: BuildContext, group: Group, width: number, depth: number, height: number, cabinet: Material, top: Material) {
  const plinth = context.materials.surface('plinth')
  group.add(part(box(context, width - 6, 8, depth - 6), plinth, { x: 0, y: 4, z: 0 }))
  const body = height - 4 - 8
  group.add(part(box(context, width - 2, body, depth - 2, 0.8), cabinet, { x: 0, y: 8 + body / 2, z: 0 }))
  const flutes = cached(context, `flutes:${width}:${body}`, () => {
    const count = Math.floor((width - 6) / 4)
    const pieces = Array.from({ length: count }, (_, index) => {
      const flute = new CylinderGeometry(cm(1.9), cm(1.9), cm(body - 6), 10)
      flute.translate(cm(-((count - 1) * 4) / 2 + index * 4), 0, 0)
      return flute
    })
    const merged = mergeGeometries(pieces)
    for (const piece of pieces) piece.dispose()
    return merged
  })
  group.add(part(flutes, cabinet, { x: 0, y: 8 + body / 2, z: depth / 2 - 1 }))
  group.add(part(box(context, width + 4, 4, depth + 4, 1.2), top, { x: 0, y: height - 2, z: 0 }))
}

/**
 * A cupboard below (72 cm, lower on a short shelf) and open shelves about 30 cm apart above it, the
 * highest 20 cm under the top so its jars fit: three at the default 190.
 */
function displayShelf(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material) {
  const cupboard = Math.min(72, Math.round(height * 0.6))
  for (const side of [1, -1]) group.add(part(box(context, 3, height, depth, 0.6), frame, { x: side * (width / 2 - 1.5), y: height / 2, z: 0 }))
  group.add(part(box(context, width - 6, height - 2, 1.6), frame, { x: 0, y: height / 2, z: -(depth / 2 - 0.8) }))
  group.add(part(box(context, width - 6, cupboard, depth - 2, 0.8), frame, { x: 0, y: cupboard / 2, z: 0 }))
  group.add(part(box(context, 0.6, cupboard - 12, 0.6), context.materials.surface('plinth'), { x: 0, y: cupboard / 2 + 2, z: depth / 2 }))
  const ceramic = context.materials.surface('ceramic')
  const first = cupboard + 38
  const last = height - 20
  const count = last < first ? 0 : Math.floor((last - first) / 30) + 1
  const shelves = Array.from({ length: count }, (_, index) => (count === 1 ? first : Math.round(first + (index * (last - first)) / (count - 1))))
  shelves.forEach((y, row) => {
    group.add(part(box(context, width - 6, 2.5, depth - 3, 0.5), frame, { x: 0, y, z: 0.5 }))
    const count = Math.max(2, Math.floor((width - 10) / 22))
    for (let index = 0; index < count; index++) {
      if ((index + row) % 3 === 2) continue
      const x = -((count - 1) * 22) / 2 + index * 22
      const tall = (index + row) % 2 === 0
      group.add(part(cylinder(context, tall ? 4 : 5, tall ? 3.6 : 4.4, tall ? 14 : 9, 16), ceramic, { x, y: y + 1.25 + (tall ? 7 : 4.5), z: 0 }))
    }
  })
  group.add(part(box(context, width - 6, 2.5, depth - 3, 0.5), frame, { x: 0, y: height - 1.25, z: 0.5 }))
}

/** `height` is to the top of the bushes, 30 cm over the box (a 45 cm box at the default 75). */
function planter(context: BuildContext, group: Group, width: number, depth: number, height: number, boxMaterial: Material) {
  const boxHeight = height - 30
  group.add(part(box(context, width, boxHeight, depth, 1.2), boxMaterial, { x: 0, y: boxHeight / 2, z: 0 }))
  group.add(part(box(context, width - 4, 1, depth - 4), context.materials.surface('soil'), { x: 0, y: boxHeight - 1, z: 0 }))
  // Bushes of 13–16 cm stay over the box, so the plan's footprint is the planter's.
  const count = Math.max(2, Math.round(width / 30))
  const span = Math.max(0, width - 2 * 16)
  for (let index = 0; index < count; index++) {
    const x = count === 1 ? 0 : -span / 2 + (index * span) / (count - 1)
    bush(context, group, { x, y: boxHeight + 8, z: 0 }, Math.min(13 + (index % 2) * 3, depth / 2), index)
  }
}

/**
 * The pot is 38 cm (lower on a small plant); the leaves reach `height` (125 by default), so a tall
 * plant is a taller stem and wider-spaced clusters, the leaves their real size.
 */
function plant(context: BuildContext, group: Group, width: number, height: number, pot: Material) {
  const radius = width / 2
  const potHeight = Math.round(38 * Math.min(1, Math.max(0.6, height / 125)))
  const grow = (height - potHeight - 17) / 70
  const profile = [
    new Vector2(0, 0),
    new Vector2(radius * 0.62, 0),
    new Vector2(radius * 0.84, potHeight - 3),
    new Vector2(radius * 0.86, potHeight),
    new Vector2(radius * 0.8, potHeight),
  ].map(point => new Vector2(cm(point.x), cm(point.y)))
  group.add(part(cached(context, `pot:${width}:${potHeight}`, () => new LatheGeometry(profile, 32)), pot, { x: 0, y: 0, z: 0 }))
  group.add(part(disc(context, radius * 0.78, 1, 0.2), context.materials.surface('soil'), { x: 0, y: potHeight - 3, z: 0 }))
  const stem = Math.round(40 * grow)
  group.add(part(cylinder(context, 1, 1.4, stem, 8), context.materials.surface('leaf-dark'), { x: 0, y: potHeight + Math.round(18 * grow), z: 0 }))
  const clusters: At[] = [
    { x: 0, y: 100, z: 0 },
    { x: 11, y: 82, z: 5 },
    { x: -10, y: 86, z: -6 },
    { x: 4, y: 68, z: -11 },
    { x: -7, y: 66, z: 10 },
    { x: 9, y: 108, z: -6 },
  ]
  clusters.forEach((at, index) => bush(context, group, { ...at, y: potHeight + (at.y - 38) * grow }, 10 + (index % 3) * 3, index))
}

function bush(context: BuildContext, group: Group, at: At, radius: number, index: number) {
  const leaf = context.materials.surface(index % 2 ? 'leaf' : 'leaf-dark')
  const mesh = part(cached(context, `bush:${radius}`, () => new IcosahedronGeometry(cm(radius), 1)), leaf, at)
  mesh.rotation.set(index * 0.7, index * 1.3, 0)
  mesh.scale.set(1, 0.85, 1)
  group.add(mesh)
}

function roomDivider(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material) {
  const rail = depth
  for (const side of [1, -1]) group.add(part(box(context, 4, height, rail, 0.6), frame, { x: side * (width / 2 - 2), y: height / 2, z: 0 }))
  group.add(part(box(context, width, 4, rail, 0.6), frame, { x: 0, y: height - 2, z: 0 }))
  group.add(part(box(context, width, 4, rail, 0.6), frame, { x: 0, y: 6, z: 0 }))
  const slats = cached(context, `slats:${width}:${height}`, () => {
    const count = Math.floor((width - 8) / 6)
    const pieces = Array.from({ length: count }, (_, index) => {
      const slat = new BoxGeometry(cm(2.6), cm(height - 12), cm(2))
      slat.translate(cm(-((count - 1) * 6) / 2 + index * 6), 0, 0)
      return slat
    })
    const merged = mergeGeometries(pieces)
    for (const piece of pieces) piece.dispose()
    return merged
  })
  group.add(part(slats, frame, { x: 0, y: height / 2, z: 0 }))
}

// --- Step 3f: lounge seating, bar and service, decor and lighting, outdoor ---

/** A lathe from a profile in centimetres (x out from the axis, y up), cached by `key`. */
function lathe(context: BuildContext, key: string, profile: [number, number][], segments = 32): BufferGeometry {
  return cached(context, `lathe:${key}`, () => new LatheGeometry(profile.map(([x, y]) => new Vector2(cm(x), cm(y))), segments))
}

/**
 * A lounge chair: a low seat (half its height), a thick cushion, arms and a cushioned back. The
 * back's top is `height`.
 */
function armchair(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material, seat: Material) {
  const seatHeight = Math.round(height * 0.5)
  const base = seatHeight - 14
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    group.add(part(cylinder(context, 2, 1.4, base, 12), frame, { x: sx * (width / 2 - 7), y: base / 2, z: sz * (depth / 2 - 7) }))
  }
  group.add(part(box(context, width, 6, depth, 1.5), frame, { x: 0, y: base + 3, z: 0 }))
  group.add(part(box(context, width - 18, 12, depth - 16, 4), seat, { x: 0, y: seatHeight, z: 3 }))
  for (const side of [1, -1]) group.add(part(box(context, 8, 36, depth - 4, 2), frame, { x: side * (width / 2 - 4), y: base + 18, z: 0 }))
  const backHeight = height - base
  group.add(part(box(context, width, backHeight, 6, 2), frame, { x: 0, y: base + backHeight / 2, z: -(depth / 2 - 3) }))
  group.add(part(box(context, width - 18, backHeight - 22, 10, 4), seat, { x: 0, y: seatHeight + (backHeight - 22) / 2 - 2, z: -(depth / 2 - 11) }))
}

/** A sofa: as an armchair, with a cushion every 60 cm or so. */
function sofa(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material, seat: Material) {
  const seatHeight = Math.round(height * 0.52)
  const base = seatHeight - 16
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    group.add(part(cylinder(context, 2.2, 1.6, base, 12), frame, { x: sx * (width / 2 - 8), y: base / 2, z: sz * (depth / 2 - 8) }))
  }
  group.add(part(box(context, width, 10, depth, 2), seat, { x: 0, y: base + 5, z: 0 }))
  const arm = 14
  for (const side of [1, -1]) group.add(part(box(context, arm, 40, depth, 4), seat, { x: side * (width / 2 - arm / 2), y: base + 20, z: 0 }))
  const inner = width - 2 * arm
  const cushions = Math.max(1, Math.round(inner / 60))
  const each = inner / cushions
  const backHeight = height - base
  group.add(part(box(context, width, backHeight, 14, 4), seat, { x: 0, y: base + backHeight / 2, z: -(depth / 2 - 7) }))
  for (let index = 0; index < cushions; index++) {
    const x = -inner / 2 + each * (index + 0.5)
    group.add(part(box(context, Math.round(each - 2), 12, depth - 22, 5), seat, { x, y: seatHeight, z: 4 }))
    group.add(part(box(context, Math.round(each - 4), backHeight - 26, 12, 5), seat, { x, y: seatHeight + (backHeight - 26) / 2 - 2, z: -(depth / 2 - 19) }))
  }
  group.add(part(box(context, width - 4, 3, depth - 4, 1), frame, { x: 0, y: base - 1.5, z: 0 }))
}

/** A low table: a top, four legs and a shelf underneath. */
function coffeeTable(context: BuildContext, group: Group, width: number, depth: number, height: number, top: Material, base: Material) {
  group.add(part(box(context, width, 4, depth, 1.2), top, { x: 0, y: height - 2, z: 0 }))
  const legHeight = height - 4
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    group.add(part(cylinder(context, 1.8, 1.8, legHeight, 12), base, { x: sx * (width / 2 - 5), y: legHeight / 2, z: sz * (depth / 2 - 5) }))
  }
  group.add(part(box(context, width - 12, 2, depth - 12, 0.6), base, { x: 0, y: Math.round(height * 0.25), z: 0 }))
}

/**
 * A coffee bar: a counter (`height` is its top) with an espresso machine, a grinder and cups on
 * it, the machine's front towards +z (where the barista stands is the back).
 */
function coffeeStation(context: BuildContext, group: Group, width: number, depth: number, height: number, cabinet: Material, top: Material, machine: Material) {
  serviceCounter(context, group, width, depth, height, cabinet, top)
  const body = Math.min(62, width * 0.45)
  const x = -width / 2 + body / 2 + 10
  group.add(part(box(context, body, 38, 42, 3), machine, { x, y: height + 19, z: -2 }))
  const dark = context.materials.surface('plinth')
  group.add(part(box(context, body - 8, 2, 16), dark, { x, y: height + 2, z: 14 }))
  for (const side of [-1, 1]) {
    group.add(part(cylinder(context, 4, 4, 6, 16), machine, { x: x + side * body / 5, y: height + 15, z: 20 }))
    group.add(rod(context, { x: x + side * body / 5, y: height + 13, z: 23 }, { x: x + side * body / 5, y: height + 11, z: 33 }, 1, dark))
  }
  const ceramic = context.materials.surface('ceramic')
  for (let cup = 0; cup < 4; cup++) group.add(part(cylinder(context, 3.5, 3, 6, 16), ceramic, { x: x - body / 2 + 8 + cup * 10, y: height + 41, z: -6 }))
  const grinderX = x + body / 2 + 22
  group.add(part(box(context, 20, 30, 22, 2), machine, { x: grinderX, y: height + 15, z: -4 }))
  group.add(part(lathe(context, 'hopper', [[2, 0], [9, 16], [8, 16], [1, 0.5]], 24), context.materials.surface('glass'), { x: grinderX, y: height + 30, z: -4 }))
}

/** A glass pastry case on a cabinet, pastries on two glass shelves; its top is `height`. */
function pastryCase(context: BuildContext, group: Group, width: number, depth: number, height: number, cabinet: Material, frame: Material) {
  const caseHeight = 45
  const base = height - caseHeight
  group.add(part(box(context, width, base, depth, 1), cabinet, { x: 0, y: base / 2, z: 0 }))
  group.add(part(box(context, width - 4, caseHeight - 3, depth - 6), context.materials.surface('glass'), { x: 0, y: base + (caseHeight - 3) / 2, z: 0 }))
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    group.add(part(box(context, 2, caseHeight - 3, 2), frame, { x: sx * (width / 2 - 3), y: base + (caseHeight - 3) / 2, z: sz * (depth / 2 - 4) }))
  }
  group.add(part(box(context, width - 2, 3, depth - 4, 0.6), frame, { x: 0, y: height - 1.5, z: 0 }))
  const pastry = context.materials.surface('pastry')
  const count = Math.max(2, Math.floor((width - 16) / 18))
  for (const [row, y] of [[0, base + 2], [1, base + 22]] as const) {
    for (let index = 0; index < count; index++) {
      const pastryMesh = part(cached(context, 'pastry', () => new IcosahedronGeometry(cm(6), 1)), pastry, { x: -((count - 1) * 18) / 2 + index * 18, y: y + 3, z: row ? -8 : 6 })
      pastryMesh.scale.set(1, 0.5, 0.8)
      group.add(pastryMesh)
    }
  }
}

/** A sandwich board: two framed slates leaning together, their feet `depth` apart. */
function menuBoard(context: BuildContext, group: Group, width: number, depth: number, height: number, frame: Material) {
  const lean = Math.atan((depth / 2 - 4) / height)
  const length = Math.round(height / Math.cos(lean))
  const slate = context.materials.surface('chalkboard')
  for (const side of [1, -1]) {
    const board = new Group()
    board.add(part(box(context, width, length, 3, 0.6), frame, { x: 0, y: 0, z: 0 }))
    board.add(part(box(context, width - 10, length - 12, 1), slate, { x: 0, y: 2, z: side * 1.6 }))
    // Lifted by its thickness's tilt, so its feet stand on the floor rather than in it.
    board.position.set(0, cm(height / 2 + 1), cm(side * (depth / 4)))
    board.rotation.x = -side * lean
    group.add(board)
  }
}

/**
 * A lamp hung from the ceiling: its shade's bottom at `height`, its cord up to `ceiling` (the
 * floor's height; a little above the shade where there is none, for its picture).
 */
function pendantLamp(context: BuildContext, group: Group, width: number, height: number, ceiling: number, shade: Material) {
  const radius = width / 2
  const bottom = Math.min(height, ceiling - 40)
  // A closed profile, so the shade has an inside when seen from below.
  group.add(part(lathe(context, `shade:${width}`, [[5, 22], [radius, 0], [radius - 0.8, 0], [4.2, 21.2]], 40), shade, { x: 0, y: bottom, z: 0 }))
  group.add(part(cached(context, 'bulb', () => new IcosahedronGeometry(cm(4), 2)), context.materials.surface('lamp'), { x: 0, y: bottom + 12, z: 0 }))
  const cord = Math.round(ceiling - bottom - 22)
  group.add(part(cylinder(context, 0.4, 0.4, cord, 6), context.materials.surface('frame'), { x: 0, y: bottom + 22 + cord / 2, z: 0 }))
  group.add(part(cylinder(context, 6, 6, 2, 16), context.materials.surface('frame'), { x: 0, y: ceiling - 1, z: 0 }))
}

/** A standing lamp: a round foot, a pole and a drum shade at the top. */
function floorLamp(context: BuildContext, group: Group, width: number, height: number, base: Material, shade: Material) {
  const radius = width / 2
  group.add(part(disc(context, Math.round(radius * 0.7), 2.5, 0.8), base, { x: 0, y: 1.25, z: 0 }))
  const pole = height - 30
  group.add(part(cylinder(context, 1.2, 1.2, pole, 10), base, { x: 0, y: pole / 2, z: 0 }))
  group.add(part(lathe(context, `drum:${width}`, [[radius - 6, 30], [radius, 0], [radius - 0.8, 0], [radius - 6.8, 29.2]], 40), shade, { x: 0, y: height - 30, z: 0 }))
  group.add(part(cached(context, 'bulb', () => new IcosahedronGeometry(cm(4), 2)), context.materials.surface('lamp'), { x: 0, y: height - 16, z: 0 }))
}

/** A Khmer water jar (a pāng): a wide glazed belly, a narrow neck and a wooden lid. */
function waterJar(context: BuildContext, group: Group, width: number, height: number, jar: Material) {
  const r = width / 2
  const h = height - 2
  group.add(part(lathe(context, `jar:${width}:${h}`, [[0, 0], [r * 0.55, 0], [r * 0.92, h * 0.3], [r, h * 0.5], [r * 0.86, h * 0.76], [r * 0.52, h * 0.94], [r * 0.56, h], [r * 0.48, h]], 40), jar, { x: 0, y: 0, z: 0 }))
  group.add(part(disc(context, Math.round(r * 0.56 + 1), 2, 0.6), context.materials.finish('dark-wood'), { x: 0, y: h + 1, z: 0 }))
}

/** A market parasol: a weighted foot, a pole and a canopy with a short valance; its top is `height`. */
function parasol(context: BuildContext, group: Group, width: number, height: number, canopy: Material, pole: Material) {
  const radius = width / 2
  group.add(part(cylinder(context, 24, 26, 8, 24), context.materials.surface('concrete'), { x: 0, y: 4, z: 0 }))
  group.add(part(cylinder(context, 2.2, 2.2, height - 4, 12), pole, { x: 0, y: (height - 4) / 2, z: 0 }))
  const rise = Math.round(radius * 0.32)
  group.add(part(lathe(context, `canopy:${width}`, [[1, rise], [radius, 0], [radius, -8], [radius - 1, -8], [radius - 1, 0], [1, rise - 1]], 48), canopy, { x: 0, y: height - rise - 2, z: 0 }))
  group.add(part(cached(context, 'finial', () => new IcosahedronGeometry(cm(2.5), 1)), pole, { x: 0, y: height - 2, z: 0 }))
}

/** A city bicycle along x (175 cm), its saddle and bars at `height`. */
function bicycle(context: BuildContext, group: Group, height: number, frame: Material) {
  const rubber = context.materials.surface('rubber')
  const chrome = context.materials.surface('chrome')
  const wheel = 33
  for (const x of [-53, 53]) {
    group.add(part(torus(context, wheel, 2), rubber, { x, y: wheel + 2, z: 0 }))
    group.add(part(torus(context, wheel - 2.5, 0.6), chrome, { x, y: wheel + 2, z: 0 }))
    const hub = part(cylinder(context, 2, 2, 8, 12), chrome, { x, y: wheel + 2, z: 0 })
    hub.rotation.x = Math.PI / 2
    group.add(hub)
  }
  const rear = { x: -53, y: wheel + 2, z: 0 }
  const front = { x: 53, y: wheel + 2, z: 0 }
  const crank = { x: -8, y: 30, z: 0 }
  const seat = { x: -22, y: height - 28, z: 0 }
  const head = { x: 38, y: height - 22, z: 0 }
  const fork = { x: 42, y: height - 40, z: 0 }
  for (const [from, to] of [[rear, crank], [rear, seat], [crank, seat], [seat, head], [crank, fork], [head, fork], [fork, front]] as const) {
    group.add(rod(context, from, to, 1.6, frame))
  }
  group.add(rod(context, seat, { x: -25, y: height - 6, z: 0 }, 1.1, chrome))
  group.add(part(box(context, 24, 5, 13, 2.4), context.materials.surface('plinth'), { x: -26, y: height - 3, z: 0 }))
  group.add(rod(context, head, { x: 36, y: height - 4, z: 0 }, 1.1, chrome))
  group.add(rod(context, { x: 36, y: height - 4, z: -24 }, { x: 36, y: height - 4, z: 24 }, 1.1, chrome))
  for (const side of [-1, 1]) group.add(rod(context, { x: 36, y: height - 4, z: side * 20 }, { x: 36, y: height - 4, z: side * 27 }, 1.8, rubber))
  const chainring = part(torus(context, 9, 1), chrome, { x: -8, y: 30, z: 4 })
  group.add(chainring)
}

/** Straight stairs rising towards −z (the plan's top), up to the floor above. */
function stairs(context: BuildContext, group: Group, width: number, depth: number, floorHeight: number, tread: Material) {
  const steps = Math.max(8, Math.round(floorHeight / 18))
  const rise = floorHeight / steps
  const run = depth / steps
  const side = context.materials.surface('plaster')
  for (let step = 0; step < steps; step++) {
    const height = rise * (step + 1)
    const z = depth / 2 - run * (step + 0.5)
    const block = Math.round((height - 3) * 10) / 10
    group.add(part(box(context, width, block, Math.round(run * 10) / 10), side, { x: 0, y: block / 2, z }))
    group.add(part(box(context, width + 1, 3, run + 2, 0.6), tread, { x: 0, y: height - 1.5, z }))
  }
  const metal = context.materials.surface('frame')
  const railX = width / 2 - 3
  const bottom: At = { x: railX, y: 90, z: depth / 2 - run }
  const top: At = { x: railX, y: floorHeight + 90 - rise, z: -depth / 2 + run }
  group.add(rod(context, bottom, top, 1.6, metal))
  for (let post = 1; post < steps; post += 3) {
    const z = depth / 2 - run * (post + 0.5)
    const y = rise * (post + 1)
    group.add(rod(context, { x: railX, y, z }, { x: railX, y: y + 90, z }, 1, metal))
  }
}

/** Every mesh below a root, for disposal and raycasting. */
export function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse(object => object instanceof Mesh && meshes.push(object))
  return meshes
}
