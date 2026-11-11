import { Box3, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, QuadraticBezierCurve3, SphereGeometry, TubeGeometry, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import type { FigureKind, Finish } from '#shared/contracts/shop-layout'
import { ITEM_SPECS } from '../catalog'
import type { BuildContext } from './furniture'
import type { FigureSurface } from './materials'
import { cm } from './units'

/**
 * People and pets generated from code (step 3g, D274), in the warm low-poly style of the furniture:
 * a few rounded shapes each, no textures but the krama's check. A figure faces the plan's front
 * (+z), stands on y = 0 and fits its footprint (`FIGURE_SIZES`). Its colors come from its id, so
 * every viewer sees the same customer. A CC0 model file for the kind (`FIGURE_MODELS`) replaces
 * this one once loaded; this one stays the fallback.
 *
 * `idle` moves it a little (breathing, a head turn, a tail, a swaying hammock); the viewer calls it
 * only while Animate plays.
 */

export interface GeneratedFigure {
  body: Group
  idle: (seconds: number) => void
}

interface At {
  x: number
  y: number
  z: number
}

const SKINS: FigureSurface[] = ['skin-medium', 'skin-deep', 'skin-light', 'skin-medium']
const TOPS: (Finish | 'shirt-white')[] = ['shirt-white', 'navy', 'olive', 'terracotta', 'linen', 'shirt-white']
const BOTTOMS: Finish[] = ['navy', 'chocolate', 'olive', 'navy']
const FURS: FigureSurface[] = ['fur-ginger', 'fur-cream', 'fur-dark', 'fur-tan']

export function buildFigure(context: BuildContext, kind: FigureKind, seed: string): GeneratedFigure {
  const pick = picker(seed)
  const phase = pick(1000) / 159
  switch (kind) {
    case 'cat': return cat(context, pick, phase)
    case 'dog': return dog(context, pick, phase)
    case 'lazing-person': return hammock(context, pick, phase)
    default: return person(context, kind, pick, phase)
  }
}

type Pick = (count: number) => number

/** A small deterministic choice from the figure's id (FNV-1a). */
function picker(seed: string): Pick {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (count: number) => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0
    return hash % count
  }
}

function cached(context: BuildContext, key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = context.geometries.get(key)
  if (!geometry) {
    geometry = make()
    context.geometries.set(key, geometry)
  }
  return geometry
}

/** A mesh placed in centimetres. Figures cast no shadow (their contact shadow stands in). */
function part(geometry: BufferGeometry, material: Material, at: At): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.position.set(cm(at.x), cm(at.y), cm(at.z))
  mesh.receiveShadow = true
  return mesh
}

const sphere = (context: BuildContext, radius: number) => cached(context, `fig-sphere:${radius}`, () => new SphereGeometry(cm(radius), 18, 12))
const capsule = (context: BuildContext, radius: number, length: number) => cached(context, `fig-capsule:${radius}:${length}`, () => new CapsuleGeometry(cm(radius), cm(length), 4, 12))
const cylinder = (context: BuildContext, top: number, bottom: number, height: number) => cached(context, `fig-cyl:${top}:${bottom}:${height}`, () => new CylinderGeometry(cm(top), cm(bottom), cm(height), 18))
const cone = (context: BuildContext, radius: number, height: number) => cached(context, `fig-cone:${radius}:${height}`, () => new ConeGeometry(cm(radius), cm(height), 10))

function at(object: Object3D, position: At): Object3D {
  object.position.set(cm(position.x), cm(position.y), cm(position.z))
  return object
}

/** Centres the body on its footprint and stands it on y = 0; people are also scaled to their height. */
function settle(body: Group, kind: FigureKind, scaleToHeight: boolean): Group {
  const root = new Group()
  root.add(body)
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(body)
  const size = bounds.getSize(new Vector3())
  const scale = scaleToHeight && size.y > 0 ? cm(ITEM_SPECS[kind].height) / size.y : 1
  const center = bounds.getCenter(new Vector3())
  body.scale.multiplyScalar(scale)
  body.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
  return root
}

