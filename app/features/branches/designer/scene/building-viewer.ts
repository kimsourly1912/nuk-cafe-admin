import { Box3, Raycaster, Sphere, Vector2, Vector3 } from 'three'
import type { Material, Mesh, Object3D } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Viewpoint } from '../geometry'
import { floorViewpoints } from '../geometry'
import { meshesOf } from './furniture'
import type { BuiltScene, SceneInput } from './scene'
import { buildGround, buildScene } from './scene'
import type { StageOptions } from './stage'
import { createStage, tween } from './stage'
import { cm, fitDistance } from './units'

/**
 * The finished building (D273, frames 4–5): orbit the exterior, cut it away (roof and the walls
 * facing the camera hidden, floors pulled apart), or go inside a floor at a viewpoint worked out
 * from its layout. A tap selects; a drag only turns the view.
 */

export type ViewMode = 'exterior' | 'cutaway' | 'inside'

export interface BuildingViewerOptions extends StageOptions {
  onSelectTable?: (tableId: string | null) => void
  onSelectFloor?: (floorId: string) => void
}

export interface BuildingViewer {
  setScene: (input: SceneInput) => void
  setMode: (mode: 'exterior' | 'cutaway') => Promise<void>
  enterFloor: (floorId: string, viewpointId?: string) => Promise<void>
  leaveFloor: () => Promise<void>
  viewpoints: (floorId: string) => Viewpoint[]
  selectTable: (tableId: string | null, options?: { focus?: boolean }) => void
  focusFloor: (floorId: string) => Promise<void>
  fit: () => Promise<void>
  zoom: (direction: 1 | -1) => void
  setTheme: (dark: boolean) => void
  dispose: () => void
}

/** Extra height between floors in the cutaway. */
const EXPLODE_GAP = 1.5
const EYE_HEIGHT = 1.5
/** A tap moves less than this many pixels. */
const TAP_SLOP = 6

