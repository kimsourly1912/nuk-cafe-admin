import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PCFShadowMap, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import type { Box3, PointLight } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { BuildContext } from './furniture'
import { createBuildContext, disposeBuildContext } from './furniture'
import type { MaterialLibrary } from './materials'
import { createMaterialLibrary } from './materials'

/**
 * What every 3D view of the designer shares (D273): renderer, camera and orbit controls, the warm
 * lighting of the owner's visual target (image-based light from a room environment, one soft sun,
 * filmic tone mapping), HTML labels, and a render loop that draws only when something changed.
 * The quality level is chosen from the frame time measured on this device, not from its name.
 */

export type Quality = 'high' | 'medium' | 'low'

export interface StageStats {
  quality: Quality
  /** The average time between frames while measuring, in milliseconds. */
  frameMs: number
}

export interface StageOptions {
  canvas: HTMLCanvasElement
  /** Where HTML labels are drawn, over the canvas. */
  labels?: HTMLElement
  dark: boolean
  onStats?: (stats: StageStats) => void
  onContextLost?: () => void
}

export interface Stage {
  scene: Scene
  camera: PerspectiveCamera
  controls: OrbitControls
  materials: MaterialLibrary
  context: BuildContext
  quality: () => Quality
  /** Draws the next frame (once). */
  invalidate: () => void
  /** Runs `step` every frame until it returns false. */
  animate: (step: (now: number) => boolean) => void
  /** Called before each frame is drawn. */
  onBeforeRender: (callback: () => void) => void
  /** The scene's objects moved or changed: draw the shadows again. */
  shadowsChanged: () => void
  /** Fits the sun's shadow to the building. */
  fitShadows: (bounds: Box3) => void
  /** Lights that the low quality level turns off. */
  registerLights: (lights: PointLight[]) => void
  /** Measures this device for a second and picks the quality level. */
  measure: () => void
  setTheme: (dark: boolean) => void
  /** Clears the scene's own content (keeps the lights) and the cached geometries. */
  clearContent: () => void
  dispose: () => void
}

const BACKGROUND = { light: '#efe9e2', dark: '#1d1714' }

