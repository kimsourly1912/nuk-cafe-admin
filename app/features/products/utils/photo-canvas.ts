import type { PhotoEdit } from '#shared/contracts/media'
import { PHOTO_SIZES, PHOTO_SOURCE_MAX_EDGE } from '#shared/contracts/media'
import type { Size, ViewName } from './photo'
import { edgeColor, frameOf, placePhoto } from './photo'

/**
 * The photo editor's drawing (D158), in the browser: the source the right way up and at most
 * 2400 px, and the files made from it. Placed with `placePhoto`, like the previews.
 */

export interface PhotoSource {
  canvas: HTMLCanvasElement
  size: Size
}

function canvasOf(size: Size) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser can\'t draw images.')
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

/**
 * The photo the right way up (its EXIF orientation applied), at most 2400 px on its longest side.
 * Drawing it again also drops its metadata (where it was taken, the camera). Throws when the
 * browser can't read the file (HEIC on most desktop browsers).
 */
export async function loadPhoto(file: Blob): Promise<PhotoSource> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, PHOTO_SOURCE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const size = { width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) }
    const { canvas, context } = canvasOf(size)
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    return { canvas, size }
  }
  finally {
    bitmap.close()
  }
}

/** The photo turned a quarter: `1` clockwise, `-1` the other way. */
export function rotatePhoto(source: PhotoSource, direction: 1 | -1): PhotoSource {
  const size = { width: source.size.height, height: source.size.width }
  const { canvas, context } = canvasOf(size)
  context.translate(size.width / 2, size.height / 2)
  context.rotate((direction * Math.PI) / 2)
  context.drawImage(source.canvas, -source.size.width / 2, -source.size.height / 2)
  return { canvas, size }
}

/** The fill colour around a zoomed-out photo: its edges' average, measured on a small copy. */
export function fillOf(source: PhotoSource): string {
  const scale = 48 / Math.max(source.size.width, source.size.height)
  const size = { width: Math.max(2, Math.round(source.size.width * scale)), height: Math.max(2, Math.round(source.size.height * scale)) }
  const { context } = canvasOf(size)
  context.drawImage(source.canvas, 0, 0, size.width, size.height)
  return edgeColor(context.getImageData(0, 0, size.width, size.height).data, size.width, size.height)
}

/** One view drawn at `size` pixels: the fill colour, then the photo where `placePhoto` puts it. */
export function drawView(source: PhotoSource, edit: PhotoEdit, view: ViewName, size: Size): HTMLCanvasElement {
  const { canvas, context } = canvasOf(size)
  const frame = frameOf(view)
  const unit = size.height / frame.height
  const placed = placePhoto(source.size, frame, edit[view])
  context.fillStyle = edit.fill
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(source.canvas, placed.x * unit, placed.y * unit, placed.width * unit, placed.height * unit)
  return canvas
}

/** The tiny blurred preview shown while the files load: the item page view at 16 × 12, a data URL. */
export function placeholderOf(source: PhotoSource, edit: PhotoEdit): string {
  const canvas = drawView(source, edit, 'detail', { width: 16, height: 12 })
  const webp = canvas.toDataURL('image/webp', 0.5)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.6)
}

async function fileOf(canvas: HTMLCanvasElement, name: string, quality: number): Promise<File> {
  const blob = await encodeImage(canvas, quality)
  if (!blob) throw new Error('This browser couldn\'t save the photo.')
  return new File([blob], `${name}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type })
}

/** Everything `POST /admin/media/photos` takes: the source, the three files, the edit, the placeholder. */
export async function photoUpload(source: PhotoSource, edit: PhotoEdit): Promise<FormData> {
  const body = new FormData()
  body.append('source', await fileOf(source.canvas, 'source', 0.9))
  body.append('card', await fileOf(drawView(source, edit, 'card', PHOTO_SIZES.card), 'card', IMAGE_QUALITY))
  body.append('detail', await fileOf(drawView(source, edit, 'detail', PHOTO_SIZES.detail), 'detail', IMAGE_QUALITY))
  body.append('detailSmall', await fileOf(drawView(source, edit, 'detail', PHOTO_SIZES.detailSmall), 'detail-small', IMAGE_QUALITY))
  body.append('edit', JSON.stringify(edit))
  body.append('placeholder', placeholderOf(source, edit))
  return body
}

/** The source as a blob URL, for the editor's images (revoke it when done). */
export async function sourceUrl(source: PhotoSource): Promise<string> {
  const blob = await new Promise<Blob | null>(resolve => source.canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('This browser couldn\'t show the photo.')
  return URL.createObjectURL(blob)
}
