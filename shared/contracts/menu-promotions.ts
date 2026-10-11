import * as v from 'valibot'
import { idSchema, nameSchema, textSchema, versionSchema } from './common'

/**
 * Promotions (`/api/admin/menu/promotions`, step M1, D163): a discount on part of the menu, or all
 * of it, between two dates. The menu, the checkout and the order show the lower price; the poster
 * is an image made elsewhere (Canva, an AI tool) and uploaded finished.
 *
 * - **What**: a percent (1–100) or an amount off each item's price. Add-ons keep their price.
 * - **On what**: the whole menu, or chosen items and categories (a main category includes its
 *   sub-categories).
 * - **When**: from `startsOn` to `endsOn` (or with no end), calendar days in each branch's time zone.
 * - **Where**: every branch, or chosen ones.
 * - **Never together**: when two promotions apply to one item, the bigger discount wins.
 *
 * A promotion is a `draft` (only admins see it), `published` (scheduled, live, or past its end
 * date) or `ended` (stopped by hand). Its `phase` is what an admin reads: draft, scheduled, live
 * or ended.
 */

export const PROMOTION_STATUSES = ['draft', 'published', 'ended'] as const
export type PromotionStatus = typeof PROMOTION_STATUSES[number]

export const PROMOTION_PHASES = ['draft', 'scheduled', 'live', 'ended'] as const
export type PromotionPhase = typeof PROMOTION_PHASES[number]

export const DISCOUNT_KINDS = ['percent', 'amount'] as const
export type DiscountKind = typeof DISCOUNT_KINDS[number]

export const PROMOTION_SCOPES = ['menu', 'selected'] as const
export type PromotionScope = typeof PROMOTION_SCOPES[number]

export const PROMOTION_NAME_MAX = 60
export const PROMOTION_DESCRIPTION_MAX = 200
/** Items and categories one promotion names. */
export const PROMOTION_TARGETS_MAX = 200
/** At most $1,000 off. */
export const PROMOTION_AMOUNT_MAX_MINOR = 100_000

export type Discount = { kind: 'percent', percent: number } | { kind: 'amount', amountMinor: number }

