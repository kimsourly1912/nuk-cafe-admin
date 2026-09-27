import * as v from 'valibot'
import { idSchema, optionalParam } from './common'
import { MAX_OPTION_VALUES } from './menu-options'

/**
 * The counter's menu and its sold-out switch (`/api/counter/{branchId}/menu`, D63). Sold out is
 * per branch and per version ("Large, Iced" out, "Small, Hot" still available); an item is sold out
 * when all its versions are. It stays that way until someone switches it back.
 */

export interface CounterVariation {
  id: string
  /** The option values, in the item's order ("Large, Iced"); `''` for an item without options. */
  label: string
  priceMinor: number
  soldOut: boolean
  /** When it was last switched to sold out (or back); `null` if never. */
  soldOutChangedAt: string | null
}

/** A published item customers can see, with its sellable variations. */
export interface CounterItem {
  id: string
  name: string
  categoryId: string
  categoryName: string
  /** Every variation is sold out. */
  soldOut: boolean
  variations: CounterVariation[]
}

export const counterMenuQuerySchema = v.object({
  search: optionalParam(v.pipe(v.string(), v.trim(), v.maxLength(100))),
  /** `true`: only items with at least one sold-out variation (the "86 list"). */
  soldOut: optionalParam(v.picklist(['true'])),
})
export type CounterMenuQuery = v.InferOutput<typeof counterMenuQuerySchema>

/** The largest price grid: two option sets of 20 values. */
const MAX_VARIATIONS = MAX_OPTION_VALUES * MAX_OPTION_VALUES

/**
 * Sets the switch to a value (not a toggle), so a repeated or concurrent request lands in the same
 * state. `variationIds` absent: every variation of the item.
 */
export const setSoldOutSchema = v.strictObject({
  soldOut: v.boolean(),
  variationIds: v.optional(v.pipe(
    v.array(idSchema),
    v.minLength(1, 'Choose at least one variation'),
    v.maxLength(MAX_VARIATIONS),
    v.check(list => new Set(list).size === list.length, 'Each variation can be listed once'),
  )),
})
export type SetSoldOutInput = v.InferOutput<typeof setSoldOutSchema>
