import { eq } from 'drizzle-orm'
import type { UploadedMedia } from '#shared/contracts/menu'
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '#shared/contracts/menu'
import { mediaAssets } from '../../db/tables'
import type { Db } from '../../db/types'
import { apiError } from '../../utils/api-error'
import type { Actor } from '../identity/service'

/** Where a stored object is served (server/routes/media/[...key].get.ts). */
export const mediaUrl = (objectKey: string) => `/media/${objectKey}`

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/**
 * Checks an uploaded menu image and picks its object key. The type is checked from the file's
 * first bytes, not only from what the browser claims.
 */
export function checkImage(file: { type: string, size: number, head: Uint8Array }): { objectKey: string, mimeType: string } {
  const claimed = file.type
  if (!(IMAGE_TYPES as readonly string[]).includes(claimed) || sniffImageType(file.head) !== claimed) {
    throw apiError(415, 'UNSUPPORTED_MEDIA', 'Use a JPEG, PNG or WebP image.')
  }
  if (file.size > IMAGE_MAX_BYTES) throw apiError(413, 'MEDIA_TOO_LARGE', `The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`)
  if (file.size <= 0) throw apiError(400, 'VALIDATION_FAILED', 'The file is empty.')
  return { objectKey: `menu/${crypto.randomUUID()}.${EXTENSIONS[claimed]}`, mimeType: claimed }
}

/** JPEG, PNG or WebP from the magic bytes, else `undefined`. */
export function sniffImageType(head: Uint8Array): string | undefined {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b)
  if (starts(0xFF, 0xD8, 0xFF)) return 'image/jpeg'
  if (starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return 'image/png'
  const text = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

/**
 * Records an object already stored in R2 as a `temporary` asset. It becomes `attached` when a
 * menu item is saved with it; temporary assets are for a cleanup job (not built yet).
 */
export async function recordUpload(db: Db, actor: Actor, file: { objectKey: string, mimeType: string, byteSize: number }): Promise<UploadedMedia> {
  const [row] = await db.insert(mediaAssets)
    .values({ objectKey: file.objectKey, mimeType: file.mimeType, byteSize: file.byteSize, uploadedBy: actor.userId })
    .returning()
  return { id: row!.id, url: mediaUrl(row!.objectKey) }
}

export async function findAsset(db: Db, id: string) {
  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id))
  return row
}
