import { CylinderGeometry, DoubleSide, Fog, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import type { Color, Object3D } from 'three'
import type { BuiltSurroundings, Stage, StageStats } from '~/features/branches'
import { BUILT_IN_LOOKS, loadSceneKit, summarizeFrames } from '~/features/branches'
import type { Actions } from './actions'
import { createActions } from './actions'
import { createAvatar } from './avatar'
import type { WalkReport } from './bench'
import { WALK_BENCHMARK } from './bench'
import type { FollowCamera } from './camera'
import { cameraPose, createFollowCamera, firstWall, HIDE_AVATAR_WITHIN, lookBy, updateFollow, worldMove } from './camera'
import type { District, DistrictInput, DoorInfo, SeatInfo } from './district'
import { buildDistrict, floorAt } from './district'
import { createFixedStep } from './fixed-step'
import type { Target } from './interaction'
import { chooseTarget } from './interaction'
import type { MapView } from './map-draw'
import type { MotorState } from './motor'
import { createMotor, MOTOR, stepMotor } from './motor'
import type { PlayerMode } from './player'
import { canWalk, nextMode, TRANSITIONS, WALKING } from './player'
import type { WalkGrid } from './route'
import { buildWalkGrid, findRoute } from './route'
import type { Vec2 } from './vec'
import { add, angleBetween, closestOnSegment, distance, facing, insidePolygon, length, normalize, sub } from './vec'
import { groundAt, isClear } from './walk-world'

/**
 * Explore's world (D275, docs/plans/explore.md → How it's built): the designer's stage and
 * builders (one renderer for the editor and Explore), the district's café and lane, the avatar,
 * the follow camera, the doors, and a loop that simulates in fixed steps and draws every frame
 * while visible and not paused. Vue sends commands and receives discrete events; positions,
 * camera and animation stay here.
 */

export interface Prompt {
  /** What the context button says ("Open door"). */
  label: string
  kind: Target['kind'] | 'stand'
}

export interface Status {
  /** Where the player is ("Demo café · Ground", "Street"). */
  place: string
  indoors: boolean
  seated: boolean
  waypoint: boolean
}

export interface ExploreEvents {
  prompt: (prompt: Prompt | null) => void
  status: (status: Status) => void
  firstFrame: () => void
  stats: (stats: StageStats) => void
  /** View drinks at the counter. */
  counter: () => void
  contextLost: () => void
}

export interface ExploreWorldOptions {
  canvas: HTMLCanvasElement
  dark: boolean
  reducedMotion: boolean
  district: DistrictInput
  events: ExploreEvents
}

export interface ExploreWorld {
  actions: Actions
  district: District
  /** Pauses the simulation and drawing (an overlay has focus); held input is cleared both ways. */
  setPaused: (paused: boolean) => void
  setTheme: (dark: boolean) => void
  setReducedMotion: (reduced: boolean) => void
  /** The waypoint on the café's door, or none. */
  setWaypoint: (on: boolean) => void
  mapView: () => MapView
  /** Called after every drawn frame (the minimap draws then). Returns the unsubscribe. */
  onFrame: (callback: () => void) => () => void
  /** Back to the street's spawn point (a stuck player's way out). */
  returnToStreet: () => void
  benchmark: (onProgress?: (phase: string) => void) => Promise<WalkReport | null>
  dispose: () => void
}

interface DoorState {
  info: DoorInfo
  pivot: Group | null
  /** The open angle's sign, so the leaf swings into the café. */
  sign: number
  angle: number
  target: number
}

interface Transition {
  seat: SeatInfo
  from: { position: Vec2, y: number, heading: number }
  to: { position: Vec2, y: number, heading: number }
  start: number
  duration: number
  sitting: boolean
}

const OPEN_ANGLE = Math.PI * 0.48
const DOOR_SPEED = 3.5
const REACH = { door: 1.6, seat: 1.3, counter: 1.9 }
const ROUTE_EVERY = 0.5

export async function createExploreWorld(options: ExploreWorldOptions): Promise<ExploreWorld> {
  const kit = await loadSceneKit()
  const { events } = options
  const district = buildDistrict(options.district)
  const { world } = district
  const startedAt = performance.now()
  let firstFrameMs: number | null = null

  const stage: Stage = kit.createStage({
    canvas: options.canvas,
    dark: options.dark,
    orbit: false,
    onStats: events.stats,
    onFirstFrame: () => {
      firstFrameMs = performance.now() - startedAt
      events.firstFrame()
    },
    onContextLost: events.contextLost,
  })
  const camera = stage.camera
  camera.fov = 60
  camera.near = 0.05
  camera.far = 180
  camera.updateProjectionMatrix()

  const own = kit.createBuildContext(stage.materials)
  let surroundings: BuiltSurroundings | null = null
  const disposables: { dispose: () => void }[] = []

  // The café, then the lane around it, on a wide ground fading into fog.
  const input = options.district
  const built = kit.buildScene(stage.context, { layout: input.layout, tables: input.tables, looks: input.looks ?? BUILT_IN_LOOKS })
  stage.scene.add(built.root)
  stage.registerLights(built.floors.flatMap(floor => floor.lights))
  stage.fitShadows(built.bounds)
  surroundings = kit.buildSurroundings(stage.materials, input.layout, 'neighborhood-lane', input.seed)
  if (surroundings) stage.scene.add(surroundings.root)
  const middle = { x: (district.bounds.minX + district.bounds.maxX) / 2, z: (district.bounds.minZ + district.bounds.maxZ) / 2 }
  const groundGeometry = new PlaneGeometry(320, 320).rotateX(-Math.PI / 2)
  own.geometries.set('explore:ground', groundGeometry)
  const ground = new Mesh(groundGeometry, stage.materials.surface('ground'))
  ground.position.set(middle.x, district.street - 0.03, middle.z)
  ground.receiveShadow = true
  stage.scene.add(ground)
  const fog = new Fog('#ffffff', 28, 95)
  stage.scene.fog = fog
  function setTheme(dark: boolean) {
    stage.setTheme(dark)
    fog.color.copy(stage.scene.background as Color)
  }
  setTheme(options.dark)

  // The avatar and its ground shadow.
  const avatar = createAvatar(own)
  stage.scene.add(avatar.root, avatar.shadow)

  // The waypoint's beacon: a soft column of light above the door's street side.
  const beaconMaterial = new MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide })
  disposables.push(beaconMaterial)
  const beaconGeometry = new CylinderGeometry(0.45, 0.45, 8, 24, 1, true)
  own.geometries.set('explore:beacon', beaconGeometry)
  const beacon = new Mesh(beaconGeometry, beaconMaterial)
  beacon.visible = false
  stage.scene.add(beacon)
  const door = district.doors[0] ?? null
  const waypointPoint = door ? add(door.mid, door.out, 0.9) : null
  if (waypointPoint) beacon.position.set(waypointPoint.x, district.street + 4, waypointPoint.z)

  const doors = new Map<string, DoorState>(district.doors.map(info => [info.id, { info, pivot: hinge(built.root, info, district), sign: 1, angle: 0, target: 0 }]))
  for (const state of doors.values()) state.sign = state.pivot?.userData.sign ?? 1

  // The route's grid: street and ground floor, doors passable.
  const grid: WalkGrid = buildWalkGrid(world, { bounds: district.bounds, doors: district.doors.map(entry => entry.id), level: district.street })

  const actions = createActions()
  const fixed = createFixedStep()
  let motor: MotorState = createMotor(district.spawn.position, district.spawn.y, district.spawn.heading)
  let previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
  let follow: FollowCamera = createFollowCamera(motor.heading)
  let mode: PlayerMode = WALKING
  let transition: Transition | null = null
  let seatedOn: SeatInfo | null = null
  let reducedMotion = options.reducedMotion
  let simTime = 0
  let clock = 0
  let last: number | null = null
  let running = false
  let paused = false
  let disposed = false
  let currentTarget: Target | null = null
  let promptKey = ''
  let statusKey = ''
  let waypoint = false
  let route: Vec2[] | null = null
  let routeAge = Infinity
  let autopilot: { points: Vec2[], index: number, direction: 1 | -1 } | null = null
  let frameTimes: number[] | null = null
  let lastFrameAt: number | null = null
  const frameCallbacks = new Set<() => void>()

  const targets = buildTargets(district)

  function emitPrompt() {
    let prompt: Prompt | null = null
    if (mode.kind === 'seated') prompt = { label: 'Stand up', kind: 'stand' }
    else if (mode.kind === 'walking' && currentTarget) prompt = { label: labelFor(currentTarget), kind: currentTarget.kind }
    const key = prompt ? `${prompt.kind}:${prompt.label}` : ''
    if (key !== promptKey) {
      promptKey = key
      events.prompt(prompt)
    }
  }

  function emitStatus() {
    const floor = floorAt(district, motor.position, motor.y)
    const status: Status = {
      place: floor ? `${district.name} · ${floor.name}` : 'Street',
      indoors: Boolean(floor),
      seated: mode.kind !== 'walking',
      waypoint,
    }
    const key = JSON.stringify(status)
    if (key !== statusKey) {
      statusKey = key
      events.status(status)
    }
  }

  function labelFor(target: Target): string {
    if (target.kind === 'door') return doors.get(target.id.slice(5))?.target ? 'Close door' : 'Open door'
    if (target.kind === 'seat') return 'Sit'
    return 'View drinks'
  }

  /** A door may close only once its doorway is clear of the player. */
  function doorwayClear(state: DoorState): boolean {
    const nearest = closestOnSegment(motor.position, state.info.a, state.info.b)
    return distance(nearest, motor.position) > MOTOR.radius + 0.08
  }

  function eligible(target: Target): boolean {
    if (target.kind === 'door') {
      const state = doors.get(target.id.slice(5))
      if (state?.target && !doorwayClear(state)) return false
    }
    // A clear line to just short of it: its own door leaf doesn't count as in the way.
    const gap = distance(motor.position, target.position)
    if (gap < 0.2) return true
    const end = add(motor.position, sub(target.position, motor.position), Math.max(0, 1 - 0.35 / gap))
    return firstWall(world, motor.position, end, motor.y + 0.4, motor.y + 1.4) === null
  }

  function interact() {
    if (mode.kind === 'seated' && seatedOn) {
      standUp(seatedOn)
      return
    }
    if (mode.kind !== 'walking' || !currentTarget) return
    // Checked again on activation: the target may have moved out of reach since it was offered.
    const target = chooseTarget(targets, viewer(), currentTarget.id, eligible)
    if (!target || target.id !== currentTarget.id) return
    if (target.kind === 'door') toggleDoor(target.id.slice(5))
    else if (target.kind === 'seat') sitDown(district.seats.find(seat => `seat:${seat.id}` === target.id)!)
    else events.counter()
  }

  function toggleDoor(id: string) {
    const state = doors.get(id)
    if (!state) return
    if (state.target) {
      if (!doorwayClear(state)) return
      state.target = 0
      world.openDoors.delete(id)
    }
    else {
      state.target = OPEN_ANGLE * state.sign
      world.openDoors.add(id)
    }
  }

  function sitDown(seat: SeatInfo) {
    const next = nextMode(mode, { type: 'sit', seatId: seat.id, now: simTime })
    if (next === mode) return
    mode = next
    motor.velocity = { x: 0, z: 0 }
    transition = {
      seat,
      from: { position: { ...motor.position }, y: motor.y, heading: motor.heading },
      to: { position: seat.position, y: seat.y, heading: seat.yaw },
      start: simTime,
      duration: reducedMotion ? 0.01 : TRANSITIONS.sit,
      sitting: true,
    }
  }

  function standUp(seat: SeatInfo) {
    const next = nextMode(mode, { type: 'stand', now: simTime })
    if (next === mode) return
    mode = next
    const spot = standSpot(seat)
    transition = {
      seat,
      from: { position: seat.position, y: seat.y, heading: seat.yaw },
      to: { position: spot, y: seat.y, heading: seat.yaw },
      start: simTime,
      duration: reducedMotion ? 0.01 : TRANSITIONS.stand,
      sitting: false,
    }
  }

  /** In front of the seat, else beside or behind it: the first spot a body fits. */
  function standSpot(seat: SeatInfo): Vec2 {
    const ahead = facing(seat.yaw)
    for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const direction = facing(seat.yaw + turn)
      for (const reach of [0.6, 0.8]) {
        const spot = add(seat.position, direction, reach)
        if (isClear(world, spot, seat.y, MOTOR.radius, MOTOR.height)) return spot
      }
    }
    return add(seat.position, ahead, 0.6)
  }

  function finishTransition() {
    if (!transition) return
    const ended = transition
    transition = null
    if (ended.sitting) {
      seatedOn = ended.seat
      motor.position = { ...ended.to.position }
      motor.y = ended.to.y
      motor.heading = ended.to.heading
      avatar.sit(1, ended.seat.seat)
    }
    else {
      seatedOn = null
      motor = createMotor(ended.to.position, groundAt(world, ended.to.position, ended.to.y) ?? ended.to.y, ended.to.heading)
      avatar.sit(0, ended.seat.seat)
    }
  }

  function viewer() {
    return { position: motor.position, y: motor.y, heading: motor.heading }
  }

  function simulate(dt: number) {
    simTime += dt
    const look = actions.takeLook()
    lookBy(follow, look.x, look.y)
    if (actions.take('camera')) follow.far = !follow.far
    const jump = actions.take('jump')
    const pressed = actions.take('interact')

    // A transition ends with its animation or, at the latest, at its deadline.
    if (transition) {
      const progress = Math.min(1, (simTime - transition.start) / transition.duration)
      const eased = 1 - (1 - progress) ** 3
      motor.position = { x: transition.from.position.x + (transition.to.position.x - transition.from.position.x) * eased, z: transition.from.position.z + (transition.to.position.z - transition.from.position.z) * eased }
      motor.y = transition.from.y + (transition.to.y - transition.from.y) * eased
      motor.heading = transition.from.heading + angleBetween(transition.from.heading, transition.to.heading) * eased
      avatar.sit(transition.sitting ? eased : 1 - eased, transition.seat.seat)
      if (progress >= 1) {
        mode = nextMode(mode, { type: 'finished' })
        finishTransition()
      }
    }
    const before = mode
    mode = nextMode(mode, { type: 'tick', now: simTime })
    if (mode !== before) finishTransition()

    const floor = floorAt(district, motor.position, motor.y)
    if (canWalk(mode)) {
      let move = worldMove(follow.yaw, actions.move())
      let sprint = actions.sprint()
      if (autopilot) {
        const goal = autopilot.points[autopilot.index]!
        if (distance(goal, motor.position) < 0.45) {
          const next = autopilot.index + autopilot.direction
          if (next < 0 || next >= autopilot.points.length) autopilot.direction = autopilot.direction === 1 ? -1 : 1
          autopilot.index = Math.max(0, Math.min(autopilot.points.length - 1, autopilot.index + autopilot.direction))
        }
        move = normalize(sub(autopilot.points[autopilot.index]!, motor.position))
        sprint = false
      }
      stepMotor(world, motor, { move, sprint, jump, indoors: Boolean(floor) }, dt)
    }
    updateFollow(follow, dt, { heading: motor.heading, moving: length(motor.velocity) > 0.3, indoors: Boolean(floor), reducedMotion })

    currentTarget = mode.kind === 'walking' ? chooseTarget(targets, viewer(), currentTarget?.id ?? null, eligible) : null
    if (pressed) interact()

    // The waypoint clears once the player is inside its café.
    if (waypoint && floor) setWaypoint(false)
    routeAge += dt
    if (waypoint && waypointPoint && routeAge >= ROUTE_EVERY) {
      routeAge = 0
      route = findRoute(grid, motor.position, waypointPoint)
    }
    emitPrompt()
    emitStatus()
  }

  function frame(now: number): boolean {
    if (disposed || paused) {
      running = false
      return false
    }
    const elapsed = last === null ? 0 : (now - last) / 1000
    last = now
    clock += Math.min(elapsed, 0.1)
    if (frameTimes && lastFrameAt !== null) frameTimes.push(now - lastFrameAt)
    lastFrameAt = now
    const alpha = fixed.advance(elapsed, (dt) => {
      previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
      simulate(dt)
    })
    // Drawn between the last two steps, so a 120 Hz screen moves smoothly too.
    const x = previous.x + (motor.position.x - previous.x) * alpha
    const y = previous.y + (motor.y - previous.y) * alpha
    const z = previous.z + (motor.position.z - previous.z) * alpha
    avatar.root.position.set(x, y, z)
    avatar.root.rotation.y = motor.heading
    if (mode.kind === 'walking') avatar.locomotion(motor.grounded ? length(motor.velocity) : 0, motor.grounded, Math.min(elapsed, 0.1))
    const shadowGround = groundAt(world, { x, z }, y) ?? y
    avatar.shadow.position.set(x, shadowGround + 0.012, z)

    const floor = floorAt(district, motor.position, motor.y)
    const pose = cameraPose(follow, { world, feet: { x, y, z }, ceiling: floor?.ceiling ?? null })
    camera.position.set(pose.position.x, pose.position.y, pose.position.z)
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z)
    // A wall right behind pulls the camera to the character's head: hide the avatar there rather
    // than look out from inside it.
    const head = Math.hypot(pose.position.x - x, pose.position.y - (y + 1.55), pose.position.z - z)
    avatar.root.visible = head > HIDE_AVATAR_WITHIN

    let doorsMoving = false
    for (const state of doors.values()) {
      if (!state.pivot || state.angle === state.target) continue
      const delta = state.target - state.angle
      const step = reducedMotion ? Math.abs(delta) : DOOR_SPEED * Math.min(elapsed, 0.1)
      state.angle = Math.abs(delta) <= step ? state.target : state.angle + Math.sign(delta) * step
      state.pivot.rotation.y = state.angle
      doorsMoving = true
      if (state.angle === state.target) stage.shadowsChanged()
    }
    if (doorsMoving) stage.shadowsChanged()
    surroundings?.idle(clock)
    for (const figure of built.figures) figure.idle(clock)
    if (beacon.visible && waypointPoint) {
      // It guides from afar; up close it fades away instead of tinting the view.
      const near = Math.max(0, Math.min(1, (distance(motor.position, waypointPoint) - 1.5) / 5))
      beaconMaterial.opacity = (reducedMotion ? 0.22 : 0.16 + Math.sin(clock * 2.4) * 0.06) * near
    }
    for (const callback of frameCallbacks) callback()
    return true
  }

  function start() {
    if (running || disposed || paused || document.visibilityState === 'hidden') return
    running = true
    last = null
    lastFrameAt = null
    fixed.reset()
    stage.animate(frame, () => {
      running = false
    })
  }

  function setPaused(next: boolean) {
    if (paused === next) return
    paused = next
    actions.clear()
    if (!next) start()
    else stage.invalidate()
  }

  function visibility() {
    if (document.visibilityState === 'hidden') actions.clear()
    else start()
  }
  document.addEventListener('visibilitychange', visibility)

  function setWaypoint(on: boolean) {
    waypoint = on && Boolean(waypointPoint)
    beacon.visible = waypoint
    route = null
    routeAge = Infinity
    emitStatus()
  }

  function returnToStreet() {
    transition = null
    seatedOn = null
    mode = WALKING
    avatar.sit(0, 0.46)
    motor = createMotor(district.spawn.position, district.spawn.y, district.spawn.heading)
    previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
    follow = createFollowCamera(motor.heading)
    actions.clear()
    routeAge = Infinity
    emitStatus()
    emitPrompt()
  }

  async function benchmark(onProgress?: (phase: string) => void): Promise<WalkReport | null> {
    const counterSpot = district.counter?.position
    const path = counterSpot ? findRoute(grid, district.spawn.position, counterSpot) : null
    if (!path) return null
    returnToStreet()
    // Every door open, so the walk never stops at one.
    for (const [id, state] of doors) {
      state.target = OPEN_ANGLE * state.sign
      world.openDoors.add(id)
    }
    autopilot = { points: path, index: 1, direction: 1 }
    const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
    onProgress?.('Warming up')
    await wait(WALK_BENCHMARK.warmUpMs)
    const runs: number[][] = []
    for (let run = 0; run < WALK_BENCHMARK.runs && !disposed; run++) {
      onProgress?.(`Walk ${run + 1} of ${WALK_BENCHMARK.runs}`)
      frameTimes = []
      await wait(WALK_BENCHMARK.runMs)
      runs.push(frameTimes)
    }
    frameTimes = null
    autopilot = null
    if (disposed) return null
    const details = stage.details()
    return {
      runs: runs.map(summarizeFrames),
      all: summarizeFrames(runs.flat()),
      quality: stage.quality(),
      pixelRatio: details.pixelRatio,
      canvas: { width: details.width, height: details.height },
      renderer: { calls: details.calls, triangles: details.triangles, geometries: details.geometries, textures: details.textures },
      firstFrameMs,
      userAgent: navigator.userAgent,
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    document.removeEventListener('visibilitychange', visibility)
    frameCallbacks.clear()
    actions.clear()
    if (surroundings) {
      surroundings.root.removeFromParent()
      kit.disposeBuildContext(surroundings.context)
    }
    kit.disposeBuildContext(own)
    for (const item of disposables) item.dispose()
    stage.dispose()
  }

  stage.measure()
  start()
  emitStatus()
  emitPrompt()

  return {
    actions,
    district,
    setPaused,
    setTheme,
    setReducedMotion: (reduced) => {
      reducedMotion = reduced
    },
    setWaypoint,
    mapView: () => ({ player: { position: motor.position, heading: motor.heading }, cameraYaw: follow.yaw, route, waypoint: waypoint ? waypointPoint : null }),
    onFrame: (callback) => {
      frameCallbacks.add(callback)
      return () => frameCallbacks.delete(callback)
    },
    returnToStreet,
    benchmark,
    dispose,
  }
}

