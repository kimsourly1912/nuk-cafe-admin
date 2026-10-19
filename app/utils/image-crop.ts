import type { PhotoView } from '#shared/contracts/media'

/**
 * Cropping a photo to a frame, pure and unit-tested. Shared by `<ImageCropModal>` (one frame, any
 * shape) and the menu photo editor (two frames, D158): the preview (CSS) and the saved file (canvas)
 * both place the photo with `placePhoto`, so what is seen is what is saved.
 */

export interface Size {
  width: number
  height: number
}

/** Where the photo is drawn in a frame, in the frame's units (its top-left corner is 0, 0). */
export interface Placement {
  x: number
  y: number
  width: number
  height: number
}

/** How a photo is framed: its zoom (1 fills the frame) and the point of it at the frame's centre (0 to 1). */
export type CropView = Pick<PhotoView, 'zoom' | 'x' | 'y'>

/** As close as a frame can zoom in (four times the size that fills it). */
export const MAX_ZOOM = 4

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** A frame of the given width ÷ height, one unit tall. */
export const cropFrame = (ratio: number): Size => ({ width: ratio, height: 1 })

/** The scale at which the photo exactly fills the frame (zoom 1). */
export const coverScale = (source: Size, frame: Size) => Math.max(frame.width / source.width, frame.height / source.height)

/**
 * Where the photo sits in the frame: scaled by its zoom, with the view's point of the photo at the
 * frame's centre, but never leaving a gap at an edge it could cover (the photo slides back);
 * smaller than the frame on a side, it's centred on that side.
 */
export function placePhoto(source: Size, frame: Size, view: CropView): Placement {
  const scale = coverScale(source, frame) * view.zoom
  const width = source.width * scale
  const height = source.height * scale
  const along = (size: number, frameSize: number, point: number) =>
    size >= frameSize ? clamp(frameSize / 2 - point * size, frameSize - size, 0) : (frameSize - size) / 2
  return { x: along(width, frame.width, view.x), y: along(height, frame.height, view.y), width, height }
}

/** The view's point as it is after `placePhoto` slid the photo back: so moves never pile up past an edge. */
export function settleView<T extends CropView>(source: Size, frame: Size, view: T): T {
  const placed = placePhoto(source, frame, view)
  return {
    ...view,
    x: clamp((frame.width / 2 - placed.x) / placed.width, 0, 1),
    y: clamp((frame.height / 2 - placed.y) / placed.height, 0, 1),
  }
}

/** The photo centred and filling the frame. */
export const newCrop = (): CropView => ({ zoom: 1, x: 0.5, y: 0.5 })

/** Moves the photo by `dx`/`dy` frame units (dragged right: the photo moves right). */
export function moveCrop(source: Size, frame: Size, view: CropView, dx: number, dy: number): CropView {
  const placed = placePhoto(source, frame, view)
  return settleView(source, frame, { ...view, x: view.x - dx / placed.width, y: view.y - dy / placed.height })
}

/** Zooms to `zoom` (from filling the frame to `MAX_ZOOM`), keeping the same point in the middle. */
export function zoomCrop(source: Size, frame: Size, view: CropView, zoom: number): CropView {
  return settleView(source, frame, { ...view, zoom: clamp(zoom, 1, MAX_ZOOM) })
}

/**
 * The size of the cropped file: the framed part of the photo at its own pixels, the longest side at
 * most `maxEdge`, never enlarged, in the frame's proportions.
 */
export function cropOutputSize(source: Size, frame: Size, view: CropView, maxEdge: number): Size {
  const scale = coverScale(source, frame) * view.zoom
  const native = { width: frame.width / scale, height: frame.height / scale }
  const fit = Math.min(1, maxEdge / Math.max(native.width, native.height))
  return { width: Math.max(1, Math.round(native.width * fit)), height: Math.max(1, Math.round(native.height * fit)) }
}

/** Whether a photo is already the frame's shape, give or take `tolerance` (2 %): cropping it would only re-encode it. */
export const isNearRatio = (source: Size, ratio: number, tolerance = 0.02) => Math.abs(source.width / source.height / ratio - 1) <= tolerance

/** A placement as CSS percentages of its frame (the previews and the adjust frame). */
export function placementStyle(placed: Placement, frame: Size): Record<string, string> {
  const pct = (value: number, of: number) => `${(value / of) * 100}%`
  return { left: pct(placed.x, frame.width), top: pct(placed.y, frame.height), width: pct(placed.width, frame.width), height: pct(placed.height, frame.height) }
}
