import { Window } from 'happy-dom'
import { Group, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three'
import type { AnimationMixer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIGURE_SIZES } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS } from '../designer/catalog'
import { createBuildingViewer } from '../designer/scene/building-viewer'
import type { BuildingNavigation } from '../designer/scene/building-viewer'
import { createBuildContext, disposeBuildContext } from '../designer/scene/furniture'
import { createModelLibrary } from '../designer/scene/models'
import { createStage } from '../designer/scene/stage'
import type { Stage } from '../designer/scene/stage'
import { createTapTracker } from '../designer/scene/tap-tracker'
import { demoLayout, DEMO_TABLES } from './demo-layout'

vi.mock(import('../designer/scene/stage'), async original => ({
  ...await original(),
  createStage: vi.fn(),
}))

// The figures' models are files (step 3g): each copy here is an empty group with a mixer to watch.
vi.mock(import('../designer/scene/models'), () => ({ createModelLibrary: vi.fn() }))
const mixers: { update: ReturnType<typeof vi.fn>, stopAllAction: ReturnType<typeof vi.fn> }[] = []
const modelLibrary = {
  figure: vi.fn(async () => {
    const mixer = { update: vi.fn(), stopAllAction: vi.fn() }
    mixers.push(mixer)
    return { object: new Group(), mixer: mixer as unknown as AnimationMixer }
  }),
  dispose: vi.fn(),
}

afterEach(() => {
  vi.unstubAllGlobals()
  mixers.length = 0
})

function makeViewer() {
  vi.stubGlobal('document', new Window().document)
  const camera = new PerspectiveCamera(32, 1)
  const canvas = document.createElement('canvas')
  const controls = new OrbitControls(camera, canvas)
  const scene = new Scene()
  const material = new MeshBasicMaterial()
  const materials = { finish: () => material, surface: () => material, setTheme: vi.fn(), dispose: () => material.dispose() }
  const context = createBuildContext(materials)
  const frames = new Map<(now: number) => boolean, () => void>()
  const stage: Stage = {
    camera,
    controls,
    scene,
    materials,
    context,
    quality: () => 'high',
    animate: (step, cancel) => void frames.set(step, cancel),
    onBeforeRender: vi.fn(),
    shadowsChanged: vi.fn(),
    fitShadows: vi.fn(),
    registerLights: vi.fn(),
    invalidate: vi.fn(),
    measure: vi.fn(),
    setTheme: vi.fn(),
    clearContent: () => {
      scene.clear()
      disposeBuildContext(context)
    },
    dispose: () => {
      for (const cancel of frames.values()) cancel()
      frames.clear()
      stage.clearContent()
      controls.dispose()
      materials.dispose()
    },
  }
  vi.mocked(createStage).mockReturnValue(stage)
  vi.mocked(createModelLibrary).mockReturnValue(modelLibrary)
  const onNavigationChange = vi.fn<(navigation: BuildingNavigation) => void>()
  const viewer = createBuildingViewer({ canvas, dark: false, onNavigationChange })
  viewer.setScene({ layout: demoLayout(), tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })

  let time = 0
  async function settle() {
    for (let tick = 0; tick < 8; tick++) {
      time += 800
      for (const step of [...frames.keys()]) {
        if (!step(time)) frames.delete(step)
      }
      await Promise.resolve()
    }
    expect(frames.size).toBe(0)
  }
  /** Draws one frame: runs every task once, as the stage's loop does. */
  function frame() {
    time += 16
    for (const step of [...frames.keys()]) {
      if (!step(time)) frames.delete(step)
    }
  }
  return { viewer, camera, controls, onNavigationChange, settle, frames, frame }
}

