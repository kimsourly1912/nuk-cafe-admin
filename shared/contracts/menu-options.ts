import * as v from 'valibot'
import { idSchema, nameSchema, versionSchema } from './common'

/**
 * The Options library (`/api/admin/menu/option-sets`, D44, D58): reusable option sets ("Size",
 * "Temperature") with named values ("Small", "Regular", "Large"). Names only: prices live on each
 * menu item's versions (step 3.5). A set's `version` covers its values too: send the one you read
 * with every change to the set or any of its values.
 */

export const OPTION_STATUSES = ['active', 'archived'] as const
export type OptionStatus = typeof OPTION_STATUSES[number]

export const OPTION_SET_NAME_MAX = 40
export const OPTION_VALUE_NAME_MAX = 40
/** Values per set: a price grid of 2 sets stays readable. */
export const MAX_OPTION_VALUES = 20

export interface OptionValue {
  id: string
  name: string
  /** Position within the set, ascending (gaps are normal after archiving). */
  sortOrder: number
  status: OptionStatus
}

export interface OptionSet {
  id: string
  name: string
  status: OptionStatus
  /** Active values first in order, then archived ones. */
  values: OptionValue[]
  version: number
  createdAt: string
  updatedAt: string
}

const setName = nameSchema(OPTION_SET_NAME_MAX)
const valueName = nameSchema(OPTION_VALUE_NAME_MAX)

export const optionSetListQuerySchema = v.object({
  status: v.optional(v.picklist(['active', 'archived', 'all']), 'active'),
})
export type OptionSetListQuery = v.InferOutput<typeof optionSetListQuerySchema>

/** A set with its first values, in order. */
export const createOptionSetSchema = v.strictObject({
  name: setName,
  values: v.pipe(
    v.array(valueName),
    v.minLength(1, 'Add at least one value'),
    v.maxLength(MAX_OPTION_VALUES, `At most ${MAX_OPTION_VALUES} values`),
    v.check(names => new Set(names.map(n => n.toLowerCase())).size === names.length, 'Each value can be listed only once'),
  ),
})
export type CreateOptionSetInput = v.InferOutput<typeof createOptionSetSchema>

export const renameOptionSetSchema = v.strictObject({ version: versionSchema, name: setName })
export type RenameOptionSetInput = v.InferOutput<typeof renameOptionSetSchema>

/** Archive or restore a set or one of its values: the set's version. */
export const optionVersionSchema = v.strictObject({ version: versionSchema })
export type OptionVersionInput = v.InferOutput<typeof optionVersionSchema>

export const addOptionValueSchema = v.strictObject({ version: versionSchema, name: valueName })
export type AddOptionValueInput = v.InferOutput<typeof addOptionValueSchema>

export const renameOptionValueSchema = v.strictObject({ version: versionSchema, name: valueName })
export type RenameOptionValueInput = v.InferOutput<typeof renameOptionValueSchema>

/** The new order of the set's active values: every one of them, once. */
export const reorderOptionValuesSchema = v.strictObject({
  version: versionSchema,
  valueIds: v.pipe(
    v.array(idSchema),
    v.minLength(1),
    v.maxLength(MAX_OPTION_VALUES),
    v.check(ids => new Set(ids).size === ids.length, 'Each value can be listed only once'),
  ),
})
export type ReorderOptionValuesInput = v.InferOutput<typeof reorderOptionValuesSchema>
