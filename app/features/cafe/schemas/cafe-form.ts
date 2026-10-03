import * as v from 'valibot'
import type { CafeSettings, UpdateCafeInput } from '#shared/contracts/cafe'
import { CAFE_NAME_MAX } from '#shared/contracts/cafe'

/**
 * The Cafe profile draft (D143): the name and the logo. The logo is an upload's `url` (the preview)
 * and asset `id` (what's saved); both empty for no logo.
 */
export interface CafeForm {
  name: string
  logoUrl?: string
  logoId?: string
}

export const cafeFormSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, 'Cafe name is required'),
    v.maxLength(CAFE_NAME_MAX, `At most ${CAFE_NAME_MAX} characters`),
  ),
  logoUrl: v.optional(v.string()),
  logoId: v.optional(v.string()),
})

export function toCafeForm(settings: CafeSettings): CafeForm {
  return { name: settings.name, logoUrl: settings.logoUrl ?? undefined, logoId: settings.logoAssetId ?? undefined }
}

/** The save, at the version the draft is based on. */
export function toUpdateCafeBody(form: CafeForm, version: number): UpdateCafeInput {
  return { version, name: form.name.trim(), logoAssetId: form.logoId ?? null }
}
