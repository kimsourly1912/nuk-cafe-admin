import * as v from 'valibot'
import type { PublicBranch } from './branches'
import { idSchema } from './common'
import type { MenuImage } from './media'
import type { PromotionTag, PublicPromotion } from './menu-promotions'

/**
 * The customer menu (`GET /api/public/menu?branchId=…`, D65): what a branch sells **right now**.
 * Only active items in active categories, available at this moment in the branch's time zone
 * (their own, their category's and the parent category's availability rules), with their sellable
 * versions, each marked sold out or not at the branch (D93: shown as "Sold out", not hidden). Empty
 * categories are left out.
 *
 * A menu read is never a reservation: checkout checks availability and prices again.
 */

export interface PublicMenuModifier {
  id: string
  name: string
  /** Added to the version's price, in cents: this item's own price if it has one, else the default. */
  priceDeltaMinor: number
  /** Pre-selected. */
  isDefault: boolean
}

export interface PublicMenuModifierGroup {
  id: string
  name: string
  /** The rules on this item (its own if it overrides them); the minimum never exceeds the add-ons listed. */
  minSelect: number
  maxSelect: number | null
  modifiers: PublicMenuModifier[]
}

export interface PublicMenuVariation {
  id: string
  /** One value per option set, in the item's option-set order (empty without option sets). */
  valueIds: string[]
  /** "Large, Iced" (`''` without option sets). */
  label: string
  /** What the customer pays: after a live promotion, if one applies (M1, D163). */
  priceMinor: number
  /** The price before the promotion; `null` without one. */
  regularPriceMinor: number | null
  /** The promotion lowering this version's price (the bigger discount wins). */
  promotion: PromotionTag | null
  /** Switched off at this branch (D64): shown, not orderable. */
  soldOut: boolean
}

export interface PublicMenuItem {
  id: string
  name: string
  description: string
  /** The photo's card file (`image.card`), kept for older callers. */
  imageUrl: string | null
  /** The photo's files and placeholder (D158). */
  image: MenuImage | null
  /** Only the values some listed version uses. */
  optionSets: { id: string, name: string, values: { id: string, name: string }[] }[]
  /** At least one, in the grid's order. */
  variations: PublicMenuVariation[]
  /** Every version is sold out at this branch. */
  soldOut: boolean
  modifierGroups: PublicMenuModifierGroup[]
  /** The badge: the promotion with the biggest discount on any of its versions. */
  promotion: PromotionTag | null
}

export interface PublicMenuCategory {
  id: string
  name: string
  description: string
  /** Sub-categories (top-level categories only; a category holds sub-categories or items). */
  categories: PublicMenuCategory[]
  items: PublicMenuItem[]
}

export interface PublicMenu {
  /** The branch and whether it takes orders now (D93). */
  branch: PublicBranch
  currency: 'USD'
  /** The moment the menu was computed for (ISO 8601 UTC). */
  at: string
  categories: PublicMenuCategory[]
  /** Live promotions at this branch that lower a price on this menu now (M1, D163). */
  promotions: PublicPromotion[]
}

export const publicMenuQuerySchema = v.object({
  /** Omitted: the first active branch by name (launch has one, D45), so a page can render without knowing it (D95). */
  branchId: v.optional(idSchema),
})
export type PublicMenuQuery = v.InferOutput<typeof publicMenuQuerySchema>
