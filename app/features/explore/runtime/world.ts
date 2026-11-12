import { BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Fog, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three'
import type { Color, Object3D } from 'three'
import type { BuildContext, BuiltScene, BuiltSurroundings, Stage, StageStats } from '~/features/branches'
import { BUILT_IN_LOOKS, loadSceneKit, summarizeFrames } from '~/features/branches'
import type { Actions } from './actions'
import { createActions } from './actions'
import { createAvatar } from './avatar'
import type { WalkReport } from './bench'
import { WALK_BENCHMARK } from './bench'
import type { CameraPose, FollowCamera } from './camera'
import { cameraPose, createFollowCamera, firstWall, HIDE_AVATAR_WITHIN, lookBy, updateFollow, worldMove } from './camera'
import type { District, DistrictInput, DoorInfo, GatewayInfo, SeatInfo } from './district'
import { buildDistrict, floorAt, GATEWAY_HEIGHT } from './district'
import { createFixedStep } from './fixed-step'
import type { Target } from './interaction'
import { chooseTarget } from './interaction'
import type { MapView } from './map-draw'
import type { MotorState } from './motor'
import { createMotor, MOTOR, stepMotor } from './motor'
import type { MotoPose, MotoState } from './moto'
import { createMoto, MOTO, motoDismount, motoFits, nearestMotoCurb, stepMoto } from './moto'
import { createMotoModel } from './moto-model'
import type { NetworkBranch } from './network'
import { neighboursOf, sideToward } from './network'
import type { PlayerMode } from './player'
import { canWalk, nextMode, TRANSITIONS, WALKING } from './player'
import type { Ride, RideCourse, RideEvent, RideStop, VehiclePose } from './ride'
import { IDLE_RIDE, nextRide, RIDE_TIMING, rideCanCancel, rideOwnsPlayer, routePose, vehiclePose } from './ride'
import type { PassengerView } from './ride-camera'
import { lookFromSeat, passengerCamera } from './ride-camera'
import type { PassengerPose } from './ride-player'
import { passengerCurb, rideDoor, riderPose, safeRideCurb } from './ride-player'
import type { WalkGrid } from './route'
import { buildWalkGrid, findRoute } from './route'
import { createTukTuk } from './tuk-tuk'
import type { Vec2 } from './vec'
import { add, angleBetween, closestOnSegment, distance, facing, insidePolygon, length, normalize, sub, yawOf } from './vec'
import type { Solid } from './walk-world'
import { groundAt, isClear } from './walk-world'

/**
 * Explore's world (D275, docs/plans/explore.md → How it's built): the designer's stage and
 * builders (one renderer for the editor and Explore), the current district's café and lane, the
 * avatar, the follow camera, the doors, and a loop that simulates in fixed steps and draws every
 * frame while visible and not paused. Vue sends commands and receives discrete events; positions,
 * camera and animation stay here.
 *
 * Step E4: the cafe's published branches are districts joined by gateways (`network`). Only the
 * current district is in memory: crossing a gateway, on foot or in the tuk-tuk, loads the next one
 * first and swaps it in on the same renderer, then frees the one left behind. A failed load keeps
 * the player where they were (on foot: Retry or Go back; riding: held before the gateway).
 */

export interface Prompt {
  /** What the context button says ("Open door"). */
  label: string
  kind: Target['kind'] | 'stand'
}

interface RideHud {
  label: string | null
  canCall: boolean
  canCancel: boolean
  canSkip: boolean
  /** Held before a gateway that didn't load: Retry offered. */
  canRetry: boolean
  view: 'inside' | 'outside' | null
}

export interface Status {
  /** The district's branch (`DEMO_PLACE` for the demo street). */
  placeId: string
  /** The district's café. */
  district: string
  /** Where the player is ("Demo café · Ground", "Street"). */
  place: string
  indoors: boolean
  seated: boolean
  moto: boolean
  /** The waypoint's café, or null. */
  waypoint: string | null
  /** Its branch (`DEMO_PLACE` on the demo street). */
  waypointId: string | null
  /** Walking through a gateway: loading the next district, or failed to. */
  crossing: { name: string, failed: boolean } | null
  ride: RideHud
}

export interface ExploreEvents {
  prompt: (prompt: Prompt | null) => void
  status: (status: Status) => void
  firstFrame: () => void
  stats: (stats: StageStats) => void
  /** View drinks at the counter, of this district's branch. */
  counter: (placeId: string) => void
  chooseRide: () => void
  contextLost: () => void
}

export interface ExploreNetwork {
  /** The published branches in gateway order (`branchChain`). */
  chain: readonly NetworkBranch[]
  /** A branch's district; rejects when it can't be loaded (withdrawn, offline). */
  load: (branchId: string) => Promise<DistrictInput>
}

export interface ExploreWorldOptions {
  canvas: HTMLCanvasElement
  dark: boolean
  reducedMotion: boolean
  /** The first district, and its branch (`DEMO_PLACE` for the demo). */
  district: DistrictInput
  placeId: string
  /** Where the player starts: across the street (default) or at the counter (Back to café). */
  start?: 'street' | 'counter'
  network?: ExploreNetwork
  events: ExploreEvents
}

export interface RideStopOption {
  id: string
  label: string
  seconds: number
  /** Another branch: through a gateway. */
  branchId?: string
}

export interface ExploreWorld {
  actions: Actions
  /** The current district (it changes at a gateway: read it again on `status.placeId`). */
  district: () => District
  rideStops: () => RideStopOption[]
  rideAction: (event: { type: 'call', stopId?: string } | { type: 'cancel' | 'skip' | 'retry' } | { type: 'confirm', id: string }) => boolean
  /** Pauses the simulation and drawing (an overlay has focus); held input is cleared both ways. */
  setPaused: (paused: boolean) => void
  setTheme: (dark: boolean) => void
  setReducedMotion: (reduced: boolean) => void
  /** The waypoint on a branch's café (this district's, or the gateway toward another), or none. */
  setWaypoint: (placeId: string | null) => void
  mapView: () => MapView
  /** Called after every drawn frame (the minimap draws then). Returns the unsubscribe. */
  onFrame: (callback: () => void) => () => void
  /** Back to the street's spawn point (a stuck player's way out). */
  returnToStreet: () => void
  resetMoto: () => void
  /** A walk through a gateway that failed to load: try again, or step back from the arch. */
  retryCrossing: () => void
  cancelCrossing: () => void
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

/** Everything that belongs to one district: built on loading, freed when the player leaves it. */
interface Place {
  id: string
  district: District
  built: BuiltScene
  context: BuildContext
  surroundings: BuiltSurroundings | null
  arches: Group
  disposables: { dispose: () => void }[]
  doors: Map<string, DoorState>
  grid: WalkGrid
  course: RideCourse
  pickupVehicle: VehiclePose
  pickup: PassengerPose
  rideTarget: Target
  vehicleSolid: Extract<Solid, { shape: 'box' }>
  targets: Target[]
  moto: MotoState | null
  motoParking: MotoPose | null
  motoCurb: MotoPose | null
  motoTarget: Target
  motoSolid: Extract<Solid, { shape: 'box' }>
}

const OPEN_ANGLE = Math.PI * 0.48
const DOOR_SPEED = 3.5
const REACH = { door: 1.6, seat: 1.3, counter: 1.9, gateway: 4 }
const ROUTE_EVERY = 0.5
/** Where the tuk-tuk's trip to another branch is offered, as `branch:<id>`. */
const branchStop = (id: string) => `branch:${id}`

export async function createExploreWorld(options: ExploreWorldOptions): Promise<ExploreWorld> {
  const kit = await loadSceneKit()
  const { events, network } = options
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
  const disposables: { dispose: () => void }[] = []

  // A wide ground under every district, fading into fog.
  const groundGeometry = new PlaneGeometry(320, 320).rotateX(-Math.PI / 2)
  own.geometries.set('explore:ground', groundGeometry)
  const ground = new Mesh(groundGeometry, stage.materials.surface('ground'))
  ground.receiveShadow = true
  stage.scene.add(ground)
  const fog = new Fog('#ffffff', 28, 95)
  stage.scene.fog = fog
  function setTheme(dark: boolean) {
    stage.setTheme(dark)
    fog.color.copy(stage.scene.background as Color)
  }
  setTheme(options.dark)

  // The avatar and its ground shadow, the tuk-tuk and its pickup marker: kept across districts.
  const avatar = createAvatar(own)
  const motoModel = createMotoModel(own)
  stage.scene.add(motoModel.root)
  stage.scene.add(avatar.root, avatar.shadow)
  const tukTuk = createTukTuk(own)
  tukTuk.root.visible = false
  stage.scene.add(tukTuk.root)
  const pickupMarker = new Mesh(
    new CylinderGeometry(0.43, 0.43, 0.045, 16),
    stage.materials.surface('highlight'),
  )
  own.geometries.set('explore:pickup', pickupMarker.geometry)
  pickupMarker.visible = false
  stage.scene.add(pickupMarker)

  // The waypoint's beacon: a soft column of light above the waypoint (a café's door or a gateway).
  const beaconMaterial = new MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide })
  disposables.push(beaconMaterial)
  const beaconGeometry = new CylinderGeometry(0.45, 0.45, 8, 24, 1, true)
  own.geometries.set('explore:beacon', beaconGeometry)
  const beacon = new Mesh(beaconGeometry, beaconMaterial)
  beacon.visible = false
  stage.scene.add(beacon)

  /** Builds a district and everything of its own, without showing it yet. */
  function buildPlace(input: DistrictInput, id: string): Place {
    const gateways = network ? neighboursOf(network.chain, id).map(entry => ({ side: entry.side, branchId: entry.branch.id, name: entry.branch.name })) : []
    const district = buildDistrict({ ...input, gateways })
    const context = kit.createBuildContext(stage.materials)
    const built = kit.buildScene(context, { layout: input.layout, tables: input.tables, looks: input.looks ?? BUILT_IN_LOOKS, itemLooks: input.itemLooks })
    const surroundings = kit.buildSurroundings(stage.materials, input.layout, 'neighborhood-lane', input.seed)
    const placeDisposables: { dispose: () => void }[] = []
    const arches = buildArches(district.gateways, district.street, context, placeDisposables)
    const doors = new Map<string, DoorState>(district.doors.map(info => [info.id, { info, pivot: hinge(built.root, info, district), sign: 1, angle: 0, target: 0 }]))
    for (const state of doors.values()) state.sign = state.pivot?.userData.sign ?? 1
    // The route's grid: street and ground floor, doors passable.
    const grid = buildWalkGrid(district.world, { bounds: district.bounds, doors: district.doors.map(entry => entry.id), level: district.street })
    // The tuk-tuk goes to this street's two curbs, and to every other branch through a gateway.
    const remote: RideStop[] = []
    for (const branch of network?.chain ?? []) {
      const side = sideToward(network!.chain, id, branch.id)
      if (side && district.gateways.some(gateway => gateway.side === side)) remote.push({ id: branchStop(branch.id), label: branch.name, route: district.rideLegs[side].out, branchId: branch.id })
    }
    const course: RideCourse = { ...district.rideCourse, stops: [...district.rideCourse.stops, ...remote] }
    const pickupVehicle = routePose(course.approach, course.approach.duration)
    const pickup = safeRideCurb(district.world, pickupVehicle, district.street) ?? { ...passengerCurb(pickupVehicle), y: district.street, heading: 0, seated: 0 }
    const vehicleSolid: Extract<Solid, { shape: 'box' }> = {
      shape: 'box', center: pickupVehicle.position, halfWidth: 0.72, halfDepth: 1.44,
      rotation: 0, bottom: district.street, top: district.street + 1.85,
    }
    const rideTarget: Target = { id: 'tuk-tuk', kind: 'ride', position: pickup, y: pickup.y, reach: 2.5, anyFacing: true }
    const ground = { world: district.world, road: district.moto.road, street: district.street }
    const fits = (pose: MotoPose) => motoFits(ground, pose)
      && motoDismount(ground, pose, nearestMotoCurb(pose.position, district.moto.curbs))
    const motoParking = district.moto.parking.find(fits) ?? null
    const motoCurb = district.moto.recovery.find(fits) ?? motoParking
    const moto = motoParking && createMoto(motoParking)
    const motoTarget: Target = { id: 'moto', kind: 'moto', position: moto?.position ?? district.spawn.position, y: district.street, reach: 1.6 }
    const motoSolid: Place['motoSolid'] = { shape: 'box', center: motoTarget.position, halfWidth: 0.27, halfDepth: 0.9, rotation: 0, bottom: district.street, top: district.street + 1.2 }
    const place = { id, district, built, context, surroundings, arches, disposables, doors, grid, course, pickupVehicle, pickup, rideTarget, vehicleSolid, moto, motoParking, motoCurb, motoTarget, motoSolid, targets: [...buildTargets(district), rideTarget, motoTarget] }
    updateParkedMoto(place, true)
    return place
  }

  function showPlace(place: Place) {
    stage.scene.add(place.built.root, place.arches)
    if (place.surroundings) stage.scene.add(place.surroundings.root)
    stage.registerLights(place.built.floors.flatMap(floor => floor.lights))
    stage.fitShadows(place.built.bounds)
    const { bounds, street } = place.district
    ground.position.set((bounds.minX + bounds.maxX) / 2, street - 0.03, (bounds.minZ + bounds.maxZ) / 2)
    pickupMarker.position.set(place.pickup.x, place.pickup.y + 0.035, place.pickup.z)
    stage.shadowsChanged()
  }

  function freePlace(place: Place) {
    place.built.root.removeFromParent()
    place.arches.removeFromParent()
    kit.disposeBuildContext(place.context)
    for (const item of place.disposables) item.dispose()
    if (place.surroundings) {
      place.surroundings.root.removeFromParent()
      kit.disposeBuildContext(place.surroundings.context)
    }
  }

  let here = buildPlace(options.district, options.placeId)
  showPlace(here)

  const actions = createActions()
  const fixed = createFixedStep()
  const spawnAt = (place: Place) => {
    const counter = place.district.counter
    return options.start === 'counter' && counter ? { position: counter.position, y: counter.y, heading: counter.yaw } : place.district.spawn
  }
  const start = spawnAt(here)
  let motor: MotorState = createMotor(start.position, start.y, start.heading)
  let previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
  let follow: FollowCamera = createFollowCamera(motor.heading)
  let mode: PlayerMode = WALKING
  let motoRiding = false
  let motoTransition: { from: PassengerPose, to: PassengerPose, elapsed: number } | null = null
  let transition: Transition | null = null
  let seatedOn: SeatInfo | null = null
  let reducedMotion = options.reducedMotion
  let simTime = 0
  let clock = 0
  let last: number | null = null
  let running = false
  let paused = false
  let disposed = false
  let ride: Ride = IDLE_RIDE
  let vehicle: VehiclePose | null = null
  let previousVehicle: VehiclePose | null = null
  let distanceDriven = 0
  const passengerView: PassengerView = { outside: false, yaw: 0, pitch: 0 }
  let boardFrom: PassengerPose = { ...motor.position, y: motor.y, heading: motor.heading, seated: 0 }
  let exitTo: PassengerPose | null = null
  let cameraBlendFrom: CameraPose | null = null
  let cameraBlendElapsed = 0
  let lastCameraPose: CameraPose | null = null
  let currentTarget: Target | null = null
  let promptKey = ''
  let statusKey = ''
  let waypoint: string | null = null
  let route: Vec2[] | null = null
  let routeAge = Infinity
  let crossing: { gateway: GatewayInfo, failed: boolean } | null = null
  /** Bumped by every load, so a late answer for an abandoned one is ignored. */
  let loadToken = 0
  let autopilot: { points: Vec2[], index: number, direction: 1 | -1 } | null = null
  let frameTimes: number[] | null = null
  let lastFrameAt: number | null = null
  const frameCallbacks = new Set<() => void>()

  /** A branch's name: this district's café, or one along the chain. */
  function nameOf(id: string): string {
    if (id === here.id) return here.district.name
    return network?.chain.find(branch => branch.id === id)?.name ?? here.district.name
  }

  /** The waypoint's spot in this district: the café's door, or the gateway toward its district. */
  function waypointPoint(): Vec2 | null {
    if (!waypoint) return null
    if (waypoint === here.id) {
      const door = here.district.entrance
      return door ? add(door.mid, door.out, 0.9) : null
    }
    const side = network ? sideToward(network.chain, here.id, waypoint) : null
    return here.district.gateways.find(gateway => gateway.side === side)?.position ?? null
  }

  function placeBeacon() {
    const point = waypointPoint()
    beacon.visible = Boolean(point)
    if (point) beacon.position.set(point.x, here.district.street + 4, point.z)
  }

  function emitPrompt() {
    let prompt: Prompt | null = null
    if (ride.phase === 'stopped' || ride.phase === 'held') prompt = { label: 'Exit', kind: 'ride' }
    else if (rideOwnsPlayer(ride) || crossing || motoTransition) prompt = null
    else if (motoRiding && currentTarget) prompt = { label: labelFor(currentTarget), kind: currentTarget.kind }
    else if (motoRiding && landingSpot()) prompt = { label: 'Get off', kind: 'moto' }
    else if (mode.kind === 'seated') prompt = { label: 'Stand up', kind: 'stand' }
    else if (mode.kind === 'walking' && currentTarget) prompt = { label: labelFor(currentTarget), kind: currentTarget.kind }
    const key = prompt ? `${prompt.kind}:${prompt.label}` : ''
    if (key !== promptKey) {
      promptKey = key
      events.prompt(prompt)
    }
  }

  function emitStatus() {
    const floor = floorAt(here.district, motor.position, motor.y)
    const status: Status = {
      placeId: here.id,
      district: here.district.name,
      place: floor ? `${here.district.name} · ${floor.name}` : 'Street',
      indoors: Boolean(floor),
      seated: mode.kind !== 'walking' || rideOwnsPlayer(ride) || motoRiding,
      moto: motoRiding,
      waypoint: waypoint ? nameOf(waypoint) : null,
      waypointId: waypoint,
      crossing: crossing ? { name: crossing.gateway.name, failed: crossing.failed } : null,
      ride: rideHud(),
    }
    const key = JSON.stringify(status)
    if (key !== statusKey) {
      statusKey = key
      events.status(status)
    }
  }

  function rideHud(): RideHud {
    let label: string | null = null
    if (ride.phase === 'approaching') label = 'Tuk-tuk arriving'
    if (ride.phase === 'waiting') label = ride.stop ? `To ${ride.stop.label}` : 'Meet your driver at the pickup'
    if (ride.phase === 'boarding') label = 'Getting in…'
    if (ride.phase === 'travelling') label = `Riding to ${ride.stop.label}`
    if (ride.phase === 'crossing') label = `Riding to ${ride.stop.label}`
    if (ride.phase === 'held') label = `Can't reach ${ride.stop.label} right now`
    if (ride.phase === 'stopped') label = `Arrived · ${ride.stop.label}`
    if (ride.phase === 'exiting') label = 'Getting out…'
    return {
      label,
      canCall: ride.phase === 'idle' && mode.kind === 'walking' && !crossing && !motoRiding,
      canCancel: rideCanCancel(ride),
      canSkip: ride.phase === 'travelling' || (ride.phase === 'crossing' && !ride.skip),
      canRetry: ride.phase === 'held',
      view: ride.phase === 'travelling' || ride.phase === 'stopped' || ride.phase === 'crossing' || ride.phase === 'held' ? passengerView.outside ? 'outside' : 'inside' : null,
    }
  }

  function labelFor(target: Target): string {
    if (target.kind === 'moto') return 'Ride moto'
    if (target.kind === 'ride') {
      if (ride.phase === 'idle') return 'Call tuk-tuk'
      if (ride.phase !== 'waiting' || !ride.stop) return 'Talk to driver'
      return ride.doorTime === undefined ? 'Open passenger door' : 'Get in'
    }
    if (target.kind === 'door') return here.doors.get(target.id.slice(5))?.target ? 'Close door' : 'Open door'
    if (target.kind === 'seat') return 'Sit'
    if (target.kind === 'gateway') return `Enter ${here.district.gateways.find(gateway => `gateway:${gateway.side}` === target.id)?.name ?? ''}`
    return 'View drinks'
  }

  /** A door may close only once its doorway is clear of the player. */
  function doorwayClear(state: DoorState): boolean {
    const nearest = closestOnSegment(motor.position, state.info.a, state.info.b)
    return distance(nearest, motor.position) > MOTOR.radius + 0.08
  }

  function eligible(target: Target): boolean {
    if (motoRiding && target.kind !== 'gateway') return false
    if (target.kind === 'moto' && (!here.moto || !motor.grounded || ride.phase !== 'idle' || floorAt(here.district, motor.position, motor.y))) return false
    if (target.kind === 'ride') {
      if (ride.phase !== 'idle' && ride.phase !== 'waiting') return false
      if (ride.phase === 'waiting' && ride.stop) {
        if (distance(here.pickup, motor.position) > 1.6 || !motor.grounded) return false
        if (ride.doorTime !== undefined && ride.doorTime < RIDE_TIMING.open) return false
        // Only the curb side of the cabin can be used for boarding.
        const side = facing(here.pickupVehicle.heading + Math.PI / 2)
        const offset = sub(motor.position, here.pickupVehicle.position)
        if (offset.x * side.x + offset.z * side.z < 0.85) return false
      }
    }
    // A gateway takes the player away: not while a tuk-tuk is on its way to them.
    if (target.kind === 'gateway' && ride.phase !== 'idle') return false
    if (target.kind === 'door') {
      const state = here.doors.get(target.id.slice(5))
      if (state?.target && !doorwayClear(state)) return false
    }
    // A clear line to just short of it: its own door leaf doesn't count as in the way.
    const gap = distance(motor.position, target.position)
    if (gap < 0.2) return true
    const end = add(motor.position, sub(target.position, motor.position), Math.max(0, 1 - 0.35 / gap))
    return firstWall(here.district.world, motor.position, end, motor.y + 0.4, motor.y + 1.4) === null
  }

  function interact() {
    if (motoRiding) {
      if (crossing || motoTransition || !here.moto) return
      const gateway = here.district.gateways.find(entry => `gateway:${entry.side}` === currentTarget?.id)
      if (gateway) {
        walkThrough(gateway)
        return
      }
      const landing = landingSpot()
      if (landing) {
        here.moto.speed = 0
        moveMotoRider({ ...landing, heading: yawOf(sub(landing, here.moto.position)), seated: 0 }, 1)
      }
      return
    }
    if (rideOwnsPlayer(ride)) {
      applyRide({ type: 'exit' })
      return
    }
    if (mode.kind === 'seated' && seatedOn) {
      standUp(seatedOn)
      return
    }
    if (mode.kind !== 'walking' || !currentTarget || crossing) return
    // Checked again on activation: the target may have moved out of reach since it was offered.
    const target = chooseTarget(here.targets, viewer(), currentTarget.id, eligible)
    if (!target || target.id !== currentTarget.id) return
    if (target.kind === 'moto') mountMoto()
    else if (target.kind === 'door') toggleDoor(target.id.slice(5))
    else if (target.kind === 'seat') sitDown(here.district.seats.find(seat => `seat:${seat.id}` === target.id)!)
    else if (target.kind === 'gateway') {
      const gateway = here.district.gateways.find(entry => `gateway:${entry.side}` === target.id)
      if (gateway) walkThrough(gateway)
    }
    else if (target.kind === 'ride') {
      if (ride.phase === 'idle') rideAction({ type: 'call' })
      else if (ride.phase === 'waiting') {
        if (!ride.stop) events.chooseRide()
        else applyRide({ type: ride.doorTime === undefined ? 'open' : 'board', atDoor: true })
      }
    }
    else events.counter(here.id)
  }

  function motoGround(place = here) {
    return { world: place.district.world, road: place.district.moto.road, street: place.district.street }
  }

  function landingSpot() {
    const moto = here.moto
    if (!moto || Math.abs(moto.speed) >= MOTO.dismountSpeed) return null
    return motoDismount(motoGround(), moto, nearestMotoCurb(moto.position, here.district.moto.curbs))
  }

  function motoSeat(moto: MotoPose): PassengerPose {
    return { ...add(moto.position, facing(moto.heading), -0.19), y: here.district.street, heading: moto.heading, seated: 1 }
  }

  function moveMotoRider(to: PassengerPose, seated: number) {
    motoTransition = { from: { ...motor.position, y: motor.y, heading: motor.heading, seated }, to, elapsed: 0 }
    motor.velocity = { x: 0, z: 0 }
    actions.clear()
  }

  function updateParkedMoto(place: Place, parked: boolean) {
    const { moto, motoSolid, motoTarget, district: { world } } = place
    const index = world.solids.indexOf(motoSolid)
    if (moto && parked) {
      motoSolid.center = motoTarget.position = moto.position
      motoSolid.rotation = -moto.heading * 180 / Math.PI
      if (index < 0) world.solids.push(motoSolid)
    }
    else if (index >= 0) world.solids.splice(index, 1)
  }

  function mountMoto() {
    if (!here.moto) return
    motoRiding = true
    updateParkedMoto(here, false)
    currentTarget = null
    moveMotoRider(motoSeat(here.moto), 0)
    startCameraBlend()
    follow = createFollowCamera(here.moto.heading)
    follow.far = true
  }

  function placeMotoRider(pose: PassengerPose) {
    motor.position = { x: pose.x, z: pose.z }
    motor.y = pose.y
    motor.heading = pose.heading
    avatar.rideMoto(pose.seated, MOTO.seat)
  }

  function updateMoto(dt: number) {
    const moto = here.moto!
    if (motoTransition) {
      motoTransition.elapsed += dt
      const t = reducedMotion ? 1 : Math.min(1, motoTransition.elapsed / 0.28)
      const { from, to } = motoTransition
      placeMotoRider({
        ...add(from, sub(to, from), t),
        y: from.y + (to.y - from.y) * t,
        heading: from.heading + angleBetween(from.heading, to.heading) * t,
        seated: from.seated + (to.seated - from.seated) * t,
      })
      if (t === 1) {
        motoTransition = null
        if (to.seated === 0) {
          actions.clear()
          motoRiding = false
          motor = createMotor(motor.position, motor.y, motor.heading)
          avatar.sit(0, MOTO.seat)
          updateParkedMoto(here, true)
          follow.far = false
        }
      }
    }
    else if (!crossing) {
      const { position, heading } = moto
      const ground = motoGround()
      stepMoto(ground, moto, actions.drive(), dt)
      follow.yaw += angleBetween(heading, moto.heading)
      placeMotoRider(motoSeat(moto))
      if (position !== moto.position) {
        const curb = nearestMotoCurb(moto.position, here.district.moto.curbs)
        if (distance(moto.position, curb) < 1.35 && motoDismount(ground, moto, curb)) {
          here.motoCurb = { position: moto.position, heading: moto.heading }
        }
      }
    }
  }

  function parkAtCurb() {
    if (!here.moto || !here.motoCurb) return
    here.moto = createMoto(here.motoCurb)
    here.motoTarget.position = here.moto.position
  }

  function resetMoto() {
    if (disposed || !motoRiding || !here.motoCurb) return
    if (crossing) {
      crossing = null
      loadToken++
    }
    parkAtCurb()
    motoTransition = null
    currentTarget = null
    motor = createMotor(here.moto!.position, here.district.street, here.moto!.heading)
    placeMotoRider(motoSeat(here.moto!))
    previous = { ...motor.position, y: motor.y }
    follow = createFollowCamera(motor.heading)
    follow.far = true
    cameraBlendFrom = null
    actions.clear()
    routeAge = Infinity
    emitPrompt()
    emitStatus()
  }

  function toggleDoor(id: string) {
    const state = here.doors.get(id)
    if (!state) return
    if (state.target) {
      if (!doorwayClear(state)) return
      state.target = 0
      here.district.world.openDoors.delete(id)
    }
    else {
      state.target = OPEN_ANGLE * state.sign
      here.district.world.openDoors.add(id)
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
        if (isClear(here.district.world, spot, seat.y, MOTOR.radius, MOTOR.height)) return spot
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
      motor = createMotor(ended.to.position, groundAt(here.district.world, ended.to.position, ended.to.y) ?? ended.to.y, ended.to.heading)
      avatar.sit(0, ended.seat.seat)
    }
  }

  function viewer() {
    return { position: motor.position, y: motor.y, heading: motor.heading }
  }

  function startCameraBlend() {
    cameraBlendFrom = reducedMotion ? null : lastCameraPose
    cameraBlendElapsed = 0
  }

  /** The vehicle and its passenger jump to where the ride says, with no sweep from before. */
  function snapVehicle() {
    vehicle = vehiclePose(here.course, ride)
    previousVehicle = vehicle
    if (!vehicle || !rideOwnsPlayer(ride)) return
    const seat = riderPose(ride, vehicle, here.district.street, boardFrom, exitTo)
    previous = seat
    motor.position = { x: seat.x, z: seat.z }
    motor.y = seat.y
    motor.heading = seat.heading
  }

  function applyRide(event: RideEvent): boolean {
    const before = ride
    ride = nextRide(here.course, before, event)
    if (ride === before) return false
    if (ride.phase === before.phase) {
      if (event.type !== 'tick') emitStatus()
      return true
    }
    if (ride.phase === 'boarding') {
      boardFrom = { ...motor.position, y: motor.y, heading: motor.heading, seated: 0 }
      motor.velocity = { x: 0, z: 0 }
      passengerView.outside = false
      passengerView.yaw = 0
      passengerView.pitch = 0
      actions.clear()
    }
    if (ride.phase === 'exiting') {
      exitTo = safeRideCurb(here.district.world, vehiclePose(here.course, ride)!, here.district.street)
    }
    if (ride.phase === 'leaving' && before.phase === 'exiting') {
      // With no clear curb, reset from the seat to the known street spawn after the door closes.
      const spawn = here.district.spawn
      motor = exitTo ? createMotor(exitTo, exitTo.y, exitTo.heading) : createMotor(spawn.position, spawn.y, spawn.heading)
      previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
      follow = createFollowCamera(motor.heading)
      if (exitTo) startCameraBlend()
      avatar.sit(0, 0.48)
      actions.clear()
      // Arrived at a café: the waypoint guides to its door. Held before a gateway: it stays.
      if (before.stop.branchId === undefined) setWaypoint(here.id)
    }
    if (event.type === 'skip' || event.type === 'entered') snapVehicle()
    if (ride.phase === 'crossing' && before.phase !== 'crossing') void rideThrough(ride.stop)
    route = null
    routeAge = Infinity
    emitStatus()
    return true
  }

  function rideAction(event: Parameters<ExploreWorld['rideAction']>[0]): boolean {
    if (disposed || crossing || (paused && event.type !== 'confirm' && event.type !== 'call')) return false
    if (event.type === 'call' && (mode.kind !== 'walking' || motoRiding)) return false
    return applyRide(event)
  }

  // --- Crossing to another district (step E4) ---

  /** Loads a branch's district, or null when it can't (the caller keeps the player where they are). */
  async function loadPlace(id: string): Promise<Place | null> {
    if (!network) return null
    const token = ++loadToken
    try {
      const input = await network.load(id)
      if (disposed || token !== loadToken) return null
      return buildPlace(input, id)
    }
    catch (error) {
      if (!disposed) console.warn('Explore could not load the next district', error)
      return null
    }
  }

  /** Swaps the loaded district in; the one left behind is freed. */
  function enter(place: Place) {
    const left = here
    here = place
    freePlace(left)
    showPlace(place)
    transition = null
    seatedOn = null
    currentTarget = null
    route = null
    routeAge = Infinity
    placeBeacon()
  }

  /** The gateway someone coming from `from` arrives through. */
  function arrivalGateway(place: Place, from: string): GatewayInfo | null {
    const side = network ? sideToward(network.chain, place.id, from) : null
    return place.district.gateways.find(gateway => gateway.side === side) ?? null
  }

  function walkThrough(gateway: GatewayInfo) {
    if (crossing && !crossing.failed) return
    crossing = { gateway, failed: false }
    motor.velocity = { x: 0, z: 0 }
    if (motoRiding && here.moto) here.moto.speed = 0
    actions.clear()
    emitStatus()
    emitPrompt()
    void loadPlace(gateway.branchId).then((place) => {
      if (disposed || crossing?.gateway !== gateway) {
        if (place && !disposed) freePlace(place)
        return
      }
      if (!place) {
        crossing = { gateway, failed: true }
        emitStatus()
        return
      }
      const arrival = arrivalGateway(place, here.id)?.arrival ?? place.district.spawn
      if (motoRiding) updateParkedMoto(place, false)
      const arrivalMoto = motoRiding && motoFits(motoGround(place), arrival) ? arrival : place.motoCurb
      if (motoRiding && (!arrivalMoto || !place.motoCurb)) {
        freePlace(place)
        crossing = { gateway, failed: true }
        emitStatus()
        return
      }
      enter(place)
      crossing = null
      motor = createMotor(arrival.position, arrival.y, arrival.heading)
      if (motoRiding && arrivalMoto) {
        here.moto = createMoto(arrivalMoto)
        placeMotoRider(motoSeat(here.moto))
      }
      else avatar.sit(0, 0.46)
      previous = { ...motor.position, y: motor.y }
      follow = createFollowCamera(motor.heading)
      follow.far = motoRiding
      mode = WALKING
      actions.clear()
      emitStatus()
      emitPrompt()
    })
  }

  function retryCrossing() {
    if (crossing?.failed) walkThrough(crossing.gateway)
  }

  /** Back a few steps from the arch, facing into the district. */
  function cancelCrossing() {
    if (!crossing) return
    const { arrival } = crossing.gateway
    crossing = null
    loadToken++
    if (!motoRiding) motor = createMotor(arrival.position, arrival.y, arrival.heading)
    previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
    follow = createFollowCamera(motor.heading)
    follow.far = motoRiding
    actions.clear()
    emitStatus()
    emitPrompt()
  }

  /** The tuk-tuk under the gateway: the next district loads, then the ride goes on in it. */
  async function rideThrough(stop: RideStop) {
    const target = stop.branchId!
    const place = await loadPlace(target)
    if (disposed || ride.phase !== 'crossing' || ride.stop !== stop) {
      // Abandoned meanwhile (Return to street): the built district is never shown.
      if (place && !disposed) freePlace(place)
      return
    }
    if (!place) {
      applyRide({ type: 'failed' })
      return
    }
    const from = here.id
    const side = arrivalGateway(place, from)?.side ?? (network ? sideToward(network.chain, target, from) : null) ?? 'start'
    enter(place)
    applyRide({ type: 'entered', leg: { id: stop.id, label: stop.label, route: place.district.rideLegs[side].in } })
    startCameraBlend()
    emitPrompt()
  }

  function updateVehicle() {
    previousVehicle = vehicle
    vehicle = vehiclePose(here.course, ride)
    if (vehicle && previousVehicle) distanceDriven += distance(vehicle.position, previousVehicle.position)
    const solids = here.district.world.solids
    const index = solids.indexOf(here.vehicleSolid)
    if (vehicle && !rideOwnsPlayer(ride)) {
      here.vehicleSolid.center = vehicle.position
      here.vehicleSolid.rotation = -vehicle.heading * 180 / Math.PI
      if (index < 0) solids.push(here.vehicleSolid)
    }
    else if (index >= 0) {
      solids.splice(index, 1)
    }
  }

  function simulate(dt: number) {
    simTime += dt
    const { district } = here
    const look = actions.takeLook()
    const changeCamera = actions.take('camera')
    const jump = actions.take('jump')
    const pressed = actions.take('interact')
    if (actions.take('resetMoto') && motoRiding) {
      resetMoto()
      return
    }
    const wasOnMoto = motoRiding
    const motoWasTransitioning = motoTransition !== null
    const beforeRide = ride
    const occupied = rideOwnsPlayer(beforeRide)
    applyRide({ type: 'tick', dt, reducedMotion })
    updateVehicle()
    if (vehicle && rideOwnsPlayer(ride)) {
      const rider = riderPose(ride, vehicle, here.district.street, boardFrom, exitTo)
      motor.position = { x: rider.x, z: rider.z }
      motor.y = rider.y
      motor.heading = rider.heading
      avatar.sit(rider.seated, 0.48)
      if (ride.phase === 'boarding' || ride.phase === 'exiting') {
        avatar.locomotion(Math.min(2, Math.hypot(rider.x - previous.x, rider.z - previous.z) / dt), true, dt)
      }
      lookFromSeat(passengerView, look.x, look.y)
      if (changeCamera && ride.phase !== 'boarding' && ride.phase !== 'exiting') passengerView.outside = !passengerView.outside
    }
    else if (!occupied) {
      lookBy(follow, look.x, look.y)
      if (changeCamera) follow.far = !follow.far
    }

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

    const floor = floorAt(here.district, motor.position, motor.y)
    if (motoRiding) updateMoto(dt)
    if (canWalk(mode) && !wasOnMoto && !occupied && !rideOwnsPlayer(ride) && !crossing) {
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
      stepMotor(here.district.world, motor, { move, sprint, jump, indoors: Boolean(floor) }, dt)
    }
    updateFollow(follow, dt, { heading: motor.heading, moving: (motoRiding ? Math.abs(here.moto?.speed ?? 0) : length(motor.velocity)) > 0.3, indoors: Boolean(floor), reducedMotion })

    currentTarget = mode.kind === 'walking' && !rideOwnsPlayer(ride) && !crossing ? chooseTarget(here.targets, viewer(), currentTarget?.id ?? null, eligible) : null
    if (pressed && !motoWasTransitioning && (!occupied || beforeRide.phase === 'stopped' || beforeRide.phase === 'held')) interact()

    // The waypoint clears once the player is inside its café.
    if (waypoint === here.id && floor) setWaypoint(null)
    // A district swapped in this step: its route is recomputed below.
    if (district !== here.district) routeAge = Infinity
    routeAge += dt
    const walkingGoal = rideCanCancel(ride) ? here.pickup : waypointPoint()
    if (walkingGoal && routeAge >= ROUTE_EVERY) {
      routeAge = 0
      route = findRoute(here.grid, motor.position, walkingGoal)
    }
    emitPrompt()
    emitStatus()
  }

  function frame(now: number): boolean {
    if (disposed || paused) {
      running = false
      return false
    }
    const { district, doors } = here
    const elapsed = last === null ? 0 : (now - last) / 1000
    last = now
    clock += Math.min(elapsed, 0.1)
    if (frameTimes && lastFrameAt !== null) frameTimes.push(now - lastFrameAt)
    lastFrameAt = now
    const alpha = fixed.advance(elapsed, (dt) => {
      previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
      simulate(dt)
    })
    if (district !== here.district) {
      // A gateway was crossed during these steps: draw the new district from the next frame.
      stage.invalidate()
      return true
    }
    // Drawn between the last two steps, so a 120 Hz screen moves smoothly too.
    const x = previous.x + (motor.position.x - previous.x) * alpha
    const y = previous.y + (motor.y - previous.y) * alpha
    const z = previous.z + (motor.position.z - previous.z) * alpha
    avatar.root.position.set(x, y, z)
    avatar.root.rotation.y = motor.heading
    if (mode.kind === 'walking' && !rideOwnsPlayer(ride) && !motoRiding) avatar.locomotion(motor.grounded && !crossing ? length(motor.velocity) : 0, motor.grounded, Math.min(elapsed, 0.1))
    const shadowGround = groundAt(district.world, { x, z }, y) ?? y
    avatar.shadow.position.set(x, shadowGround + 0.012, z)

    const floor = floorAt(district, motor.position, motor.y)
    const renderedVehicle = vehicle && previousVehicle
      ? {
          position: add(previousVehicle.position, sub(vehicle.position, previousVehicle.position), alpha),
          heading: previousVehicle.heading + angleBetween(previousVehicle.heading, vehicle.heading) * alpha,
        }
      : vehicle
    tukTuk.root.visible = Boolean(renderedVehicle)
    pickupMarker.visible = rideCanCancel(ride)
    if (renderedVehicle) {
      tukTuk.root.position.set(renderedVehicle.position.x, district.street, renderedVehicle.position.z)
      tukTuk.root.rotation.y = renderedVehicle.heading
      tukTuk.update(rideDoor(ride), distanceDriven, Math.min(elapsed, 0.1))
      distanceDriven = 0
    }

    const moto = here.moto
    motoModel.root.visible = Boolean(moto)
    avatar.root.rotation.z = 0
    if (moto) {
      const lean = motoModel.update(moto.steer, moto.speed, moto.wheelTurn, reducedMotion)
      const position = motoRiding && !motoTransition ? add({ x, z }, facing(moto.heading), 0.19) : moto.position
      motoModel.root.position.set(position.x, district.street, position.z)
      motoModel.root.rotation.y = moto.heading
      if (motoRiding) avatar.root.rotation.z = lean
    }

    const inVehicle = ride.phase === 'travelling' || ride.phase === 'stopped' || ride.phase === 'exiting' || ride.phase === 'crossing' || ride.phase === 'held'
    const pose = inVehicle && renderedVehicle
      ? passengerCamera(passengerView, renderedVehicle, district.street, district.world)
      : cameraPose(follow, { world: district.world, feet: { x, y, z }, ceiling: floor?.ceiling ?? null, shoulder: motoRiding ? 0 : undefined })
    if (cameraBlendFrom && !reducedMotion) {
      cameraBlendElapsed += elapsed
      const t = Math.min(1, cameraBlendElapsed / 0.32)
      const blend = (from: CameraPose['position'], to: CameraPose['position']) => ({
        x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t,
      })
      pose.position = blend(cameraBlendFrom.position, pose.position)
      pose.target = blend(cameraBlendFrom.target, pose.target)
      if (t === 1) cameraBlendFrom = null
    }
    lastCameraPose = pose
    camera.position.set(pose.position.x, pose.position.y, pose.position.z)
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z)
    // A wall right behind pulls the camera to the character's head: hide the avatar there rather
    // than look out from inside it.
    const head = Math.hypot(pose.position.x - x, pose.position.y - (y + 1.55), pose.position.z - z)
    avatar.root.visible = head > HIDE_AVATAR_WITHIN && !(inVehicle && ride.phase !== 'exiting' && !passengerView.outside)
    avatar.shadow.visible = !rideOwnsPlayer(ride) && !motoRiding

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
    here.surroundings?.idle(clock)
    for (const figure of here.built.figures) figure.idle(clock)
    const point = beacon.visible ? waypointPoint() : null
    if (point) {
      // It guides from afar; up close it fades away instead of tinting the view.
      const near = Math.max(0, Math.min(1, (distance(motor.position, point) - 1.5) / 5))
      beaconMaterial.opacity = (reducedMotion ? 0.22 : 0.16 + Math.sin(clock * 2.4) * 0.06) * near
    }
    for (const callback of frameCallbacks) callback()
    return true
  }

  function startLoop() {
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
    if (!next) startLoop()
    else {
      if (motoRiding && here.moto) here.moto.speed = 0
      if (document.pointerLockElement === options.canvas) document.exitPointerLock()
      stage.invalidate()
    }
  }

  function visibility() {
    if (document.visibilityState === 'hidden') actions.clear()
    else startLoop()
  }
  document.addEventListener('visibilitychange', visibility)

  function setWaypoint(id: string | null) {
    const known = id === here.id || Boolean(id && network?.chain.some(branch => branch.id === id))
    waypoint = id && known ? id : null
    placeBeacon()
    route = null
    routeAge = Infinity
    emitStatus()
  }

  function returnToStreet() {
    if (motoRiding && here.motoParking) {
      here.moto = createMoto(here.motoParking)
      updateParkedMoto(here, true)
    }
    motoRiding = false
    motoTransition = null
    transition = null
    seatedOn = null
    ride = IDLE_RIDE
    updateVehicle()
    previousVehicle = null
    cameraBlendFrom = null
    currentTarget = null
    route = null
    mode = WALKING
    if (crossing) {
      crossing = null
      loadToken++
    }
    avatar.sit(0, 0.46)
    const spawn = here.district.spawn
    motor = createMotor(spawn.position, spawn.y, spawn.heading)
    previous = { x: motor.position.x, y: motor.y, z: motor.position.z }
    follow = createFollowCamera(motor.heading)
    actions.clear()
    routeAge = Infinity
    emitStatus()
    emitPrompt()
  }

  async function benchmark(onProgress?: (phase: string) => void): Promise<WalkReport | null> {
    const { district, grid, doors } = here
    const counterSpot = district.counter?.position
    const path = counterSpot ? findRoute(grid, district.spawn.position, counterSpot) : null
    if (!path) return null
    returnToStreet()
    // Every door open, so the walk never stops at one.
    for (const [id, state] of doors) {
      state.target = OPEN_ANGLE * state.sign
      district.world.openDoors.add(id)
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
    loadToken++
    document.removeEventListener('visibilitychange', visibility)
    frameCallbacks.clear()
    actions.clear()
    freePlace(here)
    kit.disposeBuildContext(own)
    for (const item of disposables) item.dispose()
    stage.dispose()
  }

  stage.measure()
  startLoop()
  emitStatus()
  emitPrompt()

  return {
    actions,
    district: () => here.district,
    rideStops: () => here.course.stops.map(stop => ({
      id: stop.id,
      label: stop.label,
      // A trip to another branch: this street's leg and about as long again in the next one.
      seconds: Math.ceil(stop.route.duration * (stop.branchId ? 2 : 1)),
      branchId: stop.branchId,
    })),
    rideAction,
    setPaused,
    setTheme,
    setReducedMotion: (reduced) => {
      reducedMotion = reduced
    },
    setWaypoint,
    mapView: () => ({
      player: { position: motor.position, heading: motor.heading },
      cameraYaw: rideOwnsPlayer(ride) ? motor.heading + Math.PI + (passengerView.outside ? 0 : passengerView.yaw) : follow.yaw,
      route: ride.phase === 'boarding' || ride.phase === 'travelling' ? ride.stop.route.points : rideCanCancel(ride) || waypoint ? route : null,
      waypoint: rideCanCancel(ride) ? here.pickup : waypointPoint(),
    }),
    onFrame: (callback) => {
      frameCallbacks.add(callback)
      return () => frameCallbacks.delete(callback)
    },
    returnToStreet,
    resetMoto,
    retryCrossing,
    cancelCrossing,
    benchmark,
    dispose,
  }
}