interface PersonStyle {
  skin: Material
  hair: Material
  top: Material
  bottom: Material
  /** A sampot (wrap skirt) instead of trousers. */
  skirt: boolean
  krama: boolean
  /** Children's heads are bigger for their height. */
  headScale: number
  apron?: Material
  ponytail?: boolean
  cane?: boolean
  /** Leaning forward, in radians. */
  stoop?: number
  seated?: boolean
}

function personStyle(context: BuildContext, kind: FigureKind, pick: Pick): PersonStyle {
  const { finish, surface } = context.materials
  const cloth = (key: Finish | 'shirt-white') => (key === 'shirt-white' ? surface('shirt-white') : finish(key))
  const base: PersonStyle = {
    skin: surface(SKINS[pick(SKINS.length)]!),
    hair: surface('hair-black'),
    top: cloth(TOPS[pick(TOPS.length)]!),
    bottom: finish(BOTTOMS[pick(BOTTOMS.length)]!),
    skirt: pick(2) === 0,
    krama: pick(3) === 0,
    headScale: 1,
  }
  switch (kind) {
    case 'girl': return { ...base, top: finish('terracotta'), bottom: finish('terracotta'), skirt: true, krama: false, headScale: 1.3, ponytail: true }
    case 'boy': return { ...base, top: cloth(pick(2) ? 'shirt-white' : 'navy'), bottom: finish('navy'), skirt: false, krama: false, headScale: 1.3 }
    case 'old-man': return { ...base, hair: surface('hair-grey'), top: surface('shirt-white'), bottom: finish('chocolate'), skirt: false, krama: true, cane: true, stoop: 0.14 }
    case 'barista': return { ...base, top: surface('shirt-white'), bottom: finish('navy'), skirt: false, krama: false, apron: finish('olive') }
    case 'seated-person': return { ...base, seated: true }
    default: return base
  }
}

