import type { District, MapAreaKind } from './district'
import type { Vec2 } from './vec'

/**
 * Drawing the district's map (D275, docs/plans/explore.md → Map) with Canvas 2D, for the minimap
 * (centred on the player, turning with the camera) and the full map (north up). The shapes come
 * from the district's plan, so the map is crisp at any size and costs far less than a second 3D
 * view. Colors come from the app's semantic tokens, resolved once per theme.
 */

export interface MapColors {
  ground: string
  yard: string
  pavement: string
  lane: string
  planting: string
  building: string
  cafe: string
  wall: string
  route: string
  player: string
  outline: string
  text: string
}

/** The theme's colors, read from Nuxt UI's CSS variables through a probe element. */
export function readMapColors(element: HTMLElement): MapColors {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  element.appendChild(probe)
  const read = (value: string) => {
    probe.style.color = value
    return getComputedStyle(probe).color
  }
  const colors: MapColors = {
    ground: read('var(--ui-bg-muted)'),
    yard: read('var(--ui-bg-accented)'),
    pavement: read('var(--ui-bg-elevated)'),
    lane: read('var(--ui-border-accented)'),
    planting: read('var(--ui-color-success-300)'),
    building: read('var(--ui-text-dimmed)'),
    cafe: read('var(--ui-color-primary-200)'),
    wall: read('var(--ui-text-muted)'),
    route: read('var(--ui-primary)'),
    player: read('var(--ui-text-highlighted)'),
    outline: read('var(--ui-bg)'),
    text: read('var(--ui-text-highlighted)'),
  }
  probe.remove()
  return colors
}

const AREA_ORDER: MapAreaKind[] = ['ground', 'yard', 'pavement', 'lane', 'planting', 'building', 'cafe']

export interface MapView {
  player: { position: Vec2, heading: number }
  /** The camera's yaw: the minimap turns so the camera's view points up. */
  cameraYaw: number
  route: readonly Vec2[] | null
  waypoint: Vec2 | null
}

export interface DrawOptions {
  width: number
  height: number
  /** Pixels a metre. */
  scale: number
  /** The world point at the canvas's middle. */
  center: Vec2
  /** Radians the map turns (the camera's yaw for the minimap, 0 for north up). */
  rotation: number
  colors: MapColors
  /** Name the café on the map (the full map; the minimap is too small). */
  labels?: boolean
}

/** Draws the district and the view, in CSS pixels (the caller scales for the device). */
export function drawMap(context: CanvasRenderingContext2D, district: District, view: MapView, options: DrawOptions) {
  const { width, height, scale, center, rotation, colors } = options
  context.clearRect(0, 0, width, height)
  context.save()
  context.translate(width / 2, height / 2)
  context.rotate(rotation)
  context.scale(scale, scale)
  context.translate(-center.x, -center.z)
  context.lineJoin = 'round'
  context.lineCap = 'round'

  for (const kind of AREA_ORDER) {
    context.fillStyle = colors[kind]
    for (const area of district.map.areas) {
      if (area.kind === kind) fillPolygon(context, area.points)
    }
  }
  context.strokeStyle = colors.wall
  context.lineWidth = 0.22
  for (const wall of district.map.walls) line(context, wall.a, wall.b)
  // Doors: a gap with a bright sill.
  context.strokeStyle = colors.route
  context.lineWidth = 0.18
  for (const door of district.doors) line(context, door.a, door.b)

  if (view.route && view.route.length > 1) {
    context.strokeStyle = colors.route
    context.lineWidth = Math.max(0.35, 3 / scale)
    context.beginPath()
    view.route.forEach((point, index) => (index ? context.lineTo(point.x, point.z) : context.moveTo(point.x, point.z)))
    context.stroke()
  }
  if (view.waypoint) pin(context, view.waypoint, scale, colors)
  context.restore()

  if (options.labels) {
    const cafe = district.map.areas.find(area => area.kind === 'cafe')
    if (cafe) {
      const middle = cafe.points.reduce((sum, point) => ({ x: sum.x + point.x / cafe.points.length, z: sum.z + point.z / cafe.points.length }), { x: 0, z: 0 })
      const at = toScreen(middle, options)
      context.font = '600 14px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.lineWidth = 4
      context.strokeStyle = colors.outline
      context.strokeText(district.name, at.x, at.y)
      context.fillStyle = colors.text
      context.fillText(district.name, at.x, at.y)
    }
  }

  // The player's arrow at its place, pointing its heading (screen space, so it keeps its size).
  const at = toScreen(view.player.position, options)
  const angle = Math.atan2(Math.sin(view.player.heading), Math.cos(view.player.heading))
  context.save()
  context.translate(at.x, at.y)
  // A heading of 0 faces +z (down the map); the arrow's tip points up at rest.
  context.rotate(rotation - angle + Math.PI)
  // The primary color with a dark edge: a cursor-like black arrow read as the mouse pointer.
  context.fillStyle = colors.route
  context.strokeStyle = colors.player
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(0, -11)
  context.lineTo(8.5, 8)
  context.lineTo(0, 3.5)
  context.lineTo(-8.5, 8)
  context.closePath()
  context.fill()
  context.stroke()
  context.restore()
}

/** A world point on the canvas. */
export function toScreen(point: Vec2, options: Pick<DrawOptions, 'width' | 'height' | 'scale' | 'center' | 'rotation'>): { x: number, y: number } {
  const dx = (point.x - options.center.x) * options.scale
  const dz = (point.z - options.center.z) * options.scale
  const cos = Math.cos(options.rotation)
  const sin = Math.sin(options.rotation)
  return { x: options.width / 2 + dx * cos - dz * sin, y: options.height / 2 + dx * sin + dz * cos }
}

/** A canvas point in the world (the full map's taps). */
export function toWorld(x: number, y: number, options: Pick<DrawOptions, 'width' | 'height' | 'scale' | 'center' | 'rotation'>): Vec2 {
  const sx = (x - options.width / 2) / options.scale
  const sy = (y - options.height / 2) / options.scale
  const cos = Math.cos(-options.rotation)
  const sin = Math.sin(-options.rotation)
  return { x: options.center.x + sx * cos - sy * sin, z: options.center.z + sx * sin + sy * cos }
}

function fillPolygon(context: CanvasRenderingContext2D, points: readonly Vec2[]) {
  if (points.length < 3) return
  context.beginPath()
  points.forEach((point, index) => (index ? context.lineTo(point.x, point.z) : context.moveTo(point.x, point.z)))
  context.closePath()
  context.fill()
}

function line(context: CanvasRenderingContext2D, a: Vec2, b: Vec2) {
  context.beginPath()
  context.moveTo(a.x, a.z)
  context.lineTo(b.x, b.z)
  context.stroke()
}

/** The waypoint: a ring in the text color around a primary dot, unlike the player's arrow. */
function pin(context: CanvasRenderingContext2D, point: Vec2, scale: number, colors: MapColors) {
  context.lineWidth = 2.5 / scale
  context.fillStyle = colors.outline
  context.strokeStyle = colors.player
  context.beginPath()
  context.arc(point.x, point.z, 8 / scale, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.fillStyle = colors.route
  context.beginPath()
  context.arc(point.x, point.z, 4 / scale, 0, Math.PI * 2)
  context.fill()
}
