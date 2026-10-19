import { PHOTO_SOURCE_MAX_EDGE } from '#shared/contracts/media'
import type { CropView, Size } from './image-crop'
import { cropFrame, cropOutputSize, placePhoto } from './image-crop'
import { encodeImage, IMAGE_MAX_EDGE, IMAGE_QUALITY } from './shrink-image'

/**
 * Drawing photos in the browser, shared by the photo editors (D158, D161): a photo opened the right
 * way up and at most 2400 px, turned in quarters, shown at a lighter size, and cropped to a frame
 * as a file. Not unit-tested (it needs a canvas); the geometry it places with is (`image-crop.ts`).
 */

export interface PhotoSource {
  canvas: HTMLCanvasElement
  size: Size
}

export function canvasOf(size: Size) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser can\'t draw images.')
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

/** The photo's size the right way up, read without decoding its pixels; `undefined` if unreadable. */
export async function uprightSize(file: Blob): Promise<Size | undefined> {
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

/**
 * The framed part of the photo as a file to upload (WebP, or JPEG where the browser can't write
 * WebP): in the frame's proportions, at the photo's own pixels, the longest side at most `maxEdge`.
 * Named after `name` (the picked file's name). `quality` is the encoder's, 0 to 1 (higher for
 * designs with text, which soft compression blurs).
 */
export async function cropPhoto(source: PhotoSource, ratio: number, view: CropView, name: string, maxEdge = IMAGE_MAX_EDGE, quality = IMAGE_QUALITY): Promise<File> {
  const frame = cropFrame(ratio)
  const size = cropOutputSize(source.size, frame, view, maxEdge)
  const { canvas, context } = canvasOf(size)
  const placed = placePhoto(source.size, frame, view)
  const unit = size.height / frame.height
  context.drawImage(source.canvas, placed.x * unit, placed.y * unit, placed.width * unit, placed.height * unit)
  const blob = await encodeImage(canvas, quality)
  if (!blob) throw new Error('This browser couldn\'t save the photo.')
  const base = name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${base}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type })
}
