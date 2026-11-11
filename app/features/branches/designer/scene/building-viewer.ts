import { Box3, Raycaster, Sphere, Vector2, Vector3 } from 'three'
import type { AnimationMixer, Material, Mesh, Object3D } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Viewpoint } from '../geometry'
import { BENCHMARK } from '../benchmark'
import { floorViewpoints } from '../geometry'
import type { SurroundingsPreset } from '../surroundings'
import { disposeBuildContext, meshesOf } from './furniture'
import { createModelLibrary } from './models'
import type { BuiltSurroundings } from './surroundings'
import { buildSurroundings } from './surroundings'
import type { BuiltScene, FigureNode, SceneInput } from './scene'
import { buildGround, buildScene } from './scene'
import type { StageDetails, StageOptions } from './stage'
import { createStage, tween } from './stage'
import { createTapTracker } from './tap-tracker'
import { cm, fitDistance } from './units'

/**
 * The finished building (D273, frames 4–5): orbit the exterior, cut it away (roof and the walls
 * facing the camera hidden, floors pulled apart), or go inside a floor at a viewpoint worked out
 * from its layout. A tap selects; a drag only turns the view.
 */

export type BuildingNavigation
  = | { mode: 'exterior' | 'cutaway' }
    | { mode: 'inside', floorId: string, viewpointId: string, viewpoints: Viewpoint[] }

export interface BuildingViewerOptions extends StageOptions {
  onNavigationChange?: (navigation: BuildingNavigation) => void
  onSelectTable?: (tableId: string | null) => void
  onSelectFloor?: (floorId: string) => void
}

/** What this viewer plays (step 3g): never saved, each person's own. */
export interface Playback {
  /** People and pets shown. */
  figures: boolean
  /** Their idle loops play (only while the tab and the view are visible, without reduced motion). */
  animate: boolean
}

export interface BuildingViewer {
  setScene: (input: SceneInput) => void
  setPlayback: (playback: Playback) => void
  /** The street around the café (step 3h); `seed` keeps it the same for everyone (the branch id). */
  setSurroundings: (preset: SurroundingsPreset, seed: string) => void
  /**
   * The benchmark (step 3h): a warm-up, then full orbits around the café at a steady pace, timing
   * every frame. `onProgress` gets the phase. Resolves null when interrupted.
   */
  benchmark: (onProgress?: (phase: string) => void) => Promise<{ runs: number[][], details: StageDetails } | null>
  setMode: (mode: 'exterior' | 'cutaway') => Promise<void>
  enterFloor: (floorId: string, viewpointId?: string) => Promise<void>
  leaveFloor: () => Promise<void>
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

export function createBuildingViewer(options: BuildingViewerOptions): BuildingViewer {
  const stage = createStage(options)
  const { camera, controls } = stage
  let built: BuiltScene | null = null
  let input: SceneInput | null = null
  let navigation: BuildingNavigation = { mode: 'exterior' }
  let selected: string | null = null
  let explode = 0
  let overviewMaxDistance = 80
  let cameraFlight = 0
  let navigationRequest = 0
  let saved: { position: Vector3, target: Vector3, fov: number } | null = null
  const floorLabels: CSS2DObject[] = []
  let tableLabel: CSS2DObject | null = null
  const highlighted = new Map<Mesh, Material | Material[]>()
  const models = createModelLibrary()
  let playback: Playback = { figures: true, animate: true }
  /** The current scene's figures' idle motion: generated, or a model file's own loop. */
  let animators = new Map<FigureNode | 'surroundings', (delta: number) => void>()
  let surroundings: BuiltSurroundings | null = null
  let surroundingsChoice: { preset: SurroundingsPreset, seed: string } = { preset: 'none', seed: '' }
  let ground: Mesh | null = null
  /** The model loops, stopped when their scene goes. */
  let mixers: AnimationMixer[] = []
  /** Seconds of idle motion played so far. */
  let clock = 0
  let animating = false
  let onScreen = true
  const reducedMotion = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined

  stage.onBeforeRender(updateCutaway)

  function setScene(next: SceneInput) {
    const first = !built
    const layoutChanged = input?.layout !== next.layout
    input = next
    highlighted.clear()
    stage.clearContent()
    floorLabels.length = 0
    tableLabel = null
    built = buildScene(stage.context, next)
    ground = buildGround(stage.context, built.bounds)
    stage.scene.add(built.root, ground)
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
    attachFigures(built)
    // The street fits this layout: built again with it (clearContent took the old one off).
    placeSurroundings(layoutChanged || first)
    if (selected && built.tables.has(selected)) selectTable(selected)
    else selected = null
    if (first) {
      placeCamera(new Vector3(0.9, 0.85, 1.35))
      stage.measure()
    }
    else if (layoutChanged && navigation.mode === 'inside') {
      const points = viewpoints(navigation.floorId)
      if (points.length) void enterFloor(navigation.floorId, navigation.viewpointId)
      else void setMode('cutaway')
    }
    stage.shadowsChanged()
  }

  /**
   * Each figure moves with its generated idle; a kind with a model file gets the model once loaded,
   * in place of the generated figure. A rebuild meanwhile drops the late models.
   */
  function attachFigures(scene: BuiltScene) {
    for (const mixer of mixers) mixer.stopAllAction()
    mixers = []
    animators = new Map()
    for (const figure of scene.figures) {
      figure.anchor.visible = playback.figures
      animators.set(figure, () => figure.idle(clock))
      models.figure(figure.kind).then((instance) => {
        if (!instance || built !== scene) return
        figure.body.visible = false
        figure.anchor.add(instance.object)
        const { mixer } = instance
        if (mixer) {
          mixers.push(mixer)
          mixer.update(0)
          animators.set(figure, delta => mixer.update(delta))
        }
        else {
          animators.delete(figure)
        }
        stage.invalidate()
        startAnimation()
      }).catch((error: unknown) => {
        // The figure keeps its contact shadow; the building and the tables are unaffected.
        if (import.meta.dev) console.error(`[shop designer] could not load the ${figure.kind} model`, error)
      })
    }
    startAnimation()
  }

  function shouldAnimate() {
    return playback.animate && playback.figures && animators.size > 0 && onScreen
      && (typeof document === 'undefined' || !document.hidden) && !reducedMotion?.matches
  }

  /**
   * Plays the figures' idle loops while they should play; the stage then draws every frame. When
   * they stop (paused, hidden, off screen), the task ends and the stage draws only on change again.
   */
  function startAnimation() {
    if (animating || !shouldAnimate()) return
    animating = true
    let last = -1
    stage.animate((now) => {
      if (!shouldAnimate()) {
        animating = false
        return false
      }
      const delta = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000)
      last = now
      clock += delta
      for (const animate of animators.values()) animate(delta)
      return true
    }, () => (animating = false))
  }

