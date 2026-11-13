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

/** 10 % to 800 %: a whole building to a chair's leg, the same on every screen size. */
export const ZOOM_LIMITS: ZoomLimits = { min: 0.1, max: 8 }

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