/** Doors, seats and the counter as context-button targets. */
function buildTargets(district: District): Target[] {
  const targets: Target[] = district.doors.map(door => ({ id: `door:${door.id}`, kind: 'door', position: door.mid, y: door.y, reach: REACH.door }))
  for (const seat of district.seats) targets.push({ id: `seat:${seat.id}`, kind: 'seat', position: seat.position, y: seat.y, reach: REACH.seat })
  if (district.counter) {
    // The counter's own edge, so facing the counter is what offers it.
    targets.push({ id: 'counter', kind: 'counter', position: add(district.counter.position, facing(district.counter.yaw), 0.45), y: district.counter.y, reach: REACH.counter })
  }
  return targets
}

/**
 * Puts a door's leaf and handle on a hinge at the leaf's end, turning into the café. The designer
 * draws them closed and names their door (`userData.doorId`). Null when the door has no leaf.
 */
function hinge(root: Object3D, door: DoorInfo, district: District): Group | null {
  const parts: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && object.userData.doorId === door.id) parts.push(object)
  })
  const leaf = parts.reduce<Mesh | null>((largest, mesh) => {
    mesh.geometry.computeBoundingBox()
    const size = mesh.geometry.boundingBox!.getSize(new Vector3())
    return !largest || size.x * size.y > largest.geometry.boundingBox!.getSize(new Vector3()).x * largest.geometry.boundingBox!.getSize(new Vector3()).y ? mesh : largest
  }, null)
  const parent = leaf?.parent
  if (!leaf || !parent) return null
  const width = leaf.geometry.boundingBox!.max.x - leaf.geometry.boundingBox!.min.x
  const pivot = new Group()
  pivot.position.set(leaf.position.x - width / 2, 0, leaf.position.z)
  parent.add(pivot)
  for (const mesh of parts) {
    mesh.position.sub(pivot.position)
    pivot.add(mesh)
  }
  // Which way is into the café: try one way and see where the leaf's middle lands.
  const outline = district.floors[0]?.outline ?? []
  pivot.rotation.y = OPEN_ANGLE
  pivot.updateMatrixWorld(true)
  const middle = leaf.getWorldPosition(new Vector3())
  pivot.userData.sign = insidePolygon({ x: middle.x, z: middle.z }, outline) ? 1 : -1
  pivot.rotation.y = 0
  pivot.updateMatrixWorld(true)
  return pivot
}
