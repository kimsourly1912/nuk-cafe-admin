import * as v from 'valibot'

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

// --- Menu photos (D158) ---

/**
 * A menu item's photo as the menu shows it: the square `card` (menu cards, checkout, orders), the
 * 4:3 `detail` (the item's page, the admin grid) with a half-size `detailSmall` for phones, and a
 * tiny blurred `placeholder` (a data URL) shown while they load. A photo uploaded before D158 has
 * one file: `card` and `detail` are the same, `detailSmall` and `placeholder` `null`.
 */
export interface MenuImage {
  card: string
  detail: string
  detailSmall: string | null
  placeholder: string | null
}

/** The files the photo editor makes, in pixels. The server refuses any other size. */
export const PHOTO_SIZES = {
  card: { width: 480, height: 480 },
  detail: { width: 1200, height: 900 },
  detailSmall: { width: 600, height: 450 },
} as const
export type PhotoVariant = keyof typeof PHOTO_SIZES

/** The private source: the photo the right way up, its longest side at most this. */
export const PHOTO_SOURCE_MAX_EDGE = 2400
/** A placeholder is a few hundred bytes; anything near this is not one. */
export const PHOTO_PLACEHOLDER_MAX_LENGTH = 2048
/** The whole upload: the source and three small files. */
export const PHOTO_UPLOAD_MAX_BYTES = 8 * 1024 * 1024

const fraction = v.pipe(v.number(), v.minValue(0), v.maxValue(1))

/**
 * One view of a photo (D158): `zoom` 1 fills the frame (the photo covers it), below 1 shows more of
 * the photo with the fill colour around it, up to 4 closer; `x`/`y` the point of the photo at the
 * frame's centre, as fractions of its width and height. `adjusted`: the owner moved it, so moving
 * the focus point no longer moves it.
 */
export const photoViewSchema = v.object({
  zoom: v.pipe(v.number(), v.minValue(0.1), v.maxValue(4)),
  x: fraction,
  y: fraction,
  adjusted: v.boolean(),
})
export type PhotoView = v.InferOutput<typeof photoViewSchema>

/** How the editor made a photo's files, kept so it can be edited again exactly. */
export const photoEditSchema = v.object({
  /** The middle of the dish, as fractions of the source. */
  focus: v.object({ x: fraction, y: fraction }),
  card: photoViewSchema,
  detail: photoViewSchema,
  /** The colour around a photo zoomed out to show all of it (`#rrggbb`). */
  fill: v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i)),
})
export type PhotoEdit = v.InferOutput<typeof photoEditSchema>

/** `POST /api/admin/media/photos`: the photo, temporary until a menu item uses it. */
export interface UploadedPhoto {
  id: string
  image: MenuImage
}

/** `GET /api/admin/media/photos/{id}`: what the editor needs to open a photo again. */
export interface PhotoForEdit {
  id: string
  /**
   * `null` for a photo from before D158 (one public file, at `image.card`): the editor starts from
   * that file. Otherwise the private source is at `GET /api/admin/media/photos/{id}/source`.
   */
  edit: PhotoEdit | null
  image: MenuImage
}