/** "20% off", "$1.50 off": the badge customers see. */
export function discountLabel(discount: Discount): string {
  if (discount.kind === 'percent') return `${discount.percent}% off`
  const dollars = discount.amountMinor / 100
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} off`
}

/**
 * What `discount` takes off `priceMinor`, in cents: a percent rounded to the nearest cent (half
 * up), an amount at most the price. A price never goes below zero.
 */
export function discountOff(discount: Discount, priceMinor: number): number {
  if (priceMinor <= 0) return 0
  if (discount.kind === 'percent') return Math.min(priceMinor, Math.round(priceMinor * discount.percent / 100))
  return Math.min(priceMinor, discount.amountMinor)
}

/** A promotion's discount and badge, as the menu, the checkout and an order line show it. */
export interface PromotionTag {
  id: string
  name: string
  /** "20% off". */
  label: string
}

export interface PromotionTargetRef {
  id: string
  name: string
  /** An archived item or category stays named, but sells nothing. */
  status: string
}

export interface Promotion {
  id: string
  name: string
  /** For customers, beside the poster on the menu; `''` without one. */
  description: string
  status: PromotionStatus
  /** Today, in the first branch's time zone. */
  phase: PromotionPhase
  discount: Discount
  label: string
  scope: PromotionScope
  /** `scope: 'selected'`: by name. */
  items: PromotionTargetRef[]
  categories: PromotionTargetRef[]
  /** `[]`: every branch. */
  branches: { id: string, name: string }[]
  /** `YYYY-MM-DD`, the first day it runs. */
  startsOn: string
  /** `YYYY-MM-DD`, the last day it runs; `null`: until it's ended. */
  endsOn: string | null
  poster: { id: string, url: string } | null
  /** Stopped by hand (`status: 'ended'`). */
  endedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

/** How a promotion did (`GET …/promotions/{id}/results`): orders paid and not cancelled. */
export interface PromotionResults {
  /** Orders with at least one line at this promotion's price. */
  orders: number
  /** Units sold at its price. */
  units: number
  /** Taken off those lines, in cents. */
  discountMinor: number
  /** What those lines sold for, after the discount. */
  salesMinor: number
}

/** On the customer menu: a live promotion with what it applies to now. */
export interface PublicPromotion {
  id: string
  name: string
  description: string
  label: string
  endsOn: string | null
  posterUrl: string | null
  /** The items on the menu now at its price (each at most once across promotions). */
  itemIds: string[]
}

const date = v.pipe(v.string(), v.isoDate('A date like 2026-10-15'))

const discountSchema = v.variant('kind', [
  v.strictObject({
    kind: v.literal('percent'),
    percent: v.pipe(v.number(), v.integer('A whole number'), v.minValue(1, 'At least 1%'), v.maxValue(100, 'At most 100%')),
  }),
  v.strictObject({
    kind: v.literal('amount'),
    amountMinor: v.pipe(v.number(), v.integer(), v.minValue(1, 'At least $0.01'), v.maxValue(PROMOTION_AMOUNT_MAX_MINOR, 'At most $1,000')),
  }),
])

const uniqueIds = (max: number, noun: string) => v.pipe(
  v.array(idSchema),
  v.maxLength(max, `At most ${max} ${noun}`),
  v.check(ids => new Set(ids).size === ids.length, `Each one can be chosen once`),
)

/** The whole promotion as the form saves it. */
const promotionFields = {
  name: nameSchema(PROMOTION_NAME_MAX),
  description: v.optional(textSchema(PROMOTION_DESCRIPTION_MAX), ''),
  discount: discountSchema,
  scope: v.picklist(PROMOTION_SCOPES),
  itemIds: v.optional(uniqueIds(PROMOTION_TARGETS_MAX, 'items'), []),
  categoryIds: v.optional(uniqueIds(PROMOTION_TARGETS_MAX, 'categories'), []),
  branchIds: v.optional(uniqueIds(50, 'branches'), []),
  startsOn: date,
  endsOn: v.optional(v.nullable(date), null),
  posterId: v.optional(v.nullable(idSchema), null),
}

const createObject = v.strictObject({ ...promotionFields, publish: v.optional(v.boolean(), false) })
const updateObject = v.strictObject({ ...promotionFields, version: versionSchema, publish: v.optional(v.boolean(), false) })

/** `publish`: published at once (refused if its end date has passed); otherwise a draft. */
export const createPromotionSchema = v.pipe(
  createObject,
  v.forward(v.partialCheck([['scope'], ['itemIds'], ['categoryIds']], input => input.scope === 'menu' || input.itemIds.length + input.categoryIds.length > 0, 'Choose at least one item or category'), ['itemIds']),
  v.forward(v.partialCheck([['itemIds'], ['categoryIds']], input => input.itemIds.length + input.categoryIds.length <= PROMOTION_TARGETS_MAX, `At most ${PROMOTION_TARGETS_MAX} items and categories`), ['itemIds']),
  v.forward(v.partialCheck([['startsOn'], ['endsOn']], input => input.endsOn === null || input.endsOn >= input.startsOn, 'The end can\'t be before the start'), ['endsOn']),
)
export type CreatePromotionInput = v.InferOutput<typeof createObject>

/** Replaces the whole promotion (an ended one can't change). `publish` publishes a draft too. */
export const updatePromotionSchema = v.pipe(
  updateObject,
  v.forward(v.partialCheck([['scope'], ['itemIds'], ['categoryIds']], input => input.scope === 'menu' || input.itemIds.length + input.categoryIds.length > 0, 'Choose at least one item or category'), ['itemIds']),
  v.forward(v.partialCheck([['itemIds'], ['categoryIds']], input => input.itemIds.length + input.categoryIds.length <= PROMOTION_TARGETS_MAX, `At most ${PROMOTION_TARGETS_MAX} items and categories`), ['itemIds']),
  v.forward(v.partialCheck([['startsOn'], ['endsOn']], input => input.endsOn === null || input.endsOn >= input.startsOn, 'The end can\'t be before the start'), ['endsOn']),
)
export type UpdatePromotionInput = v.InferOutput<typeof updateObject>

export const promotionVersionSchema = v.strictObject({ version: versionSchema })
export type PromotionVersionInput = v.InferOutput<typeof promotionVersionSchema>
