import * as v from 'valibot'
import { idSchema, nameSchema, versionSchema } from './common'

/**
 * A cafe's profile (step T2b, D143): its name and logo, shown on its menu, admin and counter.
 * `GET /api/cafes/{slug}` reads it from anywhere (the account pages have no cafe in their address,
 * the menu renders on the server); `/api/c/<slug>/admin/cafe` is the owner's settings page.
 */

export const CAFE_NAME_MAX = 80

export interface CafeProfile {
  slug: string
  name: string
  /** `/media/…`, or `null` without a logo (the app shows its coffee icon). */
  logoUrl: string | null
  /** A paused cafe still has a profile: its pages say it's paused, by name. */
  status: 'active' | 'suspended'
}

/** The owner's view: the profile plus what a save needs. */
export interface CafeSettings extends CafeProfile {
  logoAssetId: string | null
  /** Send it back with the save (409 when someone changed the cafe meanwhile). */
  version: number
}

/** `PATCH /api/c/<slug>/admin/cafe`: the name, and the logo (an upload's id, or `null` for none). */
export const updateCafeSchema = v.object({
  version: versionSchema,
  name: nameSchema(CAFE_NAME_MAX),
  logoAssetId: v.nullable(idSchema),
})
export type UpdateCafeInput = v.InferOutput<typeof updateCafeSchema>
