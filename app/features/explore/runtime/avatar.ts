import { CapsuleGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, SphereGeometry } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import type { BuildContext } from '~/features/branches'

/**
 * The player's character (D275, docs/plans/explore.md → The avatar): generated from code in the
 * designer's figure style (warm low-poly, a krama on the shoulders), with pivoted limbs animated
 * procedurally. The gait follows the distance travelled, so feet don't slide at any speed; sitting
 * is a pose blend. A rigged model with clips can replace it behind the same `AvatarRig`.
 */

export interface AvatarRig {
  /** Placed by the world at the feet, turned to the heading. */
  root: Object3D
  /** A soft shadow the world keeps on the ground under the feet. */
  shadow: Object3D
  /** Speed (m/s) and whether the feet are on the ground, once per frame. */
  locomotion: (speed: number, grounded: boolean, dt: number) => void
  /** 0 standing, 1 seated on a seat this high (metres above the floor). */
  sit: (amount: number, seatHeight: number) => void
  rideMoto: (amount: number, seatHeight: number) => void
}

interface Limb {
  upper: Group
  lower: Group
}

const HIP = 0.92
const THIGH = 0.43
const ARM = 0.22

export function createAvatar(context: BuildContext): AvatarRig {
  const { surface, finish } = context.materials
  const skin = surface('skin-medium')
  const shirt = finish('linen')
  const trousers = finish('olive')
  const shoe = surface('shoe')
  const hair = surface('hair-black')

  const root = new Group()
  root.name = 'avatar'
  const body = new Group()
  root.add(body)

  const legs = ([1, -1] as const).map((side) => {
    const upper = new Group()
    upper.position.set(side * 0.09, HIP, 0)
    upper.add(part(capsule(context, 0.075, 0.3), trousers, 0, -0.21, 0))
    const lower = new Group()
    lower.position.y = -THIGH
    lower.add(part(capsule(context, 0.06, 0.32), trousers, 0, -0.2, 0))
    lower.add(part(shoeGeometry(context), shoe, 0, -0.44, 0.035))
    upper.add(lower)
    body.add(upper)
    return { upper, lower }
  }) as [Limb, Limb]

  const hips = part(cylinder(context, 0.175, 0.17, 0.12), trousers, 0, HIP, 0)
  hips.scale.z = 0.7
  body.add(hips)

  const torso = new Group()
  torso.position.y = HIP
  body.add(torso)
  const chest = part(cylinder(context, 0.195, 0.17, 0.46), shirt, 0, 0.23, 0)
  chest.scale.z = 0.68
  torso.add(chest)
  const arms = ([1, -1] as const).map((side) => {
    torso.add(part(sphere(context, 0.065), shirt, side * 0.165, 0.42, 0))
    const upper = new Group()
    upper.position.set(side * 0.2, 0.42, 0)
    upper.rotation.z = side * 0.03
    upper.add(part(capsule(context, 0.062, 0.14), shirt, 0, -0.09, 0))
    const lower = new Group()
    lower.position.y = -ARM
    lower.add(part(capsule(context, 0.05, 0.2), skin, 0, -0.1, 0))
    lower.add(part(sphere(context, 0.052), skin, 0, -0.24, 0))
    upper.add(lower)
    torso.add(upper)
    return { upper, lower }
  }) as [Limb, Limb]
  torso.add(part(cylinder(context, 0.05, 0.055, 0.09), skin, 0, 0.49, 0))
  const scarf = part(cached(context, 'avatar-krama', () => new CylinderGeometry(0.08, 0.095, 0.06, 16, 1, true)), surface('krama'), 0, 0.47, 0)
  scarf.scale.z = 0.8
  torso.add(scarf, part(cached(context, 'avatar-krama-tail', () => new CapsuleGeometry(0.026, 0.14, 2, 6).scale(1.4, 1, 0.5)), surface('krama'), -0.06, 0.37, 0.095))
  const head = new Group()
  head.position.y = 0.53
  torso.add(head)
  const skull = part(sphere(context, 0.11), skin, 0, 0.115, 0)
  skull.scale.y = 1.08
  const cap = part(cached(context, 'avatar-hair', () => new SphereGeometry(0.118, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)), hair, 0, 0.125, -0.006)
  cap.rotation.x = -0.42
  head.add(skull, cap)
  for (const side of [1, -1]) head.add(part(sphere(context, 0.013), surface('eye'), side * 0.038, 0.125, 0.102))

  const shadow = new Mesh(cached(context, 'avatar-shadow', () => new PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2)), surface('contact-shadow'))
  shadow.renderOrder = 1

  let phase = 0
  let stride = 0
  let seated = 0
  let riding = false
  let seatHeight = 0.46
  let airborne = 0

  function pose(time: number) {
    const run = Math.min(1, Math.max(0, (stride - 1.6) / 2))
    const swing = Math.sin(phase)
    const walkAmount = Math.min(1, stride / 1.2) * (1 - seated)
    // Legs swing forward and back (a negative x rotation is forward), knees bend on the way through.
    legs.forEach((leg, index) => {
      const s = index === 0 ? swing : -swing
      const lift = Math.max(0, index === 0 ? -Math.sin(phase) : Math.sin(phase))
      const walkThigh = -s * (0.35 + 0.35 * run) * walkAmount
      const walkKnee = lift * (0.45 + 0.8 * run) * walkAmount
      const airThigh = -0.5 * airborne
      const airKnee = 0.9 * airborne
      leg.upper.rotation.x = mix(walkThigh + airThigh, riding ? -1.05 : -Math.PI / 2, seated)
      leg.lower.rotation.x = mix(walkKnee + airKnee, riding ? 1.85 : Math.PI / 2, seated)
      leg.upper.rotation.z = (index === 0 ? 1 : -1) * (riding ? 0.26 * seated : 0)
    })
    arms.forEach((arm, index) => {
      const s = index === 0 ? -swing : swing
      arm.upper.rotation.x = mix(-s * (0.3 + 0.35 * run) * walkAmount - 0.35 * airborne, riding ? -0.6 : -0.55, seated)
      arm.lower.rotation.x = mix(-(0.25 + 0.7 * run) * walkAmount - 0.1, riding ? -1.05 : -0.7, seated)
    })
    torso.rotation.x = (0.04 + 0.12 * run) * walkAmount + (riding ? 0.18 * seated : 0)
    const bob = Math.abs(Math.sin(phase)) * 0.035 * walkAmount
    // Seated: the hips rest on the seat.
    body.position.y = mix(bob, seatHeight + 0.05 - HIP, seated)
    // Breathing and a slow look around when still.
    torso.scale.y = 1 + Math.sin(time * 1.7) * 0.006 * (1 - walkAmount)
    head.rotation.y = Math.sin(time * 0.37) * 0.22 * (1 - walkAmount) * (1 - seated)
  }

  let time = 0
  return {
    root,
    shadow,
    locomotion(speed, grounded, dt) {
      time += dt
      // A longer stride the faster it goes: about 1.1 m a step walking, 1.9 m running.
      const stepLength = 1.1 + Math.max(0, speed - 1.6) * 0.2
      phase += (speed * dt * Math.PI) / stepLength
      stride += (speed - stride) * Math.min(1, dt * 10)
      airborne += ((grounded ? 0 : 1) - airborne) * Math.min(1, dt * 12)
      pose(time)
    },
    sit(amount, height) {
      riding = false
      seated = Math.max(0, Math.min(1, amount))
      seatHeight = height
      pose(time)
    },
    rideMoto(amount, height) {
      riding = true
      seated = amount
      seatHeight = height
      pose(time)
    },
  }
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

function cached(context: BuildContext, key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = context.geometries.get(key)
  if (!geometry) {
    geometry = make()
    context.geometries.set(key, geometry)
  }
  return geometry
}

function part(geometry: BufferGeometry, material: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.position.set(x, y, z)
  // The avatar casts no sun shadow (it would redraw the shadow map every frame): `shadow` stands in.
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}

const sphere = (context: BuildContext, radius: number) => cached(context, `avatar-sphere:${radius}`, () => new SphereGeometry(radius, 18, 12))
const capsule = (context: BuildContext, radius: number, length: number) => cached(context, `avatar-capsule:${radius}:${length}`, () => new CapsuleGeometry(radius, length, 4, 12))
const cylinder = (context: BuildContext, top: number, bottom: number, height: number) => cached(context, `avatar-cyl:${top}:${bottom}:${height}`, () => new CylinderGeometry(top, bottom, height, 18))
const shoeGeometry = (context: BuildContext) => cached(context, 'avatar-shoe', () => new CylinderGeometry(0.045, 0.05, 0.05, 12).scale(1, 1, 2))
