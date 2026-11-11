import { Window } from 'happy-dom'
import { MeshBasicMaterial, PerspectiveCamera, Scene } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN_LOOKS } from '../designer/catalog'
import { createBuildingViewer } from '../designer/scene/building-viewer'
import type { BuildingNavigation } from '../designer/scene/building-viewer'
import { createBuildContext, disposeBuildContext } from '../designer/scene/furniture'
import { createStage } from '../designer/scene/stage'
import type { Stage } from '../designer/scene/stage'
import { createTapTracker } from '../designer/scene/tap-tracker'
import { demoLayout, DEMO_TABLES } from './demo-layout'

vi.mock(import('../designer/scene/stage'), async original => ({
  ...await original(),
  createStage: vi.fn(),
}))

afterEach(() => vi.unstubAllGlobals())

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
  return { viewer, camera, controls, onNavigationChange, settle }
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
