import { Box3, BoxGeometry, CatmullRomCurve3, CylinderGeometry, Group, IcosahedronGeometry, LatheGeometry, Mesh, PlaneGeometry, Shape, ShapeGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ShopLayout } from '#shared/contracts/shop-layout'
import type { Neighbour, Prop, Span, SurroundingsPlan, SurroundingsPreset } from '../surroundings'
import { planLane } from '../surroundings'
import { SLAB_THICKNESS_CM } from './building'
import { buildFigure } from './figures'
import type { BuildContext } from './furniture'
import { buildItem, createBuildContext } from './furniture'
import type { LaneSurface, MaterialLibrary } from './materials'
import { cm, yRotation } from './units'

/**
 * The surroundings in 3D (step 3h, D274): the Neighborhood lane built around the café from
 * `planLane`. Everything is generated from code in the furniture's style, and built in the café's
 * front frame (u along the street → x, n out of the café → z), then turned and moved onto the plan.
 *
 * Nothing here casts a sun shadow (the sun's shadow stays fitted to the café) and nothing is ever
 * picked (the viewer raycasts the building only). Static pieces are merged by material, one group
 * per shophouse (the cutaway hides a shophouse whole) and one for the rest, so the lane costs a few
 * dozen draw calls. Its geometries live in its own build context, freed with the surroundings.
 */

export interface SurroundingsBlock {
  object: Object3D
  /** The block's middle, in world coordinates. */
  center: Vector3
}

export interface BuiltSurroundings {
  root: Group
  /** Shophouses, for the cutaway to hide the ones between the camera and the café. */
  blocks: SurroundingsBlock[]
  /** The passer-by and the cat: hidden with Show people and pets. */
  figures: Object3D[]
  /** Moves the figures; `seconds` since the scene started. */
  idle: (seconds: number) => void
  bounds: Box3
  /** Owns the surroundings' geometries; dispose it with `disposeBuildContext`. */
  context: BuildContext
}

const PAINTS: LaneSurface[] = ['paint-yellow', 'paint-mint', 'paint-peach', 'paint-cream', 'paint-blue']
const SHUTTERS: LaneSurface[] = ['shutter-green', 'shutter-blue', 'shutter-brown']
const AWNINGS: LaneSurface[] = ['awning-red', 'awning-green', 'awning-blue']
/** Walking pace, metres a second. */
const WALK_SPEED = 0.75

export function buildSurroundings(materials: MaterialLibrary, layout: Pick<ShopLayout, 'floors'>, preset: SurroundingsPreset, seed: string): BuiltSurroundings | null {
  if (preset !== 'neighborhood-lane') return null
  const plan = planLane(layout, seed)
  if (!plan) return null
  const context = createBuildContext(materials)
  const build = new Builder(context)
  const root = new Group()
  root.name = 'surroundings'
  const ground = -cm(SLAB_THICKNESS_CM)
  // The frame: x along the street, z out of the café, origin on the front edge at ground level.
  const frame = new Group()
  frame.position.set(cm(plan.frame.origin.x), ground, cm(plan.frame.origin.y))
  frame.rotation.y = yRotation(plan.frame.angle)
  root.add(frame)

  frame.add(build.merged(groundPieces(build, plan), 'ground'))
  const blocks: SurroundingsBlock[] = []
  for (const neighbour of plan.neighbours) {
    const block = build.merged(shophouse(build, neighbour), `block:${neighbour.id}`)
    frame.add(block)
    blocks.push({ object: block, center: new Vector3() })
  }
  frame.add(build.merged(props(build, plan), 'props'))

  // The passer-by walks the lane's near side; the cat sits at its bowl by the café's door.
  const walker = buildFigure(context, 'person', `walker:${seed}`)
  const walkerAnchor = new Group()
  walkerAnchor.add(walker.body)
  const cat = buildFigure(context, 'cat', `cat:${seed}`)
  const catAnchor = new Group()
  catAnchor.add(cat.body)
  catAnchor.position.set(cm(plan.cat.u + 22), 0, cm(plan.cat.n))
  // Facing its bowl (towards −u).
  catAnchor.rotation.y = -Math.PI / 2
  frame.add(walkerAnchor, catAnchor)
  const { from, to } = plan.walk
  const length = Math.hypot(to.u - from.u, to.n - from.n)
  function idle(seconds: number) {
    // Back and forth along the lane, turning at each end.
    const travelled = (seconds * WALK_SPEED * 100) % (2 * length)
    const forward = travelled <= length
    const along = forward ? travelled : 2 * length - travelled
    walkerAnchor.position.set(cm(from.u + ((to.u - from.u) * along) / length), Math.abs(Math.sin(seconds * 5.2)) * 0.015, cm(from.n + ((to.n - from.n) * along) / length))
    walkerAnchor.rotation.y = forward ? Math.PI / 2 : -Math.PI / 2
    walker.idle(seconds)
    cat.idle(seconds)
  }
  idle(0)

  root.updateMatrixWorld(true)
  for (const block of blocks) new Box3().setFromObject(block.object).getCenter(block.center)
  root.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = false
  })
  const bounds = new Box3().setFromObject(root)
  return { root, blocks, figures: [walkerAnchor, catAnchor], idle, bounds, context }
}