/** Doors, seats, the counter and the gateways as context-button targets. */
function buildTargets(district: District): Target[] {
  const targets: Target[] = district.doors.map(door => ({ id: `door:${door.id}`, kind: 'door', position: door.mid, y: door.y, reach: REACH.door }))
  for (const seat of district.seats) targets.push({ id: `seat:${seat.id}`, kind: 'seat', position: seat.position, y: seat.y, reach: REACH.seat })
  if (district.counter) {
    // The counter's own edge, so facing the counter is what offers it.
    targets.push({ id: 'counter', kind: 'counter', position: add(district.counter.position, facing(district.counter.yaw), 0.45), y: district.counter.y, reach: REACH.counter })
  }
  for (const gateway of district.gateways) targets.push({ id: `gateway:${gateway.side}`, kind: 'gateway', position: gateway.position, y: district.street, reach: REACH.gateway })
  return targets
}

/**
 * The gateways' arches: two posts, a beam across the lane and the next district's name on a
 * board facing each way. Generated like the rest of the street; the board is a canvas texture.
 */
function buildArches(gateways: readonly GatewayInfo[], street: number, context: BuildContext, disposables: { dispose: () => void }[]): Group {
  const root = new Group()
  const material = context.materials.surface('frame')
  for (const gateway of gateways) {
    const arch = new Group()
    const span = distance(gateway.a, gateway.b)
    const middle = { x: (gateway.a.x + gateway.b.x) / 2, z: (gateway.a.z + gateway.b.z) / 2 }
    arch.position.set(middle.x, street, middle.z)
    // Local +x along the beam (a → b).
    arch.rotation.y = yawOf(sub(gateway.b, gateway.a)) - Math.PI / 2
    const post = cachedBox(context, 'explore:gateway-post', 0.3, GATEWAY_HEIGHT, 0.3)
    for (const end of [-span / 2, span / 2]) {
      const mesh = new Mesh(post, material)
      mesh.position.set(end, GATEWAY_HEIGHT / 2, 0)
      mesh.castShadow = true
      arch.add(mesh)
    }
    const beam = new Mesh(cachedBox(context, `explore:gateway-beam:${span.toFixed(2)}`, span + 0.5, 0.35, 0.4), material)
    beam.position.set(0, GATEWAY_HEIGHT - 0.1, 0)
    beam.castShadow = true
    arch.add(beam)
    const sign = nameBoard(gateway.name, disposables)
    if (sign) {
      const width = Math.min(span - 0.6, 3.6)
      const board = new Mesh(cachedPlane(context, `explore:gateway-board:${width.toFixed(2)}`, width, width / 4), sign)
      board.position.set(0, GATEWAY_HEIGHT - 0.75, 0)
      arch.add(board)
    }
    root.add(arch)
  }
  return root
}

function cachedBox(context: BuildContext, key: string, width: number, height: number, depth: number) {
  let geometry = context.geometries.get(key)
  if (!geometry) {
    geometry = new BoxGeometry(width, height, depth)
    context.geometries.set(key, geometry)
  }
  return geometry
}

function cachedPlane(context: BuildContext, key: string, width: number, height: number) {
  let geometry = context.geometries.get(key)
  if (!geometry) {
    geometry = new PlaneGeometry(width, height)
    context.geometries.set(key, geometry)
  }
  return geometry
}

/** The next district's name, light on dark, readable from both sides of the arch. */
function nameBoard(name: string, disposables: { dispose: () => void }[]): MeshBasicMaterial | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#1c1917'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#fef3c7'
  let size = 64
  context.font = `600 ${size}px system-ui, sans-serif`
  while (size > 24 && context.measureText(name).width > canvas.width - 48) {
    size -= 4
    context.font = `600 ${size}px system-ui, sans-serif`
  }
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(name, canvas.width / 2, canvas.height / 2)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  const material = new MeshBasicMaterial({ map: texture, side: DoubleSide })
  disposables.push(texture, material)
  return material
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