/** A standing (or seated) person: a waist group that breathes, a head that looks around. */
function person(context: BuildContext, kind: FigureKind, pick: Pick, phase: number): GeneratedFigure {
  const style = personStyle(context, kind, pick)
  const body = new Group()
  const shoe = context.materials.surface('shoe')
  const waistY = style.seated ? 56 : 94

  if (style.seated) {
    // Hips on a 45 cm seat, thighs forward, shins down to the floor.
    body.add(part(cylinder(context, 16, 16, 12), style.bottom, { x: 0, y: 51, z: 0 }))
    for (const side of [1, -1]) {
      const thigh = part(capsule(context, 8, 30), style.bottom, { x: side * 9.2, y: 51, z: 17 })
      thigh.rotation.x = Math.PI / 2
      body.add(thigh, part(capsule(context, 5.5, 34), style.skirt ? style.skin : style.bottom, { x: side * 9, y: 27, z: 36 }))
      body.add(part(cached(context, 'fig-shoe', () => new CylinderGeometry(cm(4.5), cm(5), cm(5), 12).scale(1, 1, 2)), shoe, { x: side * 9, y: 2.5, z: 40 }))
    }
  }
  else {
    for (const side of [1, -1]) {
      body.add(part(cached(context, 'fig-shoe', () => new CylinderGeometry(cm(4.5), cm(5), cm(5), 12).scale(1, 1, 2)), shoe, { x: side * 8.5, y: 2.5, z: 3 }))
      if (style.skirt) body.add(part(capsule(context, 4.5, 6), style.skin, { x: side * 8, y: 9, z: 0 }))
      else body.add(part(capsule(context, 7.8, 68), style.bottom, { x: side * 9.2, y: 47, z: 0 }))
    }
    if (style.skirt) {
      const sampot = part(cylinder(context, 15.5, 18, 78), style.bottom, { x: 0, y: 52, z: 0 })
      sampot.scale.z = 0.72
      body.add(sampot)
    }
    const hips = part(cylinder(context, 17.5, 17, 10), style.bottom, { x: 0, y: 91, z: 0 })
    hips.scale.z = 0.7
    body.add(hips)
  }

  // Above the waist: torso, arms, neck and head. Breathing scales this group a little.
  const upper = at(new Group(), { x: 0, y: waistY, z: 0 }) as Group
  upper.rotation.x = style.stoop ?? (style.seated ? -0.04 : 0)
  body.add(upper)
  const torso = part(cylinder(context, 19.5, 17, 46), style.top, { x: 0, y: 23, z: 0 })
  torso.scale.z = 0.68
  upper.add(torso)
  if (style.apron) {
    const apron = part(cached(context, 'fig-apron', () => new PlaneGeometry(cm(28), cm(66))), style.apron, { x: 0, y: 8, z: 11.4 })
    apron.rotation.x = -0.05
    upper.add(apron)
  }
  for (const side of [1, -1]) {
    upper.add(part(sphere(context, 6.5), style.top, { x: side * 16.5, y: 42, z: 0 }))
    const arm = at(new Group(), { x: side * 19.5, y: 42, z: 0 }) as Group
    arm.rotation.z = side * 0.03
    // The barista holds a cup; the old man leans on his cane; a seated person rests on the table.
    if (style.seated) arm.rotation.x = -0.75
    else if (style.apron && side > 0) arm.rotation.x = -0.6
    else if (style.cane && side > 0) arm.rotation.x = -0.35
    arm.add(part(capsule(context, 6.2, 14), style.top, { x: 0, y: -9, z: 0 }))
    arm.add(part(capsule(context, 5, 24), style.skin, { x: 0, y: -31, z: 0 }))
    arm.add(part(sphere(context, 5.2), style.skin, { x: 0, y: -46, z: 0 }))
    if (style.apron && side > 0) {
      arm.add(part(cylinder(context, 4, 3.3, 9), context.materials.surface('ceramic'), { x: 0, y: -48, z: 5 }))
    }
    upper.add(arm)
  }
  upper.add(part(cylinder(context, 5, 5.5, 9), style.skin, { x: 0, y: 49, z: 0 }))
  if (style.krama) {
    const scarf = part(cached(context, 'fig-krama', () => new CylinderGeometry(cm(8), cm(9.5), cm(6), 16, 1, true)), context.materials.surface('krama'), { x: 0, y: 47, z: 0 })
    scarf.scale.z = 0.8
    upper.add(scarf, part(cached(context, 'fig-krama-tail', () => new CapsuleGeometry(cm(2.6), cm(14), 2, 6).scale(1.4, 1, 0.5)), context.materials.surface('krama'), { x: -6, y: 37, z: 9.5 }))
  }

  const head = at(new Group(), { x: 0, y: 53, z: 0 }) as Group
  head.scale.setScalar(style.headScale)
  upper.add(head)
  const skull = part(sphere(context, 11), style.skin, { x: 0, y: 11.5, z: 0 })
  skull.scale.y = 1.08
  const hair = part(cached(context, 'fig-hair', () => new SphereGeometry(cm(11.8), 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)), style.hair, { x: 0, y: 12.5, z: -0.6 })
  hair.rotation.x = -0.42
  head.add(skull, hair)
  for (const side of [1, -1]) head.add(part(sphere(context, 1.3), context.materials.surface('eye'), { x: side * 3.8, y: 12.5, z: 10.2 }))
  if (style.ponytail) head.add(part(sphere(context, 5.5), style.hair, { x: 0, y: 12, z: -12 }))
  if (style.cane) {
    const wood = context.materials.finish('dark-wood')
    body.add(part(cylinder(context, 1.2, 1.2, 84), wood, { x: 26, y: 42, z: 18 }))
    const crook = part(cached(context, 'fig-crook', () => new TubeGeometry(new QuadraticBezierCurve3(new Vector3(0, 0, 0), new Vector3(0, cm(7), cm(-1)), new Vector3(0, cm(4), cm(-7))), 8, cm(1.2), 6)), wood, { x: 26, y: 84, z: 18 })
    body.add(crook)
  }

  const root = settle(body, kind, true)
  return {
    body: root,
    idle(seconds) {
      const t = seconds + phase
      upper.scale.y = 1 + Math.sin(t * 1.7) * 0.008
      head.rotation.y = Math.sin(t * 0.37) * 0.28
      head.rotation.x = Math.sin(t * 0.23) * 0.05
    },
  }
}