interface At {
  x: number
  y: number
  z: number
}

/** Places pieces in centimetres and merges them by material. */
class Builder {
  private merges = 0
  constructor(readonly context: BuildContext) {}

  surface(key: LaneSurface | 'leaf' | 'leaf-dark' | 'lamp' | 'frame' | 'ceramic'): Material {
    return this.context.materials.surface(key)
  }

  geometry(key: string, make: () => BufferGeometry): BufferGeometry {
    let geometry = this.context.geometries.get(key)
    if (!geometry) {
      geometry = make()
      this.context.geometries.set(key, geometry)
    }
    return geometry
  }

  box(width: number, height: number, depth: number): BufferGeometry {
    return this.geometry(`lane-box:${width}:${height}:${depth}`, () => new BoxGeometry(cm(width), cm(height), cm(depth)))
  }

  /** A flat rectangle facing +z, its texture repeated every `tile` cm. */
  panel(width: number, height: number, tile: number): BufferGeometry {
    return this.geometry(`lane-panel:${width}:${height}:${tile}`, () => {
      const geometry = new PlaneGeometry(cm(width), cm(height))
      const uv = geometry.attributes.uv!
      for (let index = 0; index < uv.count; index++) uv.setXY(index, (uv.getX(index) * width) / tile, (uv.getY(index) * height) / tile)
      return geometry
    })
  }

  cylinder(top: number, bottom: number, height: number, segments = 12): BufferGeometry {
    return this.geometry(`lane-cyl:${top}:${bottom}:${height}:${segments}`, () => new CylinderGeometry(cm(top), cm(bottom), cm(height), segments))
  }

  blob(radius: number): BufferGeometry {
    return this.geometry(`lane-blob:${radius}`, () => new IcosahedronGeometry(cm(radius), 1))
  }

  mesh(geometry: BufferGeometry, material: Material, at: At, rotation?: Partial<At>): Mesh {
    const mesh = new Mesh(geometry, material)
    mesh.position.set(cm(at.x), cm(at.y), cm(at.z))
    if (rotation) mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0)
    mesh.receiveShadow = true
    return mesh
  }

  /**
   * One mesh per material for everything under `group`: the pieces' own geometries are copied into
   * the merged ones (registered in the context, freed with it).
   */
  merged(group: Group, name: string): Group {
    group.updateMatrixWorld(true)
    const byMaterial = new Map<Material, BufferGeometry[]>()
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const geometry = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrixWorld)
      for (const name of Object.keys(geometry.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name)
      }
      geometry.clearGroups()
      const list = byMaterial.get(object.material as Material) ?? []
      list.push(geometry)
      byMaterial.set(object.material as Material, list)
    })
    const result = new Group()
    result.name = name
    for (const [material, geometries] of byMaterial) {
      const merged = mergeGeometries(geometries)
      for (const geometry of geometries) geometry.dispose()
      if (!merged) continue
      this.context.geometries.set(`lane-merged:${name}:${this.merges++}`, merged)
      const mesh = new Mesh(merged, material)
      mesh.receiveShadow = true
      result.add(mesh)
    }
    return result
  }
}

const middle = (span: Span) => ({ u: (span.u0 + span.u1) / 2, n: (span.n0 + span.n1) / 2 })

