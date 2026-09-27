/**
 * Uploads (`POST /api/admin/media`, D57). An upload is temporary until a record references it, and
 * deleted after 24 hours if none does.
 */

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageType = typeof IMAGE_TYPES[number]

/** 5 MB (D45). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

export interface MediaAsset {
  id: string
  /** Where it's served: `/media/<key>`, same origin (the CSP allows only that). */
  url: string
  mimeType: ImageType
  byteSize: number
}