/** A cat sitting up, its tail curled beside it, swaying now and then. */
function cat(context: BuildContext, pick: Pick, phase: number): GeneratedFigure {
  const fur = context.materials.surface(FURS[pick(FURS.length)]!)
  const eye = context.materials.surface('eye')
  const body = new Group()
  const haunch = part(sphere(context, 9.5), fur, { x: 0, y: 9.5, z: -4 })
  haunch.scale.set(0.95, 1.1, 1.15)
  const chest = part(sphere(context, 6.5), fur, { x: 0, y: 17, z: 2.5 })
  chest.scale.set(0.9, 1.3, 0.9)
  body.add(haunch, chest)
  for (const side of [1, -1]) {
    body.add(part(capsule(context, 1.9, 9), fur, { x: side * 3.3, y: 6.5, z: 5.5 }))
    body.add(part(sphere(context, 2.3), fur, { x: side * 3.3, y: 1.8, z: 7 }))
  }
  const head = at(new Group(), { x: 0, y: 25, z: 5 }) as Group
  const skull = part(sphere(context, 6.3), fur, { x: 0, y: 0, z: 0 })
  skull.scale.set(1.08, 0.95, 1)
  head.add(skull)
  for (const side of [1, -1]) {
    const ear = part(cone(context, 2.2, 4.5), fur, { x: side * 3.4, y: 5.4, z: -0.5 })
    ear.rotation.z = -side * 0.3
    head.add(ear, part(sphere(context, 0.9), eye, { x: side * 2.3, y: 1, z: 5.6 }))
  }
  body.add(head)
  const tail = at(new Group(), { x: 2, y: 2, z: -12 }) as Group
  tail.add(new Mesh(cached(context, 'fig-cat-tail', () => new TubeGeometry(new QuadraticBezierCurve3(new Vector3(0, 0, 0), new Vector3(cm(9), 0, cm(-3)), new Vector3(cm(8), cm(1), cm(10))), 12, cm(1.6), 6)), fur))
  body.add(tail)
  const root = settle(body, 'cat', false)
  return {
    body: root,
    idle(seconds) {
      const t = seconds + phase
      tail.rotation.y = Math.sin(t * 1.3) * 0.25
      head.rotation.y = Math.sin(t * 0.31) * 0.45
      chest.scale.y = 1.3 + Math.sin(t * 2.4) * 0.02
    },
  }
}

/** A dog standing, ears down, tail wagging. */
function dog(context: BuildContext, pick: Pick, phase: number): GeneratedFigure {
  const fur = context.materials.surface(FURS[(pick(FURS.length) + 1) % FURS.length]!)
  const dark = context.materials.surface('fur-dark')
  const eye = context.materials.surface('eye')
  const body = new Group()
  const trunk = part(capsule(context, 11.5, 26), fur, { x: 0, y: 32, z: -2 })
  trunk.rotation.x = Math.PI / 2
  body.add(trunk)
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    body.add(part(capsule(context, 4.2, 18), fur, { x: sx * 6.3, y: 13, z: sz * 13 - 2 }))
    body.add(part(sphere(context, 4.3), fur, { x: sx * 6.3, y: 3, z: sz * 13 - 1 }))
  }
  const neck = part(capsule(context, 6, 9), fur, { x: 0, y: 44, z: 17 })
  neck.rotation.x = 0.7
  body.add(neck)
  const head = at(new Group(), { x: 0, y: 50, z: 22 }) as Group
  const skull = part(sphere(context, 7.8), fur, { x: 0, y: 0, z: 0 })
  skull.scale.set(0.92, 0.95, 1.05)
  const snout = part(capsule(context, 3.6, 5), fur, { x: 0, y: -2.2, z: 8 })
  snout.rotation.x = Math.PI / 2
  head.add(skull, snout, part(sphere(context, 1.6), eye, { x: 0, y: -1, z: 12.3 }))
  for (const side of [1, -1]) {
    const ear = part(capsule(context, 2.4, 6), dark, { x: side * 6.6, y: 0.5, z: -1 })
    ear.rotation.z = side * 0.35
    head.add(ear, part(sphere(context, 1.1), eye, { x: side * 2.9, y: 2.4, z: 6.8 }))
  }
  body.add(head)
  const tail = at(new Group(), { x: 0, y: 40, z: -24 }) as Group
  const tailPart = part(capsule(context, 1.8, 12), fur, { x: 0, y: 6, z: -2 })
  tailPart.rotation.x = -0.5
  tail.add(tailPart)
  body.add(tail)
  const root = settle(body, 'dog', false)
  return {
    body: root,
    idle(seconds) {
      const t = seconds + phase
      tail.rotation.z = Math.sin(t * 9) * 0.45
      head.rotation.y = Math.sin(t * 0.29) * 0.3
      trunk.scale.x = 1 + Math.sin(t * 3.1) * 0.015
    },
  }
}

