import * as v from 'valibot'
import { idSchema, nameSchema, optionalParam, pageQuerySchema, textSchema, versionSchema } from './common'
import type { AvailabilityRuleRef } from './menu-availability'
import { availabilityRuleIdsSchema } from './menu-availability'
import { MAX_MODIFIER_PRICE_MINOR, MAX_MODIFIERS } from './menu-modifiers'

/**
 * Menu items (`/api/admin/menu/items`, D44, D60). An item sits in a leaf category and has one or
 * more priced versions ("variations"): one per combination of its option sets' values (the price
 * grid), or a single one without option sets. The item's `version` covers the item, its option
 * sets and its variations: the form saves them together.
 */

export const ITEM_STATUSES = ['draft', 'active', 'archived'] as const
export type ItemStatus = typeof ITEM_STATUSES[number]

/** `active`: sold (if its values are active); `disabled`: in the grid, switched off. */
export const GRID_VARIATION_STATUSES = ['active', 'disabled'] as const
export type GridVariationStatus = typeof GRID_VARIATION_STATUSES[number]

export const ITEM_NAME_MAX = 80
export const ITEM_DESCRIPTION_MAX = 500
export const MAX_ITEM_OPTION_SETS = 2
/** Add-on groups per item. */
export const MAX_ITEM_MODIFIER_GROUPS = 10
/** A variation's price, in cents: a typo guard ($1,000). */
export const MAX_VARIATION_PRICE_MINOR = 100_000

export interface MenuItemSummary {
  id: string
  name: string
  categoryId: string
  categoryName: string
  status: ItemStatus
  imageUrl: string | null
  /** Cheapest and dearest sellable version; `null` when none is sellable. */
  priceMinMinor: number | null
  priceMaxMinor: number | null
  sortOrder: number
  version: number
  updatedAt: string
}

export interface ItemOptionSet {
  id: string
  name: string
  /** An archived set stays on items that already use it. */
  status: 'active' | 'archived'
  /** The set's active values in order, then archived values some variation still uses. */
  values: { id: string, name: string, status: 'active' | 'archived' }[]
}

export interface MenuItemVariation {
  id: string
  /** One value per option set, in the item's option-set order (empty without option sets). */
  valueIds: string[]
  /** "Large, Iced" (`''` without option sets). */
  label: string
  priceMinor: number | null
  status: GridVariationStatus
  /** Active, priced, and none of its values archived. */
  sellable: boolean
}

export interface ItemModifier {
  id: string
  name: string
  /** What the customer pays on this item: the item's price if set, else the group's default. */
  priceDeltaMinor: number
  defaultPriceDeltaMinor: number
  priceOverridden: boolean
  isDefault: boolean
  status: 'active' | 'archived'
}

export interface ItemModifierGroup {
  id: string
  name: string
  /** An archived group stays on items that already offer it. */
  status: 'active' | 'archived'
  /** The rules that apply on this item: its own if overridden, else the group's. */
  minSelect: number
  maxSelect: number | null
  rulesOverridden: boolean
  /** The group's active add-ons in order, then archived ones this item has a price for. */
  modifiers: ItemModifier[]
}

export interface MenuItem {
  id: string
  categoryId: string
  name: string
  description: string
  image: { id: string, url: string } | null
  status: ItemStatus
  sortOrder: number
  optionSets: ItemOptionSet[]
  /** The grid (active values' combinations) first, then variations hidden by an archived value. */
  variations: MenuItemVariation[]
  /** The add-on groups it offers, in order. */
  modifierGroups: ItemModifierGroup[]
  /**
   * When it's sold (by name): none = whenever the branch is open, several = when any matches, and
   * its category's rules apply too. An archived rule stays until removed, and never matches.
   */
  availabilityRules: AvailabilityRuleRef[]
  version: number
  createdAt: string
  updatedAt: string
}

const priceMinor = v.nullable(v.pipe(v.number(), v.integer('Must be whole cents'), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_VARIATION_PRICE_MINOR, `At most $${MAX_VARIATION_PRICE_MINOR / 100}`)))

const variationSchema = v.strictObject({
  /** One value id per chosen option set, in any order. */
  valueIds: v.pipe(v.array(idSchema), v.maxLength(MAX_ITEM_OPTION_SETS)),
  priceMinor,
  status: v.picklist(GRID_VARIATION_STATUSES),
})

/**
 * The add-on groups an item offers, in order. `rules`: this item's own `minSelect` / `maxSelect`
 * (`null`: use the group's). `prices`: this item's price for some of the group's add-ons.
 */
