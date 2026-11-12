import { BoxGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, SphereGeometry } from 'three'
import type { BufferGeometry, Material } from 'three'
import type { BuildContext } from '~/features/branches'
import { MOTO } from './moto'

/** A small step-through moto in the same low-poly style as the lane and tuk-tuk. */
export function createMotoModel({ geometries, materials }: BuildContext) {
  const root = new Group()
  root.name = 'explore-moto'
  const body = new Group()
  root.add(body)
  const box = new BoxGeometry(1, 1, 1)
  const tyre = new CylinderGeometry(MOTO.wheelRadius, MOTO.wheelRadius, 0.12, 16).rotateZ(Math.PI / 2)
  const hub = new CylinderGeometry(0.15, 0.15, 0.13, 12).rotateZ(Math.PI / 2)
  const lamp = new SphereGeometry(1, 10, 8)
  const shade = new PlaneGeometry(0.85, 2.05).rotateX(-Math.PI / 2)
  for (const [index, geometry] of [box, tyre, hub, lamp, shade].entries()) geometries.set('explore-moto:' + index, geometry)

  const paint = materials.finish('olive')
  const rubber = materials.surface('shoe')
  const metal = materials.surface('frame')
  const cream = materials.finish('linen')

  function part(parent: Group, geometry: BufferGeometry, material: Material, x: number, y: number, z: number, width = 1, height = 1, depth = 1) {
    const mesh = new Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.scale.set(width, height, depth)
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  const wheels = [-MOTO.axle, MOTO.axle].map((z) => {
    const fork = new Group()
    fork.position.set(0, MOTO.wheelRadius, z)
    body.add(fork)
    const wheel = new Group()
    fork.add(wheel)
    part(wheel, tyre, rubber, 0, 0, 0)
    part(wheel, hub, metal, 0, 0, 0)
    part(wheel, box, cream, 0, 0, 0, 0.14, 0.025, 0.25)
    return { fork, wheel }
  })

  part(body, box, paint, 0, 0.43, -0.35, 0.39, 0.36, 0.81)
  part(body, box, rubber, 0, MOTO.seat - 0.06, -0.23, 0.36, 0.12, 0.68)
  part(body, box, metal, 0, 0.32, 0.1, 0.42, 0.09, 0.45)
  const shield = part(body, box, paint, 0, 0.61, 0.49, 0.36, 0.54, 0.2)
  shield.rotation.x = -0.18
  const handle = new Group()
  handle.position.set(0, 1.02, 0.42)
  body.add(handle)
  part(handle, box, metal, 0, 0, 0, 0.66, 0.05, 0.06)
  part(handle, lamp, cream, 0, -0.09, 0.11, 0.14, 0.09, 0.08)
  for (const side of [-1, 1]) {
    part(handle, box, rubber, side * 0.28, 0, 0, 0.17, 0.075, 0.08)
    part(handle, box, metal, side * 0.26, 0.12, 0.035, 0.027, 0.22, 0.027).rotation.z = side * -0.22
    part(handle, lamp, cream, side * 0.31, 0.23, 0.035, 0.082, 0.043, 0.022)
  }
  const shadow = part(root, shade, materials.surface('contact-shadow'), 0, 0.013, 0)
  shadow.renderOrder = 1

  return {
    root,
    update(steer: number, speed: number, wheelTurn: number, reducedMotion: boolean) {
      body.rotation.z = reducedMotion ? 0 : -steer * Math.min(Math.abs(speed) / 7, 1) * 0.21
      wheels[1]!.fork.rotation.y = handle.rotation.y = steer * 0.42
      for (const { wheel } of wheels) wheel.rotation.x = wheelTurn
      return body.rotation.z
    },
  }
}
