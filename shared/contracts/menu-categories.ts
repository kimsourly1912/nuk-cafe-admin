import * as v from 'valibot'
import { idSchema, nameSchema, textSchema, versionSchema } from './common'
import type { AvailabilityRuleRef } from './menu-availability'
import { availabilityRuleIdsSchema } from './menu-availability'

/**
 * Menu categories (`/api/admin/menu/categories`, D44, D55): a two-level tree of top-level categories
 * and sub-categories. A category holds either sub-categories or items, never both. Sort order is
 * per parent. Archived, never deleted.
 */

export const CATEGORY_STATUSES = ['active', 'archived'] as const
export type CategoryStatus = typeof CATEGORY_STATUSES[number]

export const CATEGORY_NAME_MAX = 60
export const CATEGORY_DESCRIPTION_MAX = 500
/** More siblings than a menu should ever need; bounds the reorder request. */
export const MAX_SIBLINGS = 200

export interface MenuCategory {
  id: string
  /** `null`: a top-level category. */
  parentId: string | null
  name: string
  description: string
  /** Position among its siblings, ascending (gaps are normal after archiving; ties sort by name). */
  sortOrder: number
  status: CategoryStatus
  /** Active sub-categories (always 0 for a sub-category). */
  childCount: number
  /** Menu items in it that aren't archived (drafts and published): a category holding items can't get sub-categories. */
  itemCount: number
  /**
   * When its items are sold (by name): none = no limit of its own, several = when any matches. A
   * sub-category's items follow its parent's rules too. An archived rule stays until removed, and
   * never matches.
   */
  availabilityRules: AvailabilityRuleRef[]
  version: number
  createdAt: string
  updatedAt: string
}

const parentIdSchema = v.nullable(idSchema)

export const categoryListQuerySchema = v.object({
  /** `active` (default), `archived`, or `all`. */
  status: v.optional(v.picklist(['active', 'archived', 'all']), 'active'),
})
export type CategoryListQuery = v.InferOutput<typeof categoryListQuerySchema>

export const createCategorySchema = v.strictObject({
  name: nameSchema(CATEGORY_NAME_MAX),
  description: v.optional(textSchema(CATEGORY_DESCRIPTION_MAX), ''),
  /** Omit or `null` for a top-level category; a top-level category's id for a sub-category. */
  parentId: v.optional(parentIdSchema, null),
  availabilityRuleIds: v.optional(availabilityRuleIdsSchema, []),
})
export type CreateCategoryInput = v.InferOutput<typeof createCategorySchema>

/**
 * Only the fields to change: absent keeps. `parentId` moves the category (`null`: to the top
 * level); it goes to the end of its new siblings.
 */
export const updateCategorySchema = v.strictObject({
  version: versionSchema,
  name: v.optional(nameSchema(CATEGORY_NAME_MAX)),
  description: v.optional(textSchema(CATEGORY_DESCRIPTION_MAX)),
  parentId: v.optional(parentIdSchema),
  /** Replaces the rules it uses; `[]`: no limit of its own. */
  availabilityRuleIds: v.optional(availabilityRuleIdsSchema),
})
export type UpdateCategoryInput = v.InferOutput<typeof updateCategorySchema>

/** Archive or restore: the version read. */
export const categoryStatusChangeSchema = v.strictObject({ version: versionSchema })
export type CategoryStatusChangeInput = v.InferOutput<typeof categoryStatusChangeSchema>

/**
 * Restore: the version read; `withSubcategories` (top-level only) also restores its archived
 * sub-categories, in the same write.
 */
export const restoreCategorySchema = v.strictObject({
  version: versionSchema,
  withSubcategories: v.optional(v.boolean(), false),
})
// The input shape: `withSubcategories` may be left out (the parsed body always has it).
export type RestoreCategoryInput = v.InferInput<typeof restoreCategorySchema>

/**
 * The new order of one parent's active children (`parentId: null` for the top level). Must list
 * every one of them, each with the version read, or nothing changes (409).
 */
export const reorderCategoriesSchema = v.strictObject({
  parentId: parentIdSchema,
  items: v.pipe(
    v.array(v.strictObject({ id: idSchema, version: versionSchema })),
    v.minLength(1),
    v.maxLength(MAX_SIBLINGS),
    v.check(items => new Set(items.map(i => i.id)).size === items.length, 'Each category can be listed only once'),
  ),
})
export type ReorderCategoriesInput = v.InferOutput<typeof reorderCategoriesSchema>