const itemModifierGroups = v.pipe(
  v.array(v.strictObject({
    groupId: idSchema,
    rules: v.optional(v.nullable(v.strictObject({
      minSelect: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_MODIFIERS)),
      maxSelect: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_MODIFIERS))),
    })), null),
    prices: v.optional(v.pipe(
      v.array(v.strictObject({
        modifierId: idSchema,
        priceDeltaMinor: v.pipe(v.number(), v.integer('Must be whole cents'), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_MODIFIER_PRICE_MINOR)),
      })),
      v.maxLength(MAX_MODIFIERS),
      v.check(list => new Set(list.map(p => p.modifierId)).size === list.length, 'Each add-on can have one price'),
    ), []),
  })),
  v.maxLength(MAX_ITEM_MODIFIER_GROUPS, `At most ${MAX_ITEM_MODIFIER_GROUPS} add-on groups`),
  v.check(list => new Set(list.map(g => g.groupId)).size === list.length, 'Each add-on group can be offered once'),
)
export type ItemModifierGroupsInput = v.InferOutput<typeof itemModifierGroups>

const optionSetIds = v.pipe(
  v.array(idSchema),
  v.maxLength(MAX_ITEM_OPTION_SETS, `At most ${MAX_ITEM_OPTION_SETS} option sets`),
  v.check(ids => new Set(ids).size === ids.length, 'Each option set can be chosen once'),
)
const variations = v.pipe(v.array(variationSchema), v.minLength(1), v.maxLength(400))

export const itemListQuerySchema = v.object({
  ...pageQuerySchema,
  search: optionalParam(v.pipe(v.string(), v.trim(), v.maxLength(100))),
  categoryId: optionalParam(idSchema),
  /** Default: everything but archived. */
  status: optionalParam(v.picklist([...ITEM_STATUSES, 'all'])),
})
export type ItemListQuery = v.InferOutput<typeof itemListQuerySchema>

/**
 * A new item (a draft; publish it to sell it). `variations` is the whole grid: every combination of
 * the chosen option sets' active values, once (a single `valueIds: []` without option sets).
 */
export const createItemSchema = v.strictObject({
  categoryId: idSchema,
  name: nameSchema(ITEM_NAME_MAX),
  description: v.optional(textSchema(ITEM_DESCRIPTION_MAX), ''),
  imageId: v.optional(v.nullable(idSchema), null),
  optionSetIds: v.optional(optionSetIds, []),
  variations,
  modifierGroups: v.optional(itemModifierGroups, []),
  availabilityRuleIds: v.optional(availabilityRuleIdsSchema, []),
})
export type CreateItemInput = v.InferOutput<typeof createItemSchema>

/**
 * Only the fields to change: absent keeps. A new `categoryId` moves the item to the end of that
 * category. `imageId: null` removes the image. `optionSetIds` needs `variations` (the new grid);
 * `variations` alone replaces the current grid's prices and switches.
 */
export const updateItemSchema = v.pipe(
  v.strictObject({
    version: versionSchema,
    categoryId: v.optional(idSchema),
    name: v.optional(nameSchema(ITEM_NAME_MAX)),
    description: v.optional(textSchema(ITEM_DESCRIPTION_MAX)),
    imageId: v.optional(v.nullable(idSchema)),
    optionSetIds: v.optional(optionSetIds),
    variations: v.optional(variations),
    /** Replaces the whole list of add-on groups, with their rules and prices. */
    modifierGroups: v.optional(itemModifierGroups),
    /** Replaces the rules it uses; `[]`: whenever the branch is open. */
    availabilityRuleIds: v.optional(availabilityRuleIdsSchema),
  }),
  v.forward(v.partialCheck([['optionSetIds'], ['variations']], input => input.optionSetIds === undefined || input.variations !== undefined, 'Send the new price grid with the option sets'), ['variations']),
)
export type UpdateItemInput = v.InferOutput<typeof updateItemSchema>

/** Publish, unpublish, archive or restore: the version read. */
export const itemVersionSchema = v.strictObject({ version: versionSchema })
export type ItemVersionInput = v.InferOutput<typeof itemVersionSchema>

/** The new order of a category's items (drafts and active ones), each with the version read. */
export const reorderItemsSchema = v.strictObject({
  categoryId: idSchema,
  items: v.pipe(
    v.array(v.strictObject({ id: idSchema, version: versionSchema })),
    v.minLength(1),
    v.maxLength(500),
    v.check(items => new Set(items.map(i => i.id)).size === items.length, 'Each item can be listed only once'),
  ),
})
export type ReorderItemsInput = v.InferOutput<typeof reorderItemsSchema>
