import * as v from 'valibot'
import { idSchema } from './common'

/**
 * Sold out per branch (`/api/counter/{branchId}/sold-out`, D64): the counter's "86" switch. It
 * works per version of an item ("Large" sold out, "Regular" still sold); switching a whole item
 * sends all its versions. It sets a state, never toggles, so two people pressing at once or a
 * retry both end in the state asked for. It stays until someone switches it back.
 */

/** Versions per request: every version of the largest price grid (20 × 20). */
export const MAX_SOLD_OUT_VARIATIONS = 400

export interface SoldOutVariation {
  variationId: string
  itemId: string
  itemName: string
  /** "Large, Iced" (`''` for an item without option sets). */
  label: string
  /** When it was switched off, and by whom (a user id). */
  updatedAt: string
  updatedBy: string
}

/** What's sold out at the branch now, by item name then version. */
export interface SoldOutList {
  branchId: string
  variations: SoldOutVariation[]
}

export const setSoldOutSchema = v.strictObject({
  variationIds: v.pipe(
    v.array(idSchema),
    v.minLength(1),
    v.maxLength(MAX_SOLD_OUT_VARIATIONS),
    v.check(ids => new Set(ids).size === ids.length, 'Each version can be listed only once'),
  ),
  /** `true`: sold out; `false`: back on sale. */
  soldOut: v.boolean(),
})
export type SetSoldOutInput = v.InferOutput<typeof setSoldOutSchema>