/** The base with its crisp edge, the yard, the pavement and curb, the lane and its drain, the far side. */
function groundPieces(build: Builder, plan: SurroundingsPlan): Group {
  const group = new Group()
  const { base, yard, pavement, lane, farSide } = plan
  const depth = 40
  const baseMiddle = middle(base)
  group.add(build.mesh(build.box(base.u1 - base.u0, depth, base.n1 - base.n0), build.surface('base-edge'), { x: baseMiddle.u, y: -depth / 2 - 0.5, z: baseMiddle.n }))
  const flat = (span: Span, material: LaneSurface, tile: number, y = 0.4) => {
    const at = middle(span)
    group.add(build.mesh(build.panel(span.u1 - span.u0, span.n1 - span.n0, tile), build.surface(material), { x: at.u, y, z: at.n }, { x: -Math.PI / 2 }))
  }
  // Under the café and around the shophouses: the yard's paving, so an L's empty corner is paved.
  flat({ ...base, n1: pavement.n0 }, 'yard', 120, 0.2)
  flat({ ...base, n0: farSide.n1 }, 'pavers', 100)
  flat({ ...pavement, u0: base.u0, u1: base.u1 }, 'pavers', 100)
  flat({ ...lane, u0: base.u0, u1: base.u1 }, 'lane', 160)
  flat({ ...farSide, u0: base.u0, u1: base.u1 }, 'pavers', 100)
  const width = base.u1 - base.u0
  // The curb between pavement and lane, the drain along it, the low wall across the lane.
  group.add(build.mesh(build.box(width, 12, 14), build.surface('curb'), { x: baseMiddle.u, y: 6, z: pavement.n1 - 7 }))
  group.add(build.mesh(build.panel(width, 22, 30), build.surface('drain'), { x: baseMiddle.u, y: 0.8, z: lane.n0 + 14 }, { x: -Math.PI / 2 }))
  group.add(build.mesh(build.box(width, 70, 18), build.surface('paint-cream'), { x: baseMiddle.u, y: 35, z: farSide.n1 - 20 }))
  group.add(build.mesh(build.box(width + 4, 6, 24), build.surface('curb'), { x: baseMiddle.u, y: 73, z: farSide.n1 - 20 }))
  // Yard walls at the back.
  group.add(build.mesh(build.box(width, 180, 16), build.surface('paint-cream'), { x: baseMiddle.u, y: 90, z: yard.n0 + 8 }))
  return group
}

