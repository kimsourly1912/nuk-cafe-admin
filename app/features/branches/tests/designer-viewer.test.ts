import { Window } from 'happy-dom'
import { Box3, BufferGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three'
import type { AnimationMixer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIGURE_SIZES } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS } from '../designer/catalog'
import { createBuildingViewer } from '../designer/scene/building-viewer'
import type { BuildingNavigation, BuildingViewerOptions } from '../designer/scene/building-viewer'
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

function makeViewer(extra: Partial<BuildingViewerOptions> = {}) {
  vi.stubGlobal('document', new Window().document)
  const camera = new PerspectiveCamera(32, 1)
  const canvas = document.createElement('canvas')
  const controls = new OrbitControls(camera, canvas)
  const scene = new Scene()
  const material = new MeshBasicMaterial()
  const highlight = new MeshBasicMaterial({ name: 'highlight' })
  const materials = { finish: () => material, surface: (key: string) => (key === 'highlight' ? highlight : material), tinted: () => material, setTheme: vi.fn(), dispose: () => material.dispose() }
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
    details: () => ({ calls: 0, triangles: 0, geometries: 0, textures: 0, pixelRatio: 1, width: 100, height: 100 }),
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
  const viewer = createBuildingViewer({ canvas, dark: false, onNavigationChange, ...extra })
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
  return { viewer, camera, controls, onNavigationChange, settle, frames, frame, stage, canvas, highlight }
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

describe('the surroundings (step 3h)', () => {
  const lane = (root: Scene) => root.children.find(child => child.name === 'surroundings')
  const disc = (root: Scene) => root.children.find(child => child instanceof Mesh && child.geometry.type === 'CircleGeometry')!

  it('stands the lane around the café: the ground disc goes, the sun\'s shadow stays on the café', () => {
    const { viewer, stage } = makeViewer()
    const shadow = vi.mocked(stage.fitShadows).mock.calls.at(-1)![0].clone()
    viewer.setSurroundings('neighborhood-lane', 'branch-1')
    expect(lane(stage.scene)).toBeDefined()
    expect(disc(stage.scene).visible).toBe(false)
    expect(vi.mocked(stage.fitShadows).mock.calls.at(-1)![0].equals(shadow)).toBe(true)
    // A rebuild of the building (a table moved) keeps the lane.
    viewer.setScene({ layout: demoLayout(), tables: DEMO_TABLES, looks: BUILT_IN_LOOKS })
    expect(lane(stage.scene)).toBeDefined()
    viewer.setSurroundings('none', 'branch-1')
    expect(lane(stage.scene)).toBeUndefined()
    expect(disc(stage.scene).visible).toBe(true)
    viewer.dispose()
  })

  it('fits the whole scene, and lets the camera zoom out that far', async () => {
    const { viewer, camera, controls, settle } = makeViewer()
    const distance = () => camera.position.distanceTo(controls.target)
    const fitting = viewer.fit()
    await settle()
    await fitting
    const building = distance()
    // Paused: the passer-by's walk would keep a frame task running past settle().
    viewer.setPlayback({ figures: true, animate: false })
    viewer.setSurroundings('neighborhood-lane', 'branch-1')
    expect(distance()).toBeCloseTo(building, 5)
    const scene = viewer.fit()
    await settle()
    await scene
    expect(distance()).toBeGreaterThan(building * 1.2)
    expect(controls.maxDistance).toBeGreaterThan(distance())
    viewer.dispose()
  })

  it('in the cutaway, hides the shophouses on the camera\'s side and shows them again outside it', async () => {
    const { viewer, camera, controls, settle, stage } = makeViewer()
    viewer.setPlayback({ figures: true, animate: false })
    viewer.setSurroundings('neighborhood-lane', 'branch-1')
    const cutaway = viewer.setMode('cutaway')
    await settle()
    await cutaway
    const beforeRender = vi.mocked(stage.onBeforeRender).mock.calls[0]![0]
    const blocks = lane(stage.scene)!.children[0]!.children.filter(child => child.name.startsWith('block:'))
    const center = new Box3().setFromObject(stage.scene.children.find(child => child.children.some(floor => floor.userData.floorId))!).getCenter(new Vector3())
    const block = blocks[0]!
    const blockCenter = new Box3().setFromObject(block).getCenter(new Vector3())
    // The camera looks at the café from that shophouse's side, then from the other side.
    camera.position.copy(center).add(blockCenter.clone().sub(center).setY(0).normalize().multiplyScalar(30)).setY(15)
    beforeRender()
    expect(block.visible).toBe(false)
    camera.position.copy(center).sub(blockCenter.clone().sub(center).setY(0).normalize().multiplyScalar(30)).setY(15)
    beforeRender()
    expect(block.visible).toBe(true)
    const exterior = viewer.setMode('exterior')
    await settle()
    await exterior
    camera.position.copy(center).add(blockCenter.clone().sub(center).setY(0).normalize().multiplyScalar(30)).setY(15)
    beforeRender()
    expect(block.visible).toBe(true)
    expect(controls).toBeDefined()
    viewer.dispose()
  })

  it('frees the old lane\'s geometries when it changes or goes', () => {
    const { viewer, stage } = makeViewer()
    const disposed = vi.spyOn(BufferGeometry.prototype, 'dispose')
    viewer.setSurroundings('neighborhood-lane', 'branch-1')
    const geometries = new Set<BufferGeometry>()
    lane(stage.scene)!.traverse(object => object instanceof Mesh && geometries.add(object.geometry))
    viewer.setSurroundings('neighborhood-lane', 'branch-2')
    const freed = new Set(disposed.mock.contexts as BufferGeometry[])
    expect([...geometries].every(geometry => freed.has(geometry))).toBe(true)
    disposed.mockRestore()
    viewer.dispose()
  })

  it('animates the passer-by only while people and pets are shown and Animate is on', () => {
    const { viewer, stage, frames, frame } = makeViewer()
    viewer.setSurroundings('neighborhood-lane', 'branch-1')
    const walker = () => lane(stage.scene)!.children[0]!.children.find(child => child.type === 'Group' && !child.name)!
    expect(frames.size).toBe(1)
    const start = walker().position.clone()
    for (let index = 0; index < 30; index++) frame()
    expect(walker().position.distanceTo(start)).toBeGreaterThan(0)
    viewer.setPlayback({ figures: false, animate: true })
    frame()
    expect(frames.size).toBe(0)
    expect(walker().visible).toBe(false)
    viewer.dispose()
  })
})

describe('the benchmark (step 3h)', () => {
  it('warms up, then times three full orbits frame by frame', async () => {
    const { viewer, frames, frame } = makeViewer()
    const phases: string[] = []
    const running = viewer.benchmark(phase => phases.push(phase))
    // 16 ms frames for 5 s of warm-up and 3 × 20 s of orbits, and a little more.
    for (let index = 0; index < 4200 && frames.size; index++) frame()
    const result = await running
    expect(phases).toEqual(['Warming up', 'Orbit 1 of 3', 'Orbit 2 of 3', 'Orbit 3 of 3'])
    expect(result!.runs).toHaveLength(3)
    for (const run of result!.runs) expect(run.length).toBeGreaterThan(1200)
    expect(result!.runs.flat().every(interval => interval === 16)).toBe(true)
    viewer.dispose()
  })

  it('stops, with no result, when the view changes during it', async () => {
    const { viewer, frame } = makeViewer()
    const running = viewer.benchmark()
    frame()
    void viewer.setMode('cutaway')
    frame()
    expect(await running).toBeNull()
    viewer.dispose()
  })
})

describe('picking a piece in 3D (step 3e)', () => {
  /** The demo building with a planter on the open rooftop and a cat beside it. */
  function withPieces() {
    const layout = demoLayout()
    const rooftop = layout.floors.find(floor => floor.id === 'rooftop')!
    rooftop.items.push({ id: 'probe', kind: 'planter', x: 300, y: 300, rotation: 0, width: 100, depth: 40, finishes: {}, height: 90 })
    rooftop.items.push({ id: 'cat-1', kind: 'cat', x: 500, y: 300, rotation: 0, ...FIGURE_SIZES.cat, finishes: {} })
    return { layout, tables: DEMO_TABLES, looks: BUILT_IN_LOOKS }
  }
  const objectOf = (scene: Scene, itemId: string) => {
    let found: Group | undefined
    scene.traverse(object => (object.userData.itemId === itemId ? (found = object as Group) : undefined))
    return found!
  }
  const lit = (object: Group, highlight: MeshBasicMaterial) => {
    const meshes: Mesh[] = []
    object.traverse(child => child instanceof Mesh && meshes.push(child))
    return meshes.filter(mesh => mesh.material === highlight).length
  }
  /** A tap in the middle of the canvas, with the camera straight above `target`. */
  function tapAbove(setup: ReturnType<typeof makeViewer>, target: Vector3) {
    const { camera, canvas } = setup
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    camera.position.set(target.x, target.y + 6, target.z + 0.001)
    camera.lookAt(target)
    camera.aspect = 1
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    const PointerEvent = document.defaultView!.PointerEvent
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 50, clientY: 50 }))
  }

  it('a tap on a piece selects it and lights the whole piece; a tap on nothing clears it', () => {
    const onSelectItem = vi.fn()
    const onSelectTable = vi.fn()
    const setup = makeViewer({ onSelectItem, onSelectTable })
    setup.viewer.setScene(withPieces())
    const probe = objectOf(setup.stage.scene, 'probe')
    tapAbove(setup, probe.getWorldPosition(new Vector3()))
    expect(onSelectItem).toHaveBeenLastCalledWith('probe')
    expect(onSelectTable).not.toHaveBeenCalled()
    expect(lit(probe, setup.highlight)).toBeGreaterThan(2)
    // Far off the building: nothing there, so the piece and any table are let go.
    tapAbove(setup, new Vector3(200, 0, 200))
    expect(onSelectItem).toHaveBeenLastCalledWith(null)
    expect(onSelectTable).toHaveBeenLastCalledWith(null)
    expect(lit(probe, setup.highlight)).toBe(0)
  })

  it('a figure lights up but its contact shadow doesn\'t', () => {
    const setup = makeViewer()
    setup.viewer.setPlayback({ figures: true, animate: false })
    setup.viewer.setScene(withPieces())
    setup.viewer.selectItem('cat-1')
    const cat = objectOf(setup.stage.scene, 'cat-1')
    const shadow = cat.children.find(child => child.userData.part === 'contact-shadow') as Mesh
    expect(lit(cat, setup.highlight)).toBeGreaterThan(2)
    expect(shadow.material).not.toBe(setup.highlight)
  })

  it('one selection at a time: a table replaces the piece, and clearing the other kind changes nothing', () => {
    const setup = makeViewer()
    setup.viewer.setScene(withPieces())
    const probe = objectOf(setup.stage.scene, 'probe')
    setup.viewer.selectItem('probe')
    // Design shop let go of a table it didn't have: the piece stays lit.
    setup.viewer.selectTable(null)
    expect(lit(probe, setup.highlight)).toBeGreaterThan(0)
    setup.viewer.selectTable(DEMO_TABLES[0]!.id)
    expect(lit(probe, setup.highlight)).toBe(0)
    setup.viewer.selectItem(null)
    let tableLit = 0
    setup.stage.scene.traverse(object => (object instanceof Mesh && object.material === setup.highlight ? tableLit++ : undefined))
    expect(tableLit).toBeGreaterThan(0)
  })

  it('keeps the piece selected when the scene is built again, and lets it go once the piece is gone', () => {
    const setup = makeViewer()
    const input = withPieces()
    setup.viewer.setScene(input)
    setup.viewer.selectItem('probe')
    const moved = structuredClone(input.layout)
    moved.floors.find(floor => floor.id === 'rooftop')!.items.find(item => item.id === 'probe')!.x = 400
    setup.viewer.setScene({ ...input, layout: moved })
    expect(lit(objectOf(setup.stage.scene, 'probe'), setup.highlight)).toBeGreaterThan(0)
    const without = structuredClone(moved)
    const rooftop = without.floors.find(floor => floor.id === 'rooftop')!
    rooftop.items = rooftop.items.filter(item => item.id !== 'probe')
    setup.viewer.setScene({ ...input, layout: without })
    // Put back: a deleted piece's selection doesn't come back with it.
    setup.viewer.setScene({ ...input, layout: moved })
    expect(lit(objectOf(setup.stage.scene, 'probe'), setup.highlight)).toBe(0)
  })
})
