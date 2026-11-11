/**
 * The page `render-look-photos.mjs` opens (D273, step 3d): each built-in look or piece on the
 * look form's turntable, drawn by the same builders as the building, and each scene card's picture
 * (step 4a): the demo shophouse alone and in its surroundings. Not part of the app.
 * Quality stays high: the stage is never measured (a software renderer would pick low).
 */
import { Box3, CircleGeometry, Mesh, MeshStandardMaterial, Sphere, Vector3 } from 'three'
import type { Group } from 'three'
import { FIGURE_KINDS, ITEM_LOOK_KINDS, SCENE_PRESETS } from '#shared/contracts/shop-layout'
import type { ScenePreset } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS, ITEM_SPECS } from '../../app/features/branches/designer/catalog'
import { frontFrame } from '../../app/features/branches/designer/surroundings'
import { buildFigure } from '../../app/features/branches/designer/scene/figures'
import type { BuildContext } from '../../app/features/branches/designer/scene/furniture'
import { buildItem, buildTable, disposeBuildContext } from '../../app/features/branches/designer/scene/furniture'
import { buildGround, buildScene } from '../../app/features/branches/designer/scene/scene'
import { createStage } from '../../app/features/branches/designer/scene/stage'
import { buildSurroundings } from '../../app/features/branches/designer/scene/surroundings'
import type { BuiltSurroundings } from '../../app/features/branches/designer/scene/surroundings'
import { DEMO_TABLES, demoLayout } from '../../app/features/branches/tests/demo-layout'

const canvas = document.querySelector('canvas')!
let firstFrame: () => void = () => {}
const drawn = new Promise<void>(resolve => (firstFrame = resolve))
const stage = createStage({ canvas, dark: false, onFirstFrame: () => firstFrame() })
const disc = new MeshStandardMaterial({ color: '#000000', transparent: true, opacity: 0.08, roughness: 1 })

/** What each picture shows: a table look with four chairs (six on the communal table), a piece, or a figure (step 3g). */
const builds: Record<string, (context: BuildContext) => Group> = Object.fromEntries([
  ...BUILT_IN_LOOKS.map(look => [look.id, (context: BuildContext) => buildTable(context, look, look.defaultWidth, look.defaultDepth, look.id === 'communal' ? 6 : 4)]),
  ...ITEM_LOOK_KINDS.map(kind => [kind, (context: BuildContext) => buildItem(context, { kind, width: ITEM_SPECS[kind].width, depth: ITEM_SPECS[kind].depth, finishes: {} })]),
  ...FIGURE_KINDS.map(kind => [kind, (context: BuildContext) => buildFigure(context, kind, `picture-${kind}`).body]),
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

let lane: BuiltSurroundings | null = null

/** A scene card's picture: the demo shophouse from the street, seen from its front (its door). */
async function showScene(preset: ScenePreset): Promise<void> {
  stage.clearContent()
  if (lane) disposeBuildContext(lane.context)
  const layout = demoLayout()
  const building = buildScene(stage.context, { layout, tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
  stage.scene.add(building.root)
  lane = buildSurroundings(stage.materials, layout, preset, 'scene-picture')
  stage.scene.add(lane ? lane.root : buildGround(stage.context, building.bounds))
  const bounds = lane ? building.bounds.clone().union(lane.bounds) : building.bounds
  stage.fitShadows(building.bounds.clone().expandByScalar(2))
  const sphere = bounds.getBoundingSphere(new Sphere())
  const front = frontFrame(layout)!
  // From the street side, a little to the right and above, like the 3D view's opening angle.
  const out = new Vector3(front.out.x, 0, front.out.y).normalize()
  const right = new Vector3(front.right.x, 0, front.right.y).normalize()
  const { camera, controls } = stage
  const distance = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * (lane ? 0.92 : 0.95)
  controls.target.copy(sphere.center)
  camera.position.copy(sphere.center).add(out.add(right.multiplyScalar(0.7)).add(new Vector3(0, 0.9, 0)).normalize().multiplyScalar(distance))
  controls.update()
  stage.shadowsChanged()
  await drawn
  await frames(6)
}

const scenes = Object.fromEntries(SCENE_PRESETS.map(preset => [`scene-${preset}`, () => showScene(preset)]))

Object.assign(window, {
  lookPhotoIds: [...Object.keys(builds), ...Object.keys(scenes)],
  showLookPhoto: (id: string) => (scenes[id] ? scenes[id]() : show(id)),
})