/** A Phnom Penh shophouse: pastel plaster, a folding gate under an awning, shuttered windows above. */
function shophouse(build: Builder, block: Neighbour): Group {
  const group = new Group()
  const width = block.u1 - block.u0
  const depth = block.n1 - block.n0
  const height = block.floors * block.floorHeight
  const u = (block.u0 + block.u1) / 2
  const n = (block.n0 + block.n1) / 2
  const front = block.n1
  const paint = build.surface(PAINTS[block.paint % PAINTS.length]!)
  const trim = build.surface('curb')
  const shutter = build.surface(SHUTTERS[block.shutters % SHUTTERS.length]!)
  // The body, with a hairline of shade between neighbours.
  group.add(build.mesh(build.box(width - 4, height, depth), paint, { x: u, y: height / 2, z: n }))
  for (let floor = 1; floor <= block.floors; floor++) {
    group.add(build.mesh(build.box(width, 10, 8), trim, { x: u, y: floor * block.floorHeight - 5, z: front + 3 }))
  }
  // Ground floor: a folding gate, half open on a lit shop, a sign, a lamp and an awning.
  const gate = width - 70
  group.add(build.mesh(build.panel(gate, 250, 40), build.surface('gate'), { x: u - gate * 0.18, y: 125, z: front + 0.8 }))
  group.add(build.mesh(build.panel(gate * 0.36, 230, 100), build.surface('window-lit'), { x: u + gate * 0.32, y: 115, z: front + 0.6 }))
  group.add(build.mesh(build.box(width * 0.62, 38, 6), shutter, { x: u, y: 296, z: front + 3 }))
  group.add(build.mesh(build.box(10, 14, 8), build.surface('lamp'), { x: u - gate / 2 - 18, y: 230, z: front + 4 }))
  // Sloping down to the street: its back edge against the façade, its ridges running down the slope.
  group.add(build.mesh(build.panel(width - 10, 125, 30), build.surface(AWNINGS[block.awning % AWNINGS.length]!), { x: u, y: 262, z: front + 56 }, { x: -Math.PI / 2 + 0.36 }))
  // Upper floors: two or three windows with shutters folded back; a balcony with a grille on the first.
  const windows = width >= 450 ? 3 : 2
  for (let floor = 1; floor < block.floors; floor++) {
    const y = floor * block.floorHeight + 150
    for (let index = 0; index < windows; index++) {
      const x = block.u0 + (width * (index + 0.5)) / windows
      group.add(build.mesh(build.box(84, 150, 6), trim, { x, y, z: front + 1 }))
      group.add(build.mesh(build.panel(70, 136, 100), build.surface('window-lit'), { x, y, z: front + 4.2 }))
      for (const side of [1, -1]) group.add(build.mesh(build.panel(36, 136, 20), shutter, { x: x + side * 62, y, z: front + 1.2 }))
    }
    // The back: smaller windows over the yard, so the orbit behind the café isn't blank walls.
    const back = block.n0
    for (let index = 0; index < windows - 1; index++) {
      const x = block.u0 + (width * (index + 1)) / windows
      group.add(build.mesh(build.box(70, 110, 6), trim, { x, y: y - 10, z: back - 1 }))
      group.add(build.mesh(build.panel(56, 96, 100), build.surface('window-lit'), { x, y: y - 10, z: back - 4.2 }, { y: Math.PI }))
    }
    if (floor === 1 && block.balcony) {
      const base = floor * block.floorHeight
      group.add(build.mesh(build.box(width - 40, 10, 72), trim, { x: u, y: base + 5, z: front + 36 }))
      group.add(build.mesh(build.box(width - 40, 4, 4), build.surface('frame'), { x: u, y: base + 100, z: front + 70 }))
      for (let x = block.u0 + 24; x <= block.u1 - 24; x += 12) group.add(build.mesh(build.box(2, 90, 2), build.surface('frame'), { x, y: base + 55, z: front + 70 }))
      group.add(build.mesh(build.box(64, 46, 26), build.surface('concrete'), { x: block.u1 - 70, y: base + 160, z: front + 13 }))
    }
  }
  // The roof: clay tiles on a gable along the street, or a flat roof behind a parapet.
  if (block.roof === 'gable') {
    // Each slope runs from its eave (25 cm past the wall) up to the ridge over the middle; the wall
    // tops meet it exactly, so the gable ends close the triangle.
    const pitch = 0.42
    const overhang = 25
    const run = depth / 2 + overhang
    const slope = run / Math.cos(pitch)
    const eave = height - Math.tan(pitch) * overhang
    const ridge = height + Math.tan(pitch) * (depth / 2)
    for (const side of [1, -1]) {
      // Turned about x so the panel's up (+y) climbs from the eave to the ridge.
      const tilt = side > 0 ? pitch - Math.PI / 2 : Math.PI / 2 - pitch
      group.add(build.mesh(build.panel(width + 20, slope, 40), build.surface('roof-tile'), { x: u, y: (eave + ridge) / 2, z: n + (side * run) / 2 }, { x: tilt }))
    }
    const gable = build.geometry(`lane-gable:${depth}`, () => {
      const shape = new Shape([new Vector2(cm(-depth / 2), 0), new Vector2(cm(depth / 2), 0), new Vector2(0, cm(Math.tan(pitch) * (depth / 2)))])
      return new ShapeGeometry(shape)
    })
    for (const side of [1, -1]) group.add(build.mesh(gable, paint, { x: block.u0 + 2 + (side > 0 ? width - 4 : 0), y: height, z: n }, { y: side * Math.PI / 2 }))
  }
  else {
    for (const [x, z, w, d] of [[u, front - 6, width, 12], [u, block.n0 + 6, width, 12], [block.u0 + 6, n, 12, depth], [block.u1 - 6, n, 12, depth]] as const) {
      group.add(build.mesh(build.box(w, 50, d), paint, { x, y: height + 25, z }))
    }
    group.add(build.mesh(build.box(80, 120, 80), build.surface('concrete'), { x: u + width / 5, y: height + 60, z: n - depth / 5 }))
  }
  return group
}