/** Throws when WebGL isn't available; the caller shows the lists instead (frame 6D). */
export function createStage(options: StageOptions): Stage {
  const { canvas } = options
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.shadowMap.autoUpdate = false

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = environment
  scene.environmentIntensity = 0.55

  const camera = new PerspectiveCamera(32, 1, 0.05, 400)
  camera.position.set(14, 12, 18)

  const hemisphere = new HemisphereLight('#fff4e6', '#5b4636', 0.5)
  const sun = new DirectionalLight('#ffe2bd', 2.4)
  sun.position.set(-8, 16, 10)
  sun.castShadow = true
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  scene.add(hemisphere, sun, sun.target)

  const labels = options.labels ? new CSS2DRenderer({ element: options.labels }) : null
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  controls.screenSpacePanning = true

  const materials = createMaterialLibrary()
  const context = createBuildContext(materials)
  const contentStart = scene.children.length
  const tasks = new Set<(now: number) => boolean>()
  const beforeRender: (() => void)[] = []
  let pointLights: PointLight[] = []
  let quality: Quality = 'high'
  let frame = 0
  let measuring: { frames: number, last: number, total: number } | null = null
  let disposed = false

  function applyQuality(next: Quality) {
    quality = next
    const ratio = window.devicePixelRatio || 1
    renderer.setPixelRatio(next === 'high' ? Math.min(ratio, 2) : next === 'medium' ? Math.min(ratio, 1.5) : 1)
    const size = next === 'high' ? 2048 : next === 'medium' ? 1024 : 512
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    sun.shadow.radius = next === 'high' ? 4 : next === 'medium' ? 3 : 1
    for (const light of pointLights) light.visible = next !== 'low'
    resize()
    renderer.shadowMap.needsUpdate = true
  }

  function resize() {
    const parent = canvas.parentElement
    if (!parent) return
    const width = Math.max(1, parent.clientWidth)
    const height = Math.max(1, parent.clientHeight)
    renderer.setSize(width, height, false)
    labels?.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    invalidate()
  }

  function invalidate() {
    if (!frame && !disposed) frame = requestAnimationFrame(loop)
  }

  function loop(now: number) {
    frame = 0
    let again = controls.update()
    for (const task of [...tasks]) {
      if (task(now)) again = true
      else tasks.delete(task)
    }
    for (const callback of beforeRender) callback()
    renderer.render(scene, camera)
    labels?.render(scene, camera)
    if (measuring) {
      if (measuring.frames > 0) measuring.total += now - measuring.last
      measuring.last = now
      measuring.frames++
      // Up to 30 frames, but a slow device stops after about a second: it shouldn't spend long at
      // a quality it can't afford (a software renderer took half a second a frame).
      if (measuring.frames > 30 || (measuring.frames > 4 && measuring.total > 1000)) finishMeasure()
      again = true
    }
    if (again) invalidate()
  }

  function finishMeasure() {
    if (!measuring) return
    const frameMs = measuring.total / Math.max(1, measuring.frames - 1)
    measuring = null
    const next: Quality = frameMs <= 22 ? 'high' : frameMs <= 36 ? 'medium' : 'low'
    if (next !== quality) applyQuality(next)
    options.onStats?.({ quality, frameMs: Math.round(frameMs * 10) / 10 })
  }

  const observer = new ResizeObserver(resize)
  if (canvas.parentElement) observer.observe(canvas.parentElement)
  controls.addEventListener('change', invalidate)
  const contextLost = (event: Event) => {
    event.preventDefault()
    options.onContextLost?.()
  }
  canvas.addEventListener('webglcontextlost', contextLost)

  function setTheme(dark: boolean) {
    scene.background = new Color(dark ? BACKGROUND.dark : BACKGROUND.light)
    materials.setTheme(dark)
    invalidate()
  }

  function fitShadows(bounds: Box3) {
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3()).length()
    sun.target.position.copy(center)
    sun.position.copy(center).add(new Vector3(-0.45, 0.8, 0.4).normalize().multiplyScalar(size))
    const half = size * 0.62
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.1, far: size * 2.2 })
    sun.shadow.camera.updateProjectionMatrix()
    renderer.shadowMap.needsUpdate = true
  }

  function clearContent() {
    for (const child of scene.children.slice(contentStart)) scene.remove(child)
    disposeBuildContext(context)
    pointLights = []
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(frame)
    observer.disconnect()
    canvas.removeEventListener('webglcontextlost', contextLost)
    controls.dispose()
    clearContent()
    materials.dispose()
    environment.dispose()
    sun.shadow.map?.dispose()
    renderer.dispose()
    labels?.domElement.replaceChildren()
  }

  applyQuality('high')
  setTheme(options.dark)

  return {
    scene,
    camera,
    controls,
    materials,
    context,
    quality: () => quality,
    invalidate,
    animate: (step) => {
      tasks.add(step)
      invalidate()
    },
    onBeforeRender: callback => beforeRender.push(callback),
    shadowsChanged: () => {
      renderer.shadowMap.needsUpdate = true
      invalidate()
    },
    fitShadows,
    registerLights: (lights) => {
      pointLights = lights
      for (const light of lights) light.visible = quality !== 'low'
    },
    measure: () => {
      measuring = { frames: 0, last: 0, total: 0 }
      invalidate()
    },
    setTheme,
    clearContent,
    dispose,
  }
}

/** Eases a value from 0 to 1 over `duration` ms; instant when the person prefers less motion. */
export function tween(stage: Stage, duration: number, step: (progress: number) => void): Promise<void> {
  const instant = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return new Promise((resolve) => {
    if (instant || duration <= 0) {
      step(1)
      stage.shadowsChanged()
      resolve()
      return
    }
    let start = -1
    stage.animate((now) => {
      if (start < 0) start = now
      const linear = Math.min(1, (now - start) / duration)
      step(1 - (1 - linear) ** 3)
      if (linear >= 1) {
        stage.shadowsChanged()
        resolve()
        return false
      }
      return true
    })
  })
}
