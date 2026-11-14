import type { Point } from '#shared/contracts/shop-layout'
import type { Bounds } from './geometry'

/**
 * The 2D plan's camera (ISS-028, D278): what part of the plan is on screen. Pure view math, in
 * plan centimetres and screen pixels, y pointing down.
 *
 * The zoom (`scale`) and the plan point at the canvas's top-left corner (`x`, `y`) are the source
 * of truth, like Figma's viewport. The canvas size only decides how much of the plan is visible:
 * a panel that hides or shows, or a window resize, never changes the zoom, and the editor keeps
 * every plan point where it was on the screen (`followCanvas`). Only Fit and the zoom commands
 * choose a new camera.
 */
export interface Camera {
  /** The plan point at the canvas's top-left corner, in centimetres. */
  x: number
  y: number
  /** Screen pixels per centimetre: 1 is the 100 % zoom. */
  scale: number
}

export interface ScreenSize {
  width: number
  height: number
}

/** The zoom range, in screen pixels per centimetre. */
export interface ZoomLimits {
  min: number
  max: number
}

/**
 * 2 % to 25,600 %, Figma's range (ISS-005; reported by Figma users, not in Figma's documentation),
 * the same on every screen size.
 */
export const ZOOM_LIMITS: ZoomLimits = { min: 0.02, max: 256 }

export function clampScale(scale: number, limits: ZoomLimits = ZOOM_LIMITS): number {
  return Math.min(limits.max, Math.max(limits.min, scale))
}

/** The part of the plan on a canvas this size, in centimetres: the SVG's viewBox. */
export function visibleRect(camera: Camera, size: ScreenSize): { x: number, y: number, width: number, height: number } {
  return { x: camera.x, y: camera.y, width: size.width / camera.scale, height: size.height / camera.scale }
}

/** Plan centimetres → pixels from the canvas's top-left corner. */
export function planToScreen(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) * camera.scale, y: (point.y - camera.y) * camera.scale }
}

/** Pixels from the canvas's top-left corner → plan centimetres. */
export function screenToPlan(camera: Camera, point: Point): Point {
  return { x: camera.x + point.x / camera.scale, y: camera.y + point.y / camera.scale }
}

/** Moves what's on screen by these screen pixels: positive shows more of the plan's right and bottom. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx / camera.scale, y: camera.y + dy / camera.scale }
}

/**
 * Zooms by `factor` (above 1 zooms in) and keeps the plan point `at` where it is on screen.
 * The zoom stops at the limits; the point still stays put.
 */
export function zoomAt(camera: Camera, at: Point, factor: number, limits: ZoomLimits = ZOOM_LIMITS): Camera {
  const scale = clampScale(camera.scale * factor, limits)
  const ratio = camera.scale / scale
  return { x: at.x - (at.x - camera.x) * ratio, y: at.y - (at.y - camera.y) * ratio, scale }
}

export interface FitOptions {
  /** Plan centimetres kept around the bounds on every side. */
  margin: number
  /** The smallest plan span shown, so a tiny selection does not fill the screen. */
  minSpan?: number
  limits?: ZoomLimits
}

/** The camera that shows these bounds whole and centred on a canvas this size. */
export function fitBounds(bounds: Bounds, size: ScreenSize, options: FitOptions): Camera {
  const { margin, minSpan = 0, limits = ZOOM_LIMITS } = options
  const width = Math.max(minSpan, bounds.maxX - bounds.minX + margin * 2)
  const height = Math.max(minSpan, bounds.maxY - bounds.minY + margin * 2)
  const scale = clampScale(Math.min(size.width / width, size.height / height), limits)
  const middle = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
  return { x: middle.x - size.width / scale / 2, y: middle.y - size.height / scale / 2, scale }
}

/**
 * The canvas moved on the screen (a panel left of it hid, showed or was resized): the camera that
 * keeps every plan point at the same place on the screen. `from` and `to` are the canvas's
 * top-left corner in page pixels, before and after.
 */
export function followCanvas(camera: Camera, from: Point, to: Point): Camera {
  return panBy(camera, to.x - from.x, to.y - from.y)
}