/** The lane's small things. */
function props(build: Builder, plan: SurroundingsPlan): Group {
  const group = new Group()
  const poles: Prop[] = []
  for (const prop of plan.props) {
    const piece = new Group()
    piece.position.set(cm(prop.u), 0, cm(prop.n))
    piece.rotation.y = yRotation(prop.turn)
    switch (prop.kind) {
      case 'moto':
        moto(build, piece)
        break
      case 'street-lamp':
        streetLamp(build, piece)
        break
      case 'pole':
        poles.push(prop)
        piece.add(build.mesh(build.cylinder(9, 12, 680), build.surface('concrete'), { x: 0, y: 340, z: 0 }))
        piece.add(build.mesh(build.box(120, 8, 8), build.surface('concrete'), { x: 0, y: 640, z: 0 }))
        break
      case 'tree':
        tree(build, piece, prop.u + prop.n)
        break
      case 'water-jar': {
        const profile = [[0, 0], [22, 0], [32, 22], [30, 48], [20, 60], [21, 64], [0, 64]].map(([x, y]) => new Vector2(cm(x!), cm(y!)))
        piece.add(build.mesh(build.geometry('lane-jar', () => new LatheGeometry(profile, 18)), build.surface('jar'), { x: 0, y: 0, z: 0 }))
        break
      }
      case 'pot':
        piece.add(buildItem(build.context, { kind: 'plant', width: 50, depth: 50, finishes: {} }))
        break
      case 'bougainvillea':
        piece.add(build.mesh(build.cylinder(14, 16, 34), build.surface('jar'), { x: 0, y: 17, z: 0 }))
        for (let index = 0; index < 7; index++) {
          const angle = index * 0.9
          piece.add(build.mesh(build.blob(index % 3 ? 18 : 24), build.surface(index % 2 ? 'bougainvillea' : 'leaf'), { x: Math.cos(angle) * 22, y: 60 + index * 16, z: Math.sin(angle) * 10 - 8 }))
        }
        break
      case 'crates':
        for (const [x, y, z] of [[0, 15, 0], [42, 15, 4], [20, 45, 2]] as const) piece.add(build.mesh(build.box(40, 30, 30), build.context.materials.finish('pale-oak'), { x, y, z }))
        break
      case 'bowl':
        break
    }
    group.add(piece)
  }
  // The cat's bowl.
  group.add(build.mesh(build.cylinder(9, 7, 5, 16), build.surface('ceramic'), { x: plan.cat.u, y: 2.5, z: plan.cat.n }))
  // Power lines between the poles, sagging: the lane's own tangle.
  if (poles.length >= 2) {
    const [a, b] = poles as [Prop, Prop]
    for (const [height, offset] of [[630, -40], [615, 0], [600, 40], [585, 20]] as const) {
      const sag = 70 + Math.abs(offset)
      const curve = new CatmullRomCurve3([
        new Vector3(cm(a.u), cm(height), cm(a.n + offset / 4)),
        new Vector3(cm((a.u + b.u) / 2), cm(height - sag), cm((a.n + b.n) / 2 + offset / 3)),
        new Vector3(cm(b.u), cm(height), cm(b.n + offset / 4)),
      ])
      group.add(new Mesh(build.geometry(`lane-wire:${a.u}:${b.u}:${height}:${offset}`, () => new TubeGeometry(curve, 24, cm(1.1), 4)), build.surface('wire')))
    }
  }
  return group
}

/** A parked scooter, the lane's everyday moto: red body, chrome, on its stand. */
function moto(build: Builder, piece: Group) {
  const rubber = build.surface('rubber')
  const body = build.surface('moto-red')
  const chrome = build.surface('chrome')
  const wheel = build.geometry('lane-wheel', () => new TorusGeometry(cm(25), cm(5.5), 8, 20))
  for (const x of [-62, 62]) piece.add(build.mesh(wheel, rubber, { x, y: 30, z: 0 }))
  piece.add(build.mesh(build.box(70, 16, 22), body, { x: 0, y: 48, z: 0 }))
  piece.add(build.mesh(build.box(56, 10, 26), rubber, { x: -12, y: 61, z: 0 }))
  piece.add(build.mesh(build.box(30, 40, 24), body, { x: 46, y: 64, z: 0 }, { z: -0.35 }))
  piece.add(build.mesh(build.box(34, 26, 22), body, { x: -52, y: 46, z: 0 }))
  piece.add(build.mesh(build.cylinder(1.8, 1.8, 70), chrome, { x: 58, y: 92, z: 0 }, { x: Math.PI / 2 }))
  piece.add(build.mesh(build.blob(6), build.surface('lamp'), { x: 66, y: 86, z: 0 }))
  piece.rotation.z = 0.05
}

function streetLamp(build: Builder, piece: Group) {
  const metal = build.surface('frame')
  piece.add(build.mesh(build.cylinder(5, 7, 420), metal, { x: 0, y: 210, z: 0 }))
  piece.add(build.mesh(build.box(70, 5, 5), metal, { x: 0, y: 415, z: 32 }, { y: Math.PI / 2 }))
  piece.add(build.mesh(build.box(26, 10, 18), build.surface('lamp'), { x: 0, y: 408, z: 62 }))
}

function tree(build: Builder, piece: Group, salt: number) {
  piece.add(build.mesh(build.cylinder(9, 13, 260), build.surface('trunk'), { x: 0, y: 130, z: 0 }))
  const clusters: [number, number, number, number][] = [[0, 300, 0, 90], [55, 260, 20, 62], [-50, 270, -25, 66], [10, 250, -55, 58], [-20, 340, 30, 60]]
  clusters.forEach(([x, y, z, radius], index) => {
    piece.add(build.mesh(build.blob(radius), build.surface((index + Math.round(salt)) % 2 ? 'leaf' : 'leaf-dark'), { x, y, z }, { x: index * 0.7, y: index * 1.3 }))
  })
}
