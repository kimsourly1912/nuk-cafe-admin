import type { ImageType } from '#shared/contracts/media'
import { IMAGE_TYPES } from '#shared/contracts/media'
import { newId } from '#server/utils/ids'

/** Pure media rules (no I/O). */

export const TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000

const EXTENSIONS: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Where an object is served (`server/routes/media/[...key].get.ts`). */
export const mediaUrl = (objectKey: string) => `/media/${objectKey}`

/**
 * JPEG, PNG or WebP from the file's first bytes, else `undefined`. The browser's claimed type is
 * never trusted on its own: a renamed HTML or SVG file must not be stored as an image.
 */
export function sniffImageType(head: Uint8Array): ImageType | undefined {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b)
  if (starts(0xFF, 0xD8, 0xFF)) return 'image/jpeg'
  if (starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return 'image/png'
  const text = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

export const isImageType = (type: string): type is ImageType => (IMAGE_TYPES as readonly string[]).includes(type)

/**
 * The server picks the key; the client's file name is never used (security.md → Uploads). Under
 * the tenant's prefix (D136), so one tenant's objects can be listed, exported or removed together.
 * Keys stored before T1.2 stay `menu/<id>.<ext>`.
 */
export const objectKeyFor = (tenantId: string, type: ImageType) => `t/${tenantId}/menu/${newId()}.${EXTENSIONS[type]}`

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
