/**
 * The page `render-look-photos.mjs` opens (D273, step 3d): each built-in look or piece on the
 * look form's turntable, drawn by the same builders as the building. Not part of the app.
 * Quality stays high: the stage is never measured (a software renderer would pick low).
 */
import { Box3, CircleGeometry, Mesh, MeshStandardMaterial, Sphere, Vector3 } from 'three'
import type { Group } from 'three'
import { ITEM_LOOK_KINDS } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, ITEM_SPECS } from '../../app/features/branches/designer/catalog'
import type { BuildContext } from '../../app/features/branches/designer/scene/furniture'
import { buildItem, buildTable } from '../../app/features/branches/designer/scene/furniture'
import { createStage } from '../../app/features/branches/designer/scene/stage'

const canvas = document.querySelector('canvas')!
let firstFrame: () => void = () => {}
const drawn = new Promise<void>(resolve => (firstFrame = resolve))
const stage = createStage({ canvas, dark: false, onFirstFrame: () => firstFrame() })
const disc = new MeshStandardMaterial({ color: '#000000', transparent: true, opacity: 0.08, roughness: 1 })

/** What each picture shows: a table look with four chairs (six on the communal table), or a piece. */
const builds: Record<string, (context: BuildContext) => Group> = Object.fromEntries([
  ...BUILT_IN_LOOKS.map(look => [look.id, (context: BuildContext) => buildTable(context, look, look.defaultWidth, look.defaultDepth, look.id === 'communal' ? 6 : 4)]),
  ...ITEM_LOOK_KINDS.map(kind => [kind, (context: BuildContext) => buildItem(context, { kind, width: ITEM_SPECS[kind].width, depth: ITEM_SPECS[kind].depth, finishes: {} })]),
])

const frames = (count: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve())
  step(count)
})

async function show(id: string): Promise<void> {
  stage.clearContent()
  const piece = builds[id]!(stage.context)
  piece.updateMatrixWorld(true)
  const sphere = new Box3().setFromObject(piece).getBoundingSphere(new Sphere())
  const radius = Math.max(0.4, sphere.radius)
  const floor = new Mesh(new CircleGeometry(radius * 1.35, 72), disc)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.001
  floor.receiveShadow = true
  stage.context.geometries.set('turntable', floor.geometry)
  stage.scene.add(piece, floor)
  stage.fitShadows(new Box3().setFromCenterAndSize(new Vector3(0, sphere.center.y, 0), new Vector3(radius * 3, radius * 2.5, radius * 3)))
  // The look form's 3D view, aimed at the piece's middle so a tall one fits the 4:3 frame.
  const { camera, controls } = stage
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05
  controls.target.set(0, sphere.center.y, 0)
  camera.position.copy(controls.target).add(new Vector3(0.75, 0.5, 1).normalize().multiplyScalar(distance))
  controls.update()
  stage.shadowsChanged()
  await drawn
  await frames(6)
}

Object.assign(window, { lookPhotoIds: Object.keys(builds), showLookPhoto: show })