/** Someone lazing in a hammock on its steel stand, the hammock swaying gently. */
function hammock(context: BuildContext, pick: Pick, phase: number): GeneratedFigure {
  const style = personStyle(context, 'person', pick)
  const metal = context.materials.surface('frame')
  const body = new Group()
  // The stand: a long base bar with feet, and two posts leaning in to the hanging points.
  body.add(part(cached(context, 'fig-stand-bar', () => new CylinderGeometry(cm(2.5), cm(2.5), cm(232), 10).rotateZ(Math.PI / 2)), metal, { x: 0, y: 3, z: 0 }))
  for (const side of [1, -1]) {
    body.add(part(cached(context, 'fig-stand-foot', () => new CylinderGeometry(cm(2.2), cm(2.2), cm(84), 10).rotateX(Math.PI / 2)), metal, { x: side * 114, y: 2.5, z: 0 }))
    const post = part(cylinder(context, 2.2, 2.2, 112), metal, { x: side * 108, y: 57, z: 0 })
    post.rotation.z = side * 0.12
    body.add(post)
  }
  // What swings: the cloth and the person in it, hung from the line between the posts' tops.
  const swing = at(new Group(), { x: 0, y: 108, z: 0 }) as Group
  body.add(swing)
  const cloth = new Mesh(cached(context, 'fig-hammock', () => {
    const geometry = new PlaneGeometry(cm(196), cm(76), 24, 6).rotateX(-Math.PI / 2)
    const positions = geometry.attributes.position!
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index) / cm(98)
      const z = positions.getZ(index) / cm(38)
      positions.setY(index, cm(-72 * (1 - x * x) + 6 * z * z - 6))
    }
    geometry.computeVertexNormals()
    return geometry
  }), context.materials.surface('krama'))
  cloth.receiveShadow = true
  swing.add(cloth)
  // The person lies along the cloth, head up on the left, one arm over the side.
  const lying = at(new Group(), { x: 0, y: -108, z: 0 }) as Group
  swing.add(lying)
  const torso = part(cylinder(context, 15, 17, 48), style.top, { x: -26, y: 54, z: 0 })
  torso.rotation.z = Math.PI / 2 + 0.32
  torso.scale.z = 0.62
  lying.add(torso)
  for (const side of [1, -1]) {
    const leg = part(capsule(context, 6.3, 62), style.bottom, { x: 34, y: 54, z: side * 8 })
    leg.rotation.z = Math.PI / 2 - 0.42
    lying.add(leg, part(sphere(context, 5), context.materials.surface('shoe'), { x: 70, y: 70, z: side * 8 }))
  }
  const skull = part(sphere(context, 11), style.skin, { x: -62, y: 75, z: 0 })
  const hair = part(cached(context, 'fig-hair', () => new SphereGeometry(cm(11.8), 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)), style.hair, { x: -64, y: 76, z: 0 })
  hair.rotation.z = 1.1
  lying.add(skull, hair)
  const hanging = part(capsule(context, 4.5, 40), style.skin, { x: -30, y: 46, z: 26 })
  hanging.rotation.x = 0.9
  const resting = part(capsule(context, 4.5, 36), style.skin, { x: -24, y: 66, z: -6 })
  resting.rotation.z = Math.PI / 2
  lying.add(hanging, resting)
  const root = settle(body, 'lazing-person', false)
  return {
    body: root,
    idle(seconds) {
      swing.rotation.x = Math.sin((seconds + phase) * 1.1) * 0.07
    },
  }
}