describe('building navigation', () => {
  it('keeps overview controls when Back interrupts entering a floor', async () => {
    const { viewer, controls, onNavigationChange, settle } = makeViewer()
    const cutaway = viewer.setMode('cutaway')
    await settle()
    await cutaway

    const entering = viewer.enterFloor('ground')
    const leaving = viewer.leaveFloor()
    await settle()
    await Promise.all([entering, leaving])

    expect(onNavigationChange).toHaveBeenLastCalledWith({ mode: 'cutaway' })
    expect(controls).toMatchObject({ enableZoom: true, enablePan: true, minDistance: 2 })
    expect(controls.maxDistance).toBeGreaterThan(1)
    viewer.dispose()
  })

  it('restores overview zoom and allows a new floor to supersede an unfinished exit', async () => {
    const { viewer, camera, controls, onNavigationChange, settle } = makeViewer()
    const entering = viewer.enterFloor('ground')
    await settle()
    await entering
    viewer.zoom(1)
    expect(camera.fov).toBe(26)

    const leaving = viewer.leaveFloor()
    const next = viewer.enterFloor('first')
    await settle()
    await Promise.all([leaving, next])
    expect(onNavigationChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'inside', floorId: 'first' }))
    expect(controls.enablePan).toBe(false)
    viewer.zoom(1)

    const exterior = viewer.setMode('exterior')
    await settle()
    await exterior
    expect(camera.fov).toBe(32)
    expect(controls.enablePan).toBe(true)
    viewer.dispose()
  })

  it('settles a transition when the viewer is disposed', async () => {
    const { viewer } = makeViewer()
    const transition = viewer.setMode('cutaway')
    viewer.dispose()
    await expect(transition).resolves.toBeUndefined()
  })
})

describe('building tap selection', () => {
  const point = (pointerId: number, clientX = 10, button = 0) => ({ pointerId, clientX, clientY: 10, button })

  it('accepts a primary tap and rejects a right click, a returning drag and a cancelled tap', () => {
    const taps = createTapTracker()
    taps.down(point(1))
    expect(taps.up(point(1, 12))).toBe(true)
    taps.down(point(1, 10, 2))
    expect(taps.up(point(1, 10, 2))).toBe(false)
    taps.down(point(1))
    taps.move(point(1, 30))
    expect(taps.up(point(1))).toBe(false)
    taps.down(point(1))
    taps.cancel(point(1))
    expect(taps.up(point(1))).toBe(false)
  })

  it('ignores both releases of a pinch and accepts the next single tap', () => {
    const taps = createTapTracker()
    taps.down(point(1))
    taps.down(point(2, 30))
    expect(taps.up(point(2, 30))).toBe(false)
    expect(taps.up(point(1))).toBe(false)
    taps.down(point(3))
    expect(taps.up(point(3))).toBe(true)
  })
})

describe('people and pets (step 3g)', () => {
  function withCat() {
    const layout = demoLayout()
    layout.floors[0]!.items.push({ id: 'cat-1', kind: 'cat', x: 200, y: 200, rotation: 0, ...FIGURE_SIZES.cat, finishes: {} })
    return { layout, tables: DEMO_TABLES, looks: BUILT_IN_LOOKS }
  }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('puts each model in its place and plays its idle loop only while Animate is on', async () => {
    const { viewer, frames, frame } = makeViewer()
    viewer.setScene(withCat())
    await flush()
    expect(modelLibrary.figure).toHaveBeenCalledWith('cat')
    expect(mixers).toHaveLength(1)
    expect(frames.size).toBe(1)
    frame()
    frame()
    expect(mixers[0]!.update).toHaveBeenCalled()

    viewer.setPlayback({ figures: true, animate: false })
    frame()
    expect(frames.size).toBe(0)
    viewer.setPlayback({ figures: true, animate: true })
    expect(frames.size).toBe(1)
    viewer.setPlayback({ figures: false, animate: true })
    frame()
    expect(frames.size).toBe(0)
    viewer.dispose()
    expect(modelLibrary.dispose).toHaveBeenCalled()
  })

  it('stops drawing every frame while the tab is hidden, and plays again when it is back', async () => {
    const { viewer, frames, frame } = makeViewer()
    viewer.setScene(withCat())
    await flush()
    let hidden = true
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    frame()
    expect(frames.size).toBe(0)
    hidden = false
    const view = document.defaultView as unknown as { Event: typeof Event }
    document.dispatchEvent(new view.Event('visibilitychange'))
    expect(frames.size).toBe(1)
    viewer.dispose()
  })

  it('drops a model that arrives after the scene was rebuilt, and stops the old loops', async () => {
    const { viewer } = makeViewer()
    viewer.setScene(withCat())
    viewer.setScene(withCat())
    await flush()
    // Two loads, but only the current scene's copy plays.
    expect(mixers).toHaveLength(2)
    viewer.setScene({ layout: demoLayout(), tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
    // The first scene's copy was never placed; the second one's loop stopped with its scene.
    expect(mixers[0]!.update).not.toHaveBeenCalled()
    expect(mixers[1]!.stopAllAction).toHaveBeenCalled()
    viewer.dispose()
  })
})