/** Figma's measured wheel zoom (ISS-001): this much per pixel of wheel, and at most this many pixels per event. */
const WHEEL_ZOOM_PER_PX = 0.005
const WHEEL_ZOOM_MAX_PX = 19

/**
 * The zoom factor for one Ctrl/⌘+wheel or pinch event, from its vertical delta in pixels
 * (positive scrolls down and zooms out). A mouse notch is about 10 %; a fast spin is capped, so
 * it never jumps.
 */
export function wheelZoomFactor(deltaY: number): number {
  const delta = Math.min(WHEEL_ZOOM_MAX_PX, Math.max(-WHEEL_ZOOM_MAX_PX, deltaY))
  return Math.exp(-delta * WHEEL_ZOOM_PER_PX)
}

/**
 * A zoom percentage typed in the zoom menu (ISS-003): "150", "150 %" or "62.5". Null for
 * anything else, so the field keeps the zoom it had. The zoom itself clamps to the limits.
 */
export function parseZoomPercent(text: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text)
  if (!match) return null
  const percent = Number(match[1]!.replace(',', '.'))
  return Number.isFinite(percent) && percent > 0 ? percent : null
}

/**
 * The drawn grid (ISS-031, ISS-040), apart from the snap step: levels of 1 cm, 10 cm, 1 m, 10 m and
 * 100 m. The fine lines are the smallest level at least 8 px apart on screen, fading in until they
 * are 16 px apart; the strong lines are ten times that. So zooming in always brings finer lines,
 * as in Figma, down to 1 cm (positions are whole centimetres).
 */
export const GRID_LEVELS_CM = [1, 10, 100, 1_000, 10_000] as const
const GRID_MIN_GAP_PX = 8
const GRID_FULL_GAP_PX = 16

export interface GridLevels {
  /** The fine lines' spacing in cm, and how strongly they show (0 to 1). */
  minor: number
  minorOpacity: number
  /** The strong lines' spacing in cm. */
  major: number
}

export function gridLevels(scale: number): GridLevels {
  const minor = GRID_LEVELS_CM.find(level => level * scale >= GRID_MIN_GAP_PX) ?? GRID_LEVELS_CM.at(-1)!
  const gap = minor * scale
  return { minor, minorOpacity: Math.min(1, Math.max(0, (gap - GRID_MIN_GAP_PX) / (GRID_FULL_GAP_PX - GRID_MIN_GAP_PX))), major: minor * 10 }
}

export interface GridLines extends GridLevels {
  /** Screen pixels from the canvas's left and top edges, each on a pixel's middle so a 1 px line is sharp. */
  minorX: number[]
  minorY: number[]
  majorX: number[]
  majorY: number[]
}

/**
 * Where the grid lines fall on a canvas this size, in screen pixels (ISS-040): drawn outside the
 * zoom, rounded to whole pixels, so they are sharp at every zoom. `origin` is the plan point the
 * grid starts from (the floor frame's offset). The fine lines leave out those under a strong one.
 */
export function gridLines(camera: Camera, size: ScreenSize, origin: Point = { x: 0, y: 0 }): GridLines {
  const levels = gridLevels(camera.scale)
  const axis = (start: number, length: number, from: number, step: number, skip?: number) => {
    const lines: number[] = []
    const first = Math.ceil((start - from) / step)
    const last = Math.floor((start + length / camera.scale - from) / step)
    for (let index = first; index <= last; index++) {
      if (skip && index % skip === 0) continue
      lines.push(Math.round((from + index * step - start) * camera.scale) + 0.5)
    }
    return lines
  }
  return {
    ...levels,
    minorX: levels.minorOpacity > 0 ? axis(camera.x, size.width, origin.x, levels.minor, 10) : [],
    minorY: levels.minorOpacity > 0 ? axis(camera.y, size.height, origin.y, levels.minor, 10) : [],
    majorX: axis(camera.x, size.width, origin.x, levels.major),
    majorY: axis(camera.y, size.height, origin.y, levels.major),
  }
}