  function setPlayback(next: Playback) {
    playback = next
    for (const figure of built?.figures ?? []) figure.anchor.visible = next.figures
    for (const figure of surroundings?.figures ?? []) figure.visible = next.figures
    stage.invalidate()
    startAnimation()
  }

  const onVisibility = () => startAnimation()
  document.addEventListener('visibilitychange', onVisibility)
  reducedMotion?.addEventListener('change', onVisibility)
  const screenObserver = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => {
        onScreen = entries.some(entry => entry.isIntersecting)
        startAnimation()
      })
  screenObserver?.observe(options.canvas)

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

  /** What Fit frames: the building, and the street around it when shown. */
  function currentBounds(): Box3 {
    if (!built) return new Box3()
    built.root.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(built.root)
    return surroundings ? bounds.union(surroundings.bounds) : bounds
  }

  /**
   * Puts the chosen surroundings around the building: the ground disc goes, the base takes its
   * place. The sun's shadow stays fitted to the building (its detail would spread thin over the
   * street). `rebuild` builds them again (a new layout, a new choice); otherwise the current ones go
   * back into the scene a rebuild of the building emptied.
   */
  function placeSurroundings(rebuild: boolean) {
    if (!built) return
    if (rebuild || !surroundings) {
      disposeSurroundings()
      surroundings = buildSurroundings(stage.materials, input!.layout, surroundingsChoice.preset, surroundingsChoice.seed)
    }
    if (surroundings) {
      if (!surroundings.root.parent) stage.scene.add(surroundings.root)
      for (const figure of surroundings.figures) figure.visible = playback.figures
      animators.set('surroundings', () => surroundings?.idle(clock))
    }
    else {
      animators.delete('surroundings')
    }
    if (ground) ground.visible = !surroundings
    // Zooming out reaches the whole scene; the camera itself moves only on Fit.
    distanceToFit(currentBounds().getBoundingSphere(new Sphere()).radius)
    stage.invalidate()
    startAnimation()
  }

  function disposeSurroundings() {
    if (!surroundings) return
    surroundings.root.removeFromParent()
    disposeBuildContext(surroundings.context)
    surroundings = null
    animators.delete('surroundings')
  }

  function benchmark(onProgress?: (phase: string) => void): Promise<{ runs: number[][], details: StageDetails } | null> {
    // The orbit owns the camera: a user's drag or a fly-to would change what is measured.
    const current = beginNavigation(navigation.mode === 'inside' ? { mode: 'exterior' } : navigation)
    const runs: number[][] = []
    const total = BENCHMARK.warmUpMs + BENCHMARK.runs * BENCHMARK.runMs
    return new Promise((resolve) => {
      let start = -1
      let last = -1
      let phase = ''
      stage.animate((now) => {
        if (!current()) {
          resolve(null)
          return false
        }
        if (start < 0) start = now
        const elapsed = now - start
        // A full turn every run, about the point the camera looks at.
        if (last >= 0) {
          const offset = camera.position.clone().sub(controls.target)
          offset.applyAxisAngle(new Vector3(0, 1, 0), ((now - last) / BENCHMARK.runMs) * Math.PI * 2)
          camera.position.copy(controls.target).add(offset)
          camera.lookAt(controls.target)
        }
        const run = Math.floor((elapsed - BENCHMARK.warmUpMs) / BENCHMARK.runMs)
        const next = elapsed < BENCHMARK.warmUpMs ? 'Warming up' : `Orbit ${Math.min(run, BENCHMARK.runs - 1) + 1} of ${BENCHMARK.runs}`
        if (next !== phase) onProgress?.((phase = next))
        if (elapsed >= BENCHMARK.warmUpMs && run < BENCHMARK.runs && last >= 0) (runs[run] ??= []).push(now - last)
        last = now
        if (elapsed >= total) {
          resolve({ runs, details: stage.details() })
          return false
        }
        return true
      }, () => resolve(null))
    })
  }

  function setSurroundings(preset: SurroundingsPreset, seed: string) {
    if (preset === surroundingsChoice.preset && seed === surroundingsChoice.seed) return
    const wasShown = surroundings !== null
    surroundingsChoice = { preset, seed }
    placeSurroundings(true)
    // The street costs more to draw than the café alone: measure this device again.
    if (surroundings && !wasShown) stage.measure()
  }

  function applyExplode(amount: number) {
    explode = amount
    if (!built) return
    for (const floor of built.floors) floor.group.position.y = floor.elevation + floor.index * EXPLODE_GAP * amount
  }

  function applyVisibility() {
    if (!built) return
    const insideId = navigation.mode === 'inside' ? navigation.floorId : null
    const inside = built.floors.find(floor => floor.id === insideId)
    for (const floor of built.floors) {
      floor.group.visible = !inside || floor.index <= inside.index
      for (const roof of floor.roofs) roof.visible = navigation.mode === 'exterior'
    }
    for (const label of floorLabels) label.visible = navigation.mode === 'cutaway'
    if (tableLabel) tableLabel.visible = true
  }

  /** In the cutaway, walls facing the camera step aside so the floors show. */
  function updateCutaway() {
    if (!built) return
    if (surroundings) {
      // In the cutaway, a shophouse between the camera and the café steps aside like a near wall.
      const center = built.bounds.getCenter(new Vector3())
      const toCamera = new Vector3(camera.position.x - center.x, 0, camera.position.z - center.z).normalize()
      for (const block of surroundings.blocks) {
        const toBlock = new Vector3(block.center.x - center.x, 0, block.center.z - center.z).normalize()
        block.object.visible = navigation.mode !== 'cutaway' || toBlock.dot(toCamera) < 0.35
      }
    }
    for (const floor of built.floors) {
      for (const wall of floor.walls) {
        if (navigation.mode !== 'cutaway') {
          wall.object.visible = true
          continue
        }
        const toCamera = new Vector3(camera.position.x - wall.center.x, 0, camera.position.z - wall.center.z).normalize()
        wall.object.visible = wall.normal.dot(toCamera) < 0.15
      }
    }
  }

  function beginNavigation(next: BuildingNavigation) {
    const request = ++navigationRequest
    cameraFlight++
    navigation = next
    applyVisibility()
    options.onNavigationChange?.(navigation)
    return () => request === navigationRequest
  }

  async function setMode(next: 'exterior' | 'cutaway') {
    const restore = saved
    const current = beginNavigation({ mode: next })
    exteriorLimits()
    if (restore) {
      camera.fov = restore.fov
      camera.updateProjectionMatrix()
    }
    const from = explode
    const to = next === 'cutaway' ? 1 : 0
    if (!await tween(stage, from === to ? 0 : 520, progress => applyExplode(from + (to - from) * progress), current) || !current()) return
    if (restore) await flyTo(restore.position, restore.target, 600, current)
    if (current()) saved = null
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
    const points = viewpoints(floorId)
    const point = points.find(candidate => candidate.id === viewpointId) ?? points[0]
    if (!floor || !point) return
    saved ??= { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov }
    const current = beginNavigation({ mode: 'inside', floorId, viewpointId: point.id, viewpoints: points })
    const from = explode
    if (from !== 0 && (!await tween(stage, 300, progress => applyExplode(from * (1 - progress)), current) || !current())) return
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
    await flyTo(eye, target, 700, current)
  }

  async function leaveFloor() {
    if (navigation.mode === 'inside') await setMode('cutaway')
  }

  async function flyTo(position: Vector3, target: Vector3, duration: number, isCurrent: () => boolean = () => true) {
    const flight = ++cameraFlight
    const current = () => flight === cameraFlight && isCurrent()
    const fromPosition = camera.position.clone()
    const fromTarget = controls.target.clone()
    await tween(stage, duration, (progress) => {
      camera.position.lerpVectors(fromPosition, position, progress)
      controls.target.lerpVectors(fromTarget, target, progress)
    }, current)
    if (current()) controls.update()
  }

  async function focusFloor(floorId: string) {
    const floor = built?.floors.find(candidate => candidate.id === floorId)
    if (!floor || navigation.mode === 'inside') return
    const center = floor.center.clone().add(new Vector3(0, floor.group.position.y + floor.height / 2, 0))
    const offset = camera.position.clone().sub(controls.target)
    await flyTo(center.clone().add(offset), center, 450)
  }

  function selectTable(tableId: string | null, selectOptions: { focus?: boolean } = {}) {
    for (const [mesh, material] of highlighted) mesh.material = material
    highlighted.clear()
    tableLabel?.removeFromParent()
    tableLabel = null
    if (tableId !== selected && navigation.mode !== 'inside') cameraFlight++
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
    if (selectOptions.focus && navigation.mode !== 'inside') {
      const world = node.object.getWorldPosition(new Vector3())
      const offset = camera.position.clone().sub(controls.target)
      void flyTo(world.clone().add(offset), world, 450)
    }
    stage.invalidate()
  }

  async function fit() {
    if (navigation.mode === 'inside') return
    const sphere = currentBounds().getBoundingSphere(new Sphere())
    const direction = camera.position.clone().sub(controls.target).normalize()
    const distance = distanceToFit(sphere.radius)
    await flyTo(sphere.center.clone().add(direction.multiplyScalar(distance)), sphere.center, 450)
  }

  function zoom(direction: 1 | -1) {
    if (navigation.mode === 'inside') {
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
  const taps = createTapTracker()
  const canvas = options.canvas
  const onUp = (event: PointerEvent) => {
    if (!taps.up(event) || !built) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
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
    if (floorId && navigation.mode !== 'inside') options.onSelectFloor?.(floorId)
    selectTable(null)
    options.onSelectTable?.(null)
  }
  canvas.addEventListener('pointerdown', taps.down)
  canvas.addEventListener('pointermove', taps.move)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', taps.cancel)
  canvas.addEventListener('lostpointercapture', taps.cancel)

  function dispose() {
    navigationRequest++
    cameraFlight++
    canvas.removeEventListener('pointerdown', taps.down)
    canvas.removeEventListener('pointermove', taps.move)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', taps.cancel)
    canvas.removeEventListener('lostpointercapture', taps.cancel)
    document.removeEventListener('visibilitychange', onVisibility)
    reducedMotion?.removeEventListener('change', onVisibility)
    screenObserver?.disconnect()
    for (const mixer of mixers) mixer.stopAllAction()
    mixers = []
    animators.clear()
    disposeSurroundings()
    stage.dispose()
    models.dispose()
  }

  return {
    setScene,
    setPlayback,
    setSurroundings,
    benchmark,
    setMode,
    enterFloor,
    leaveFloor,
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