export function createBuildingViewer(options: BuildingViewerOptions): BuildingViewer {
  const stage = createStage(options)
  const { camera, controls } = stage
  let built: BuiltScene | null = null
  let input: SceneInput | null = null
  let mode: ViewMode = 'exterior'
  let insideFloor: string | null = null
  let selected: string | null = null
  let explode = 0
  let overviewMaxDistance = 80
  let cameraFlight = 0
  let saved: { position: Vector3, target: Vector3 } | null = null
  const floorLabels: CSS2DObject[] = []
  let tableLabel: CSS2DObject | null = null
  const highlighted = new Map<Mesh, Material | Material[]>()

  stage.onBeforeRender(updateCutaway)

  function setScene(next: SceneInput) {
    const first = !built
    input = next
    highlighted.clear()
    stage.clearContent()
    floorLabels.length = 0
    tableLabel = null
    built = buildScene(stage.context, next)
    stage.scene.add(built.root, buildGround(stage.context, built.bounds))
    stage.registerLights(built.floors.flatMap(floor => floor.lights))
    stage.fitShadows(built.bounds)
    for (const floor of built.floors) {
      const label = new CSS2DObject(labelElement(floor.name, 'floor'))
      label.position.copy(floor.labelAnchor)
      floor.group.add(label)
      floorLabels.push(label)
    }
    applyExplode(explode)
    applyVisibility()
    if (selected && built.tables.has(selected)) selectTable(selected)
    else selected = null
    if (first) {
      placeCamera(new Vector3(0.9, 0.85, 1.35))
      stage.measure()
    }
    stage.shadowsChanged()
  }

  function distanceToFit(radius: number) {
    const distance = Math.max(2, fitDistance(radius, camera.fov, camera.aspect))
    overviewMaxDistance = Math.max(80, distance * 1.25)
    controls.maxDistance = overviewMaxDistance
    camera.far = Math.max(400, overviewMaxDistance + radius * 2)
    camera.updateProjectionMatrix()
    return distance
  }

  function placeCamera(direction: Vector3) {
    if (!built) return
    const sphere = currentBounds().getBoundingSphere(new Sphere())
    const distance = distanceToFit(sphere.radius)
    controls.target.copy(sphere.center)
    camera.position.copy(sphere.center).add(direction.normalize().multiplyScalar(distance))
    exteriorLimits()
    controls.update()
    stage.invalidate()
  }

  function exteriorLimits() {
    controls.enableZoom = true
    controls.enablePan = true
    controls.minDistance = 2
    controls.maxDistance = overviewMaxDistance
    controls.minPolarAngle = 0.12 * Math.PI
    controls.maxPolarAngle = 0.48 * Math.PI
    controls.rotateSpeed = 0.8
  }

  function currentBounds(): Box3 {
    if (!built) return new Box3()
    built.root.updateMatrixWorld(true)
    return new Box3().setFromObject(built.root)
  }

  function applyExplode(amount: number) {
    explode = amount
    if (!built) return
    for (const floor of built.floors) floor.group.position.y = floor.elevation + floor.index * EXPLODE_GAP * amount
  }

  function applyVisibility() {
    if (!built) return
    const inside = mode === 'inside' ? built.floors.find(floor => floor.id === insideFloor) : undefined
    for (const floor of built.floors) {
      floor.group.visible = !inside || floor.index <= inside.index
      for (const roof of floor.roofs) roof.visible = mode === 'exterior'
    }
    for (const label of floorLabels) label.visible = mode === 'cutaway'
    if (tableLabel) tableLabel.visible = true
  }

  /** In the cutaway, walls facing the camera step aside so the floors show. */
  function updateCutaway() {
    if (!built) return
    for (const floor of built.floors) {
      for (const wall of floor.walls) {
        if (mode !== 'cutaway') {
          wall.object.visible = true
          continue
        }
        const toCamera = new Vector3(camera.position.x - wall.center.x, 0, camera.position.z - wall.center.z).normalize()
        wall.object.visible = wall.normal.dot(toCamera) < 0.15
      }
    }
  }

  async function setMode(next: 'exterior' | 'cutaway') {
    if (mode === 'inside') await leaveFloor()
    mode = next
    applyVisibility()
    const from = explode
    const to = next === 'cutaway' ? 1 : 0
    await tween(stage, 520, progress => applyExplode(from + (to - from) * progress))
    stage.shadowsChanged()
  }

  function viewpoints(floorId: string): Viewpoint[] {
    if (!input) return []
    const index = input.layout.floors.findIndex(floor => floor.id === floorId)
    const floor = input.layout.floors[index]
    return floor ? floorViewpoints(floor, input.layout.floors[index - 1]) : []
  }

  async function enterFloor(floorId: string, viewpointId?: string) {
    if (!built) return
    const floor = built.floors.find(candidate => candidate.id === floorId)
    const point = viewpoints(floorId).find(candidate => candidate.id === viewpointId) ?? viewpoints(floorId)[0]
    if (!floor || !point) return
    if (mode !== 'inside') saved = { position: camera.position.clone(), target: controls.target.clone() }
    mode = 'inside'
    insideFloor = floorId
    applyVisibility()
    if (explode !== 0) await tween(stage, 300, progress => applyExplode(explode * (1 - progress)))
    applyExplode(0)
    const base = floor.elevation
    const eye = new Vector3(cm(point.eye.x), base + EYE_HEIGHT, cm(point.eye.y))
    const look = new Vector3(cm(point.target.x), base + 1.1, cm(point.target.y))
    const target = eye.clone().add(look.sub(eye).normalize().multiplyScalar(0.4))
    controls.enableZoom = false
    controls.enablePan = false
    controls.minDistance = 0.1
    controls.maxDistance = 1
    controls.minPolarAngle = 0.25 * Math.PI
    controls.maxPolarAngle = 0.7 * Math.PI
    controls.rotateSpeed = -0.35
    await flyTo(eye, target, 700)
    stage.shadowsChanged()
  }

  async function leaveFloor() {
    if (mode !== 'inside') return
    mode = 'cutaway'
    insideFloor = null
    exteriorLimits()
    applyVisibility()
    await tween(stage, 400, progress => applyExplode(progress))
    if (saved) await flyTo(saved.position, saved.target, 600)
    saved = null
  }

  async function flyTo(position: Vector3, target: Vector3, duration: number) {
    const flight = ++cameraFlight
    const fromPosition = camera.position.clone()
    const fromTarget = controls.target.clone()
    await tween(stage, duration, (progress) => {
      if (flight !== cameraFlight) return
      camera.position.lerpVectors(fromPosition, position, progress)
      controls.target.lerpVectors(fromTarget, target, progress)
    })
    if (flight === cameraFlight) controls.update()
  }

  async function focusFloor(floorId: string) {
    const floor = built?.floors.find(candidate => candidate.id === floorId)
    if (!floor || mode === 'inside') return
    const center = floor.center.clone().add(new Vector3(0, floor.group.position.y + floor.height / 2, 0))
    const offset = camera.position.clone().sub(controls.target)
    await flyTo(center.clone().add(offset), center, 450)
  }

  function selectTable(tableId: string | null, selectOptions: { focus?: boolean } = {}) {
    for (const [mesh, material] of highlighted) mesh.material = material
    highlighted.clear()
    tableLabel?.removeFromParent()
    tableLabel = null
    if (tableId !== selected) cameraFlight++
    selected = tableId
    const node = tableId ? built?.tables.get(tableId) : undefined
    if (!node) {
      stage.invalidate()
      return
    }
    for (const mesh of meshesOf(node.object)) {
      if (mesh.userData.part !== 'top') continue
      highlighted.set(mesh, mesh.material)
      mesh.material = stage.materials.surface('highlight')
    }
    tableLabel = new CSS2DObject(labelElement(node.label, 'table'))
    tableLabel.position.copy(node.labelAnchor)
    node.object.parent?.add(tableLabel)
    if (selectOptions.focus && mode !== 'inside') {
      const world = node.object.getWorldPosition(new Vector3())
      const offset = camera.position.clone().sub(controls.target)
      void flyTo(world.clone().add(offset), world, 450)
    }
    stage.invalidate()
  }

  async function fit() {
    if (mode === 'inside') return
    const sphere = currentBounds().getBoundingSphere(new Sphere())
    const direction = camera.position.clone().sub(controls.target).normalize()
    const distance = distanceToFit(sphere.radius)
    await flyTo(sphere.center.clone().add(direction.multiplyScalar(distance)), sphere.center, 450)
  }

  function zoom(direction: 1 | -1) {
    if (mode === 'inside') {
      camera.fov = Math.min(60, Math.max(20, camera.fov - direction * 6))
      camera.updateProjectionMatrix()
      stage.invalidate()
      return
    }
    const offset = camera.position.clone().sub(controls.target)
    const length = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * (direction > 0 ? 0.8 : 1.25)))
    void flyTo(controls.target.clone().add(offset.setLength(length)), controls.target.clone(), 250)
  }

  // A tap selects; a drag turns the view (touch and mouse alike).
  const raycaster = new Raycaster()
  let down: { x: number, y: number } | null = null
  const canvas = options.canvas
  const onDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY }
  }
  const onUp = (event: PointerEvent) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP || !built) {
      down = null
      return
    }
    down = null
    const rect = canvas.getBoundingClientRect()
    const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(built.root, true).find(intersection => isShown(intersection.object))
    const tableId = hit && findUp(hit.object, 'tableId')
    if (tableId) {
      selectTable(tableId)
      options.onSelectTable?.(tableId)
      return
    }
    const floorId = hit && findUp(hit.object, 'floorId')
    if (floorId && mode !== 'inside') options.onSelectFloor?.(floorId)
    selectTable(null)
    options.onSelectTable?.(null)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)

  function dispose() {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointerup', onUp)
    stage.dispose()
  }

  return {
    setScene,
    setMode,
    enterFloor,
    leaveFloor,
    viewpoints,
    selectTable,
    focusFloor,
    fit,
    zoom,
    setTheme: stage.setTheme,
    dispose,
  }
}

function isShown(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

function findUp(object: Object3D, key: 'tableId' | 'floorId'): string | undefined {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (typeof current.userData[key] === 'string') return current.userData[key]
  }
  return undefined
}

/** A label over the canvas: decorative (the floor and table lists are the accessible route). */
function labelElement(text: string, kind: 'floor' | 'table'): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('aria-hidden', 'true')
  element.textContent = text
  element.className = kind === 'floor'
    ? 'pointer-events-none flex items-center gap-2 text-sm font-medium text-muted before:block before:h-px before:w-10 before:bg-current before:opacity-60'
    : 'pointer-events-none rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-inverted shadow-md'
  return element
}
