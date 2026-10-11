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

/** The photo's size the right way up, read without decoding its pixels; `undefined` if unreadable. */
async function uprightSize(file: Blob): Promise<Size | undefined> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
    })
    return { width: image.naturalWidth, height: image.naturalHeight }
  }
  catch {
    return undefined
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Decoded at most this many pixels at once: a 48 MP photo opened at full size takes about 200 MB,
 * which a phone with little memory can't spare (D160). Bigger ones are decoded already made smaller.
 */
const DECODE_MAX_PIXELS = 16_000_000

/**
 * The photo decoded, made smaller while decoding when it's big. Only the width is given, so the
 * browser keeps the shape whatever it does with the orientation (Chromium resizes upright).
 */
async function decodePhoto(file: Blob): Promise<ImageBitmap> {
  const size = await uprightSize(file)
  if (size && size.width * size.height > DECODE_MAX_PIXELS) {
    const scale = PHOTO_SOURCE_MAX_EDGE / Math.max(size.width, size.height)
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: Math.round(size.width * scale), resizeQuality: 'high' })
    }
    catch {
      // A browser without resizing while decoding: decode it whole below.
    }
  }
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

/**
 * The photo the right way up (its EXIF orientation applied), at most 2400 px on its longest side.
 * Drawing it again also drops its metadata (where it was taken, the camera). Throws when the
 * browser can't read the file (HEIC on most desktop browsers).
 */
export async function loadPhoto(file: Blob): Promise<PhotoSource> {
  const bitmap = await decodePhoto(file)
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

/**
 * A photo ready to upload (D158): what `POST /admin/media/photos` takes, the card file as a blob URL
 * for the form's preview while it uploads, and the source and edit to open it in the editor again
 * meanwhile. Revoke `cardUrl` when done with it.
 */
export interface PreparedPhoto {
  source: PhotoSource
  edit: PhotoEdit
  body: FormData
  cardUrl: string
}

/** Makes the files from the source and the edit (in the browser), ready to upload. */
export async function preparePhoto(source: PhotoSource, edit: PhotoEdit): Promise<PreparedPhoto> {
  const card = await fileOf(drawView(source, edit, 'card', PHOTO_SIZES.card), 'card', IMAGE_QUALITY)
  const body = new FormData()
  body.append('source', await fileOf(source.canvas, 'source', 0.9))
  body.append('card', card)
  body.append('detail', await fileOf(drawView(source, edit, 'detail', PHOTO_SIZES.detail), 'detail', IMAGE_QUALITY))
  body.append('detailSmall', await fileOf(drawView(source, edit, 'detail', PHOTO_SIZES.detailSmall), 'detail-small', IMAGE_QUALITY))
  body.append('edit', JSON.stringify(edit))
  body.append('placeholder', placeholderOf(source, edit))
  return { source, edit, body, cardUrl: URL.createObjectURL(card) }
}

/**
 * The editor shows the photo at most this size: sharp in its frame on a 2× screen, and a quarter of
 * the pixels of the source to encode again after each turn (D161). The files are made from the source.
 */
const DISPLAY_MAX_EDGE = 1200

/** A display copy of the source as a blob URL, for the editor's images (revoke it when done). */
export async function sourceUrl(source: PhotoSource): Promise<string> {
  const scale = Math.min(1, DISPLAY_MAX_EDGE / Math.max(source.size.width, source.size.height))
  const size = { width: Math.max(1, Math.round(source.size.width * scale)), height: Math.max(1, Math.round(source.size.height * scale)) }
  const { canvas, context } = canvasOf(size)
  context.drawImage(source.canvas, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('This browser couldn\'t show the photo.')
  return URL.createObjectURL(blob)
}
