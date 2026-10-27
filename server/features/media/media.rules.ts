import type { ImageType } from '#shared/contracts/media'
import { IMAGE_TYPES } from '#shared/contracts/media'
import { newId } from '#server/utils/ids'

/** Pure media rules (no I/O). */

export const TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000

/** Public files only; photo sources and encoded/nested paths are never eligible. */
export const isPublicMediaKey = (key: string) => /^(?:t\/[\w-]+\/)?menu\/[\w-]+\.(?:jpg|png|webp)$/.test(key)

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

/** A menu photo's private source (D158): under `source/`, which `/media/…` never serves. */
export const sourceKeyFor = (tenantId: string, type: ImageType) => `t/${tenantId}/source/${newId()}.${EXTENSIONS[type]}`

/** Big-endian and little-endian reads, for image headers. */
const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)

/**
 * An image's width and height from its header, without decoding it (a Worker has a few
 * milliseconds of CPU, D158): PNG's IHDR, JPEG's first frame header, WebP's VP8, VP8L or VP8X
 * chunk. `undefined` when the header can't be read.
 */
export function imageSize(bytes: Uint8Array, type: ImageType): { width: number, height: number } | undefined {
  if (type === 'image/png') {
    if (bytes.length < 24) return undefined
    return { width: be32(bytes, 16), height: be32(bytes, 20) }
  }
  if (type === 'image/webp') {
    if (bytes.length < 30) return undefined
    const chunk = String.fromCharCode(...bytes.slice(12, 16))
    if (chunk === 'VP8 ') return { width: le16(bytes, 26) & 0x3FFF, height: le16(bytes, 28) & 0x3FFF }
    if (chunk === 'VP8L') {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
      return { width: (bits & 0x3FFF) + 1, height: ((bits >>> 14) & 0x3FFF) + 1 }
    }
    if (chunk === 'VP8X') return { width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 }
    return undefined
  }
  // JPEG: walk the markers to the first start-of-frame (SOF0–SOF15, not DHT/JPG/DAC).
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xFF) return undefined
    const marker = bytes[i + 1]!
    if (marker === 0xFF) {
      i++
      continue
    }
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { width: be16(bytes, i + 7), height: be16(bytes, i + 5) }
    }
    i += 2 + be16(bytes, i + 2)
  }
  return undefined
}

/** A placeholder data URL as the editor makes them: a tiny image, base64, nothing else. */
export const isPlaceholder = (value: string) => /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(value)
