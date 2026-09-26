import * as v from 'valibot'
import type { Status } from './common'
import { idSchema, intParam, nameSchema, optionalParam, pageQuerySchema, statusSchema, textSchema, versionSchema } from './common'

/*
 * Menu contracts for `/api/v1/admin/*` (docs/reference/api.md → Menu).
 * Update bodies are partial: a field that is absent is kept, `null` clears a nullable field.
 * Every update and delete names the `version` it read; a stale one gets 409 VERSION_CONFLICT.
 */

// --- Categories ---

export interface Category {
  id: string
  name: string
  /** `null` for a main category. */
  parentId: string | null
  status: Status
  /** Position among its siblings (mains, or the subs of one main), from 1. */
  sortOrder: number
  version: number
  createdAt: string
  updatedAt: string
}

export const categoryListQuery = v.object({
  level: optionalParam(v.picklist(['main', 'sub'])),
})
export type CategoryListQuery = Partial<v.InferOutput<typeof categoryListQuery>>

export const createCategoryBody = v.strictObject({
  name: nameSchema(),
  parentId: v.optional(v.nullable(idSchema), null),
  status: v.optional(statusSchema, 'ACTIVE'),
})
export type CreateCategoryBody = v.InferInput<typeof createCategoryBody>

export const updateCategoryBody = v.strictObject({
  version: versionSchema,
  name: v.optional(nameSchema()),
  parentId: v.optional(v.nullable(idSchema)),
  status: v.optional(statusSchema),
})
export type UpdateCategoryBody = v.InferInput<typeof updateCategoryBody>

/**
 * `PUT /api/v1/admin/categories/order`: each list is **every** child of one parent (`null` = the
 * main categories) in the new order. A list that doesn't match the current children exactly
 * (one was added or removed meanwhile) is rejected with 409 ORDER_STALE.
 */
export const reorderCategoriesBody = v.strictObject({
  lists: v.pipe(
    v.array(v.strictObject({
      parentId: v.nullable(idSchema),
      ids: v.pipe(v.array(idSchema), v.maxLength(500)),
    })),
    v.minLength(1),
    v.maxLength(200),
  ),
})
export type ReorderCategoriesBody = v.InferInput<typeof reorderCategoriesBody>

// --- Schedules ---

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
export type Day = typeof DAYS[number]

/** `HH:mm`, 24-hour. */
export const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export interface Schedule {
  id: string
  name: string
  description: string
  /** In week order. */
  days: Day[]
  /** `HH:mm` local wall time in `timeZone`. */
  startTime: string
  endTime: string
  /** IANA zone the times are in (the cafe's zone). */
  timeZone: string
  status: Status
  /** Menu items that follow this schedule. */
  productCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface ScheduleDetail extends Schedule {
  products: { id: string, name: string, status: Status }[]
}

export interface ScheduleOption {
  id: string
  name: string
  status: Status
}

const timeSchema = v.pipe(v.string(), v.regex(TIME_PATTERN, 'Use HH:mm, e.g. 08:30'))
const daysSchema = v.pipe(
  v.array(v.picklist(DAYS)),
  v.minLength(1, 'Pick at least one day'),
  v.check(days => new Set(days).size === days.length, 'Days must not repeat'),
)
/** Overnight ranges aren't accepted until their rule is decided (D41). */
const END_AFTER_START = 'End time must be after the start time'

export const scheduleListQuery = v.object({
  ...pageQuerySchema,
  search: optionalParam(v.pipe(v.string(), v.maxLength(100))),
  status: optionalParam(statusSchema),
  day: optionalParam(v.picklist(DAYS)),
})
/** The filters as the client builds them (the server parses the same from the query string). */
export type ScheduleListQuery = Partial<v.InferOutput<typeof scheduleListQuery>>

export const createScheduleBody = v.pipe(
  v.strictObject({
    name: nameSchema(),
    description: v.optional(textSchema(), ''),
    days: daysSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    status: v.optional(statusSchema, 'ACTIVE'),
  }),
  v.forward(v.check(s => s.endTime > s.startTime, END_AFTER_START), ['endTime']),
)
export type CreateScheduleBody = v.InferInput<typeof createScheduleBody>

/** Times are checked against the stored ones in the service when only one of them is sent. */
export const updateScheduleBody = v.pipe(
  v.strictObject({
    version: versionSchema,
    name: v.optional(nameSchema()),
    description: v.optional(textSchema()),
    days: v.optional(daysSchema),
    startTime: v.optional(timeSchema),
    endTime: v.optional(timeSchema),
    status: v.optional(statusSchema),
  }),
  v.forward(v.check(s => !s.startTime || !s.endTime || s.endTime > s.startTime, END_AFTER_START), ['endTime']),
)
export type UpdateScheduleBody = v.InferInput<typeof updateScheduleBody>

export const SCHEDULE_END_AFTER_START = END_AFTER_START

// --- Products (menu items) ---

export const CURRENCY = 'USD'
/** Upper bound for a price or an option's extra price, in cents: a typo guard ($10,000). */
export const MAX_PRICE_MINOR = 1_000_000

export interface VariantOption {
  id: string
  name: string
  priceDeltaMinor: number
}

export interface VariantGroup {
  id: string
  name: string
  /** 0 = optional. */
  minSelect: number
  /** `null` = no upper limit. */
  maxSelect: number | null
  options: VariantOption[]
}

export interface Product {
  id: string
  name: string
  description: string
  category: { id: string, name: string, parentId: string | null, status: Status }
  /** Cents of `currency`. */
  priceMinor: number
  currency: typeof CURRENCY
  image: { id: string, url: string } | null
  status: Status
  sortOrder: number
  scheduleIds: string[]
  /** In display order, options too. */
  variantGroups: VariantGroup[]
  version: number
  createdAt: string
  updatedAt: string
}

const priceMinorSchema = v.pipe(v.number(), v.integer('Must be whole cents'), v.minValue(0), v.maxValue(MAX_PRICE_MINOR))

const variantOptionInput = v.strictObject({
  /** Present for an option that already exists; absent creates one. */
  id: v.optional(idSchema),
  name: nameSchema(),
  priceDeltaMinor: v.optional(priceMinorSchema, 0),
})

const variantGroupInput = v.pipe(
  v.strictObject({
    id: v.optional(idSchema),
    name: nameSchema(),
    minSelect: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(50)),
    maxSelect: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
    options: v.pipe(v.array(variantOptionInput), v.minLength(1, 'Add at least one option'), v.maxLength(50)),
  }),
  v.forward(v.check(g => g.maxSelect === null || g.maxSelect >= g.minSelect, 'Must be at least the minimum'), ['maxSelect']),
  v.forward(v.check(g => g.minSelect <= g.options.length, 'More required choices than options'), ['minSelect']),
)
export type VariantGroupInput = v.InferInput<typeof variantGroupInput>

