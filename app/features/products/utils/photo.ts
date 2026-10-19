import type { PhotoEdit, PhotoView } from '#shared/contracts/media'
import type { Size } from '~/utils/image-crop'
import { clamp, coverScale, MAX_ZOOM, placePhoto, settleView } from '~/utils/image-crop'

// The frame geometry is shared with the general crop modal (`app/utils/image-crop.ts`).
export type { Placement, Size } from '~/utils/image-crop'
export { MAX_ZOOM, placePhoto, placementStyle } from '~/utils/image-crop'

/**
 * The photo editor's rules (D158), pure and unit-tested: the suggested views from the focus point,
 * moving and zooming within limits. The previews (CSS) and the saved files (canvas) both place the
 * photo with `placePhoto`, so what the owner sees is what is saved.
 */

export type ViewName = 'card' | 'detail'

/** Width ÷ height of each view's frame. */
export const VIEW_RATIOS: Record<ViewName, number> = { card: 1, detail: 4 / 3 }

/**
 * A suggested item-page view keeps the photo whole (fitted, the fill colour around it) unless
 * filling the 4:3 frame would cut at most this share of it: then it fills the frame.
 */
export const DETAIL_COVER_LIMIT = 0.12

/** A photo whose short side is smaller than this may look soft on the item page (1200 × 900). */
export const SMALL_PHOTO_EDGE = 900

/** The frame of a view, one unit tall. */
export const frameOf = (view: ViewName): Size => ({ width: VIEW_RATIOS[view], height: 1 })

/**
 * How far a view can zoom out: the menu card always fills its square (a tiny photo with bars looks
 * broken); the item page can show the whole photo, fitted in its frame.
 */
export function minZoom(source: Size, view: ViewName): number {
  if (view === 'card') return 1
  const frame = frameOf(view)
  return Math.min(frame.width / source.width, frame.height / source.height) / coverScale(source, frame)
}

/** The view's point as it is after `placePhoto` slid the photo back: so moves never pile up past an edge. */
const settle = (source: Size, viewName: ViewName, view: PhotoView) => settleView(source, frameOf(viewName), view)

/**
 * The suggested view from the focus point (the middle of the dish): the menu card fills its square
 * around it; the item page shows the whole photo, unless filling 4:3 cuts very little of it.
 */
export function suggestedView(source: Size, viewName: ViewName, focus: { x: number, y: number }): PhotoView {
  if (viewName === 'detail') {
    const ratio = source.width / source.height
    const kept = ratio > VIEW_RATIOS.detail ? VIEW_RATIOS.detail / ratio : ratio / VIEW_RATIOS.detail
    if (kept < 1 - DETAIL_COVER_LIMIT) return { zoom: minZoom(source, 'detail'), x: 0.5, y: 0.5, adjusted: false }
  }
  return settle(source, viewName, { zoom: 1, x: focus.x, y: focus.y, adjusted: false })
}

/** Moves the photo by `dx`/`dy` frame units (dragged right: the photo moves right). */
export function moveView(source: Size, viewName: ViewName, view: PhotoView, dx: number, dy: number): PhotoView {
  const placed = placePhoto(source, frameOf(viewName), view)
  return settle(source, viewName, { ...view, x: view.x - dx / placed.width, y: view.y - dy / placed.height, adjusted: true })
}

/** Zooms to `zoom`, within the view's limits, keeping the same point in the middle. */
export function zoomView(source: Size, viewName: ViewName, view: PhotoView, zoom: number): PhotoView {
  return settle(source, viewName, { ...view, zoom: clamp(zoom, minZoom(source, viewName), MAX_ZOOM), adjusted: true })
}

/** A new edit for a photo: the focus in the middle and both views suggested. */
export function newEdit(source: Size, fill: string): PhotoEdit {
  const focus = { x: 0.5, y: 0.5 }
  return { focus, card: suggestedView(source, 'card', focus), detail: suggestedView(source, 'detail', focus), fill }
}

/** Moves the focus point: the views the owner hasn't adjusted follow it. */
export function withFocus(source: Size, edit: PhotoEdit, focus: { x: number, y: number }): PhotoEdit {
  const point = { x: clamp(focus.x, 0, 1), y: clamp(focus.y, 0, 1) }
  return {
    ...edit,
    focus: point,
    card: edit.card.adjusted ? edit.card : suggestedView(source, 'card', point),
    detail: edit.detail.adjusted ? edit.detail : suggestedView(source, 'detail', point),
  }
}

/** Reset: the view as suggested from the focus point again. */
export function resetView(source: Size, edit: PhotoEdit, viewName: ViewName): PhotoEdit {
  return { ...edit, [viewName]: suggestedView(source, viewName, edit.focus) }
}

/**
 * The colour around a photo zoomed out to show all of it: the average of its edge pixels (RGBA),
 * so the fill continues the photo's own background.
 */
export function edgeColor(pixels: Uint8ClampedArray, width: number, height: number): string {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue
      const i = (y * width + x) * 4
      r += pixels[i]!
      g += pixels[i + 1]!
      b += pixels[i + 2]!
      n++
    }
  }
  const hex = (sum: number) => Math.round(sum / Math.max(1, n)).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export const isSmallPhoto = (source: Size) => Math.min(source.width, source.height) < SMALL_PHOTO_EDGE
