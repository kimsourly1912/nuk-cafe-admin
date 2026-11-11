import { BoxGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry } from 'three'
import type { BuildContext } from '~/features/branches'
import { createAvatar } from './avatar'

/** Generated demo rig in metres, with the passenger door on local +x and the front along +z. */
export function createTukTuk(context: BuildContext) {
  const root = new Group()
  root.name = 'tuk-tuk'
  const { surface } = context.materials
  const red = surface('moto-red')
  const cream = surface('paint-cream')
  const frame = surface('gate')
  const chrome = surface('chrome')
  const trim = surface('rubber')
  const seat = surface('shutter-brown')
  const glass = surface('glass')

  const cube = new BoxGeometry(1, 1, 1)
  const tyre = new CylinderGeometry(1, 1, 1, 16).rotateZ(Math.PI / 2)
  const shadowGeometry = new PlaneGeometry(2.2, 3.6).rotateX(-Math.PI / 2)
  context.geometries.set('tuk-tuk:box', cube)
  context.geometries.set('tuk-tuk:tyre', tyre)
  context.geometries.set('tuk-tuk:shadow', shadowGeometry)

  function box(parent: Group, material: ReturnType<typeof surface>, width: number, height: number, depth: number, x: number, y: number, z: number) {
    const mesh = new Mesh(cube, material)
    mesh.position.set(x, y, z)
    mesh.scale.set(width, height, depth)
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  box(root, red, 1.32, 0.37, 2.06, 0, 0.4, -0.38)
  box(root, cream, 1.34, 0.17, 2.03, 0, 0.62, -0.38)
  box(root, trim, 1.45, 0.13, 2.17, 0, 1.77, -0.3)
  box(root, trim, 1.26, 0.14, 0.94, 0, 1.73, 0.82)
  box(root, red, 0.54, 0.45, 0.72, 0, 0.65, 1.05)
  box(root, cream, 0.57, 0.12, 0.36, 0, 0.9, 1.2)
  box(root, surface('lamp'), 0.23, 0.14, 0.06, 0, 0.78, 1.43)
  box(root, frame, 0.44, 0.055, 0.07, 0, 1.1, 0.78)
  box(root, seat, 1.14, 0.16, 0.43, 0, 0.66, -0.87)
  box(root, seat, 1.16, 0.38, 0.12, 0, 0.88, -1.1)
  box(root, trim, 0.52, 0.11, 0.32, 0, 0.66, 0.53)

  for (const side of [-1, 1]) {
    for (const z of [-1.28, 0.55]) box(root, frame, 0.065, 1.15, 0.065, side * 0.64, 1.15, z)
    box(root, frame, 0.055, 0.88, 0.055, side * 0.45, 1.31, 1.09).rotation.x = -0.24
    box(root, surface('lamp'), 0.13, 0.11, 0.035, side * 0.5, 0.48, -1.43)
  }
  box(root, glass, 0.86, 0.73, 0.035, 0, 1.31, 1.09).rotation.x = -0.24
  box(root, cream, 1.24, 0.27, 0.055, 0, 0.82, -1.35)
  box(root, glass, 1.19, 0.61, 0.035, 0, 1.3, -1.34)
  box(root, cream, 0.06, 0.28, 1.72, -0.65, 0.83, -0.37)
  box(root, glass, 0.04, 0.55, 1.7, -0.65, 1.29, -0.37)
  box(root, cream, 0.06, 0.27, 0.63, 0.65, 0.83, -0.96)

  // The front jamb is the hinge. The door swings out toward the curb.
  const door = new Group()
  door.position.set(0.67, 0, 0.55)
  root.add(door)
  box(door, cream, 0.06, 0.38, 1.13, 0, 0.84, -0.57)
  box(door, frame, 0.06, 0.66, 0.055, 0, 1.33, -1.11)
  box(door, frame, 0.06, 0.06, 1.13, 0, 1.65, -0.57)
  box(door, glass, 0.035, 0.61, 1.07, 0, 1.32, -0.55)
  box(door, chrome, 0.085, 0.045, 0.15, 0.035, 0.94, -0.93)
  box(root, frame, 0.22, 0.06, 0.94, 0.72, 0.26, -0.05)

  const wheels = [[-0.66, -0.95], [0.66, -0.95], [0, 1.19]].map(([x, z]) => {
    const wheel = new Group()
    wheel.position.set(x!, 0.28, z!)
    const rubber = new Mesh(tyre, trim)
    rubber.scale.set(0.18, 0.28, 0.28)
    const hub = new Mesh(tyre, chrome)
    hub.scale.set(0.19, 0.14, 0.14)
    wheel.add(rubber, hub)
    root.add(wheel)
    return wheel
  })
  const driver = createAvatar(context)
  driver.root.position.set(0, 0.26, 0.54)
  driver.sit(1, 0.41)
  root.add(driver.root)

  const shadow = new Mesh(shadowGeometry, surface('contact-shadow'))
  shadow.position.y = 0.012
  root.add(shadow)
  let wheelAngle = 0
  return {
    root,
    update(doorOpen: number, metres: number, dt: number) {
      door.rotation.y = -doorOpen * Math.PI * 0.52
      wheelAngle = (wheelAngle + metres / 0.28) % (2 * Math.PI)
      for (const wheel of wheels) wheel.rotation.x = wheelAngle
      driver.locomotion(0, true, dt)
    },
  }
}
