import * as v from 'valibot'
import { idSchema, nameSchema, versionSchema } from './common'

/**
 * The Add-ons library (`/api/admin/menu/modifier-groups`, D44, D59): reusable groups of extras
 * ("Milk": Whole, Oat +$0.50) with default prices and selection rules. The admin screen calls them
 * "Add-ons"; the data model calls them modifier groups. A group's `version` covers its modifiers
 * too: send the one you read with every change to the group or any of its modifiers.
 */

export const MODIFIER_STATUSES = ['active', 'archived'] as const
export type ModifierStatus = typeof MODIFIER_STATUSES[number]

export const MODIFIER_GROUP_NAME_MAX = 40
export const MODIFIER_NAME_MAX = 40
export const MAX_MODIFIERS = 30
/** An add-on's price, in cents: a typo guard ($100). */
export const MAX_MODIFIER_PRICE_MINOR = 10_000

export interface Modifier {
  id: string
  name: string
  /** Added to the item's price, in cents. */
  priceDeltaMinor: number
  isDefault: boolean
  sortOrder: number
  status: ModifierStatus
}

export interface ModifierGroup {
  id: string
  name: string
  /** How many the customer must choose (0 = optional). */
  minSelect: number
  /** How many they may choose; `null` = no limit. */
  maxSelect: number | null
  status: ModifierStatus
  /** Active modifiers first in order, then archived ones. */
  modifiers: Modifier[]
  version: number
  createdAt: string
  updatedAt: string
}

const groupName = nameSchema(MODIFIER_GROUP_NAME_MAX)
const modifierName = nameSchema(MODIFIER_NAME_MAX)
const priceDeltaMinor = v.pipe(v.number(), v.integer('Must be whole cents'), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_MODIFIER_PRICE_MINOR, `At most $${MAX_MODIFIER_PRICE_MINOR / 100}`))
const minSelect = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_MODIFIERS))
const maxSelect = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_MODIFIERS)))

export const modifierGroupListQuerySchema = v.object({
  status: v.optional(v.picklist(['active', 'archived', 'all']), 'active'),
})
export type ModifierGroupListQuery = v.InferOutput<typeof modifierGroupListQuerySchema>

const newModifierSchema = v.strictObject({
  name: modifierName,
  priceDeltaMinor: v.optional(priceDeltaMinor, 0),
  isDefault: v.optional(v.boolean(), false),
})

/** A group with its first add-ons, in order. The selection rules are checked against them. */
export const createModifierGroupSchema = v.strictObject({
  name: groupName,
  minSelect: v.optional(minSelect, 0),
  maxSelect: v.optional(maxSelect, null),
  modifiers: v.pipe(
    v.array(newModifierSchema),
    v.minLength(1, 'Add at least one add-on'),
    v.maxLength(MAX_MODIFIERS, `At most ${MAX_MODIFIERS} add-ons`),
    v.check(list => new Set(list.map(m => m.name.toLowerCase())).size === list.length, 'Each add-on can be listed only once'),
  ),
})
export type CreateModifierGroupInput = v.InferOutput<typeof createModifierGroupSchema>

/** Only the fields to change: absent keeps. `maxSelect: null` removes the limit. */
export const updateModifierGroupSchema = v.strictObject({
  version: versionSchema,
  name: v.optional(groupName),
  minSelect: v.optional(minSelect),
  maxSelect: v.optional(maxSelect),
})
export type UpdateModifierGroupInput = v.InferOutput<typeof updateModifierGroupSchema>

/** Archive or restore a group or one of its add-ons: the group's version. */
export const modifierVersionSchema = v.strictObject({ version: versionSchema })
export type ModifierVersionInput = v.InferOutput<typeof modifierVersionSchema>

export const addModifierSchema = v.strictObject({
  version: versionSchema,
  name: modifierName,
  priceDeltaMinor: v.optional(priceDeltaMinor, 0),
  isDefault: v.optional(v.boolean(), false),
})
export type AddModifierInput = v.InferOutput<typeof addModifierSchema>

export const updateModifierSchema = v.strictObject({
  version: versionSchema,
  name: v.optional(modifierName),
  priceDeltaMinor: v.optional(priceDeltaMinor),
  isDefault: v.optional(v.boolean()),
})
export type UpdateModifierInput = v.InferOutput<typeof updateModifierSchema>

export const reorderModifiersSchema = v.strictObject({
  version: versionSchema,
  modifierIds: v.pipe(
    v.array(idSchema),
    v.minLength(1),
    v.maxLength(MAX_MODIFIERS),
    v.check(ids => new Set(ids).size === ids.length, 'Each add-on can be listed only once'),
  ),
})
export type ReorderModifiersInput = v.InferOutput<typeof reorderModifiersSchema>
