import type { PhotoEdit } from '#shared/contracts/media'
import { PHOTO_SIZES } from '#shared/contracts/media'
import type { PhotoSource } from '~/utils/image-canvas'
import { canvasOf } from '~/utils/image-canvas'
import type { Size } from '~/utils/image-crop'
import type { ViewName } from './photo'
import { edgeColor, frameOf, placePhoto } from './photo'

/**
 * The menu photo editor's drawing (D158), in the browser: the files made from the source. Placed
 * with `placePhoto`, like the previews. Opening, turning and showing the source is shared
 * (`app/utils/image-canvas.ts`) and re-exported here.
 */

export type { PhotoSource } from '~/utils/image-canvas'
export { loadPhoto, rotatePhoto, sourceUrl } from '~/utils/image-canvas'

/** The fill colour around a zoomed-out photo: its edges' average, measured on a small copy. */
export function fillOf(source: PhotoSource): string {
  const scale = 48 / Math.max(source.size.width, source.size.height)
  const size: Size = { width: Math.max(2, Math.round(source.size.width * scale)), height: Math.max(2, Math.round(source.size.height * scale)) }
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