const scheduleIdsSchema = v.pipe(
  v.array(idSchema),
  v.maxLength(50),
  v.check(ids => new Set(ids).size === ids.length, 'Schedules must not repeat'),
)
/**
 * The **complete** list of groups in display order: existing ones keep their `id`, new ones have
 * none, and groups or options left out are deleted.
 */
const variantGroupsSchema = v.pipe(v.array(variantGroupInput), v.maxLength(20))

export const productListQuery = v.object({
  ...pageQuerySchema,
  search: optionalParam(v.pipe(v.string(), v.maxLength(100))),
  categoryId: optionalParam(idSchema),
  status: optionalParam(statusSchema),
})
export type ProductListQuery = Partial<v.InferOutput<typeof productListQuery>>

/** `GET /api/v1/admin/products/all`: the whole filtered menu, for the grouped view. */
export const productMenuQuery = v.object({
  search: productListQuery.entries.search,
  categoryId: productListQuery.entries.categoryId,
  status: productListQuery.entries.status,
})
export type ProductMenuQuery = Partial<v.InferOutput<typeof productMenuQuery>>
export const MAX_MENU_ITEMS = 1000

export const createProductBody = v.strictObject({
  name: nameSchema(),
  description: v.optional(textSchema(), ''),
  categoryId: idSchema,
  priceMinor: priceMinorSchema,
  imageAssetId: v.optional(v.nullable(idSchema), null),
  status: v.optional(statusSchema, 'ACTIVE'),
  scheduleIds: v.optional(scheduleIdsSchema, []),
  variantGroups: v.optional(variantGroupsSchema, []),
})
export type CreateProductBody = v.InferInput<typeof createProductBody>

export const updateProductBody = v.strictObject({
  version: versionSchema,
  name: v.optional(nameSchema()),
  description: v.optional(textSchema()),
  categoryId: v.optional(idSchema),
  priceMinor: v.optional(priceMinorSchema),
  imageAssetId: v.optional(v.nullable(idSchema)),
  status: v.optional(statusSchema),
  scheduleIds: v.optional(scheduleIdsSchema),
  variantGroups: v.optional(variantGroupsSchema),
})
export type UpdateProductBody = v.InferInput<typeof updateProductBody>

// --- Media ---

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** `POST /api/v1/admin/media` (multipart, field `file`). */
export interface UploadedMedia {
  id: string
  url: string
}

/** The version of a record, for `DELETE …?version=` (query strings are text). */
export const versionQuery = v.object({ version: intParam(1, Number.MAX_SAFE_INTEGER) })
