import * as v from 'valibot'
import type { PublicBranch } from './branches'
import { idSchema } from './common'

/**
 * Orders (phase 6). Step 6.1 (D98): the checkout quote, `POST /api/public/checkout/quote`. The
 * server prices the lines from the menu as it is now, at the branch, and says what's wrong with
 * each line instead of refusing the request. Menu prices are final: no tax, no service charge
 * (D45). A quote is never a promise: placing the order (step 6.2) prices it again.
 */

/** Lines in one order (owner, 2026-09-29). */
export const ORDER_MAX_LINES = 30
/** Units of one line (owner, 2026-09-29). */
export const LINE_MAX_QUANTITY = 20
/** A line's note, e.g. "Less ice" (owner, 2026-09-29). */
export const LINE_NOTE_MAX = 140
/** How long a quote's prices are shown before the page asks again (owner, 2026-09-29). */
export const QUOTE_TTL_MINUTES = 10

const noteSchema = v.pipe(
  v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(LINE_NOTE_MAX, `At most ${LINE_NOTE_MAX} characters`))),
  v.transform(note => (note ? note : null)),
)

export const orderLineInputSchema = v.strictObject({
  itemId: idSchema,
  variationId: idSchema,
  /** The chosen add-ons, each once. */
  modifierIds: v.optional(v.pipe(
    v.array(idSchema),
    v.maxLength(30, 'Too many add-ons'),
    v.check(ids => new Set(ids).size === ids.length, 'Each add-on can be chosen once'),
  ), []),
  quantity: v.pipe(v.number(), v.integer('Must be a whole number'), v.minValue(1, 'At least 1'), v.maxValue(LINE_MAX_QUANTITY, `At most ${LINE_MAX_QUANTITY}`)),
  note: v.optional(noteSchema, null),
})
export type OrderLineInput = v.InferOutput<typeof orderLineInputSchema>

export const checkoutQuoteSchema = v.strictObject({
  branchId: idSchema,
  lines: v.pipe(
    v.array(orderLineInputSchema),
    v.minLength(1, 'Your order is empty'),
    v.maxLength(ORDER_MAX_LINES, `An order can have up to ${ORDER_MAX_LINES} lines`),
  ),
})
export type CheckoutQuoteInput = v.InferOutput<typeof checkoutQuoteSchema>

/**
 * Why a line can't be ordered now, in the order they're checked:
 * - `ITEM_UNAVAILABLE`: not on the menu at this moment (archived, unpublished, outside its hours).
 * - `VERSION_UNAVAILABLE`: the chosen version (size, temperature) isn't sold anymore.
 * - `ADD_ON_UNAVAILABLE`: a chosen add-on isn't offered on this item anymore (`modifierIds` names them).
 * - `CHOICE_INVALID`: an add-on group's rule isn't met (too few or too many).
 * - `SOLD_OUT`: the version is switched off at this branch.
 */
export type QuoteLineProblemCode = 'ITEM_UNAVAILABLE' | 'VERSION_UNAVAILABLE' | 'ADD_ON_UNAVAILABLE' | 'CHOICE_INVALID' | 'SOLD_OUT'

export interface QuoteLineProblem {
  code: QuoteLineProblemCode
  /** Safe to show: "Oat milk is no longer available." */
  message: string
  /** `ADD_ON_UNAVAILABLE`: the add-ons that are gone. */
  modifierIds?: string[]
}

export interface QuoteLine {
  itemId: string
  variationId: string
  modifierIds: string[]
  quantity: number
  note: string | null
  /** The item's name now; `null` when it isn't on the menu (the page shows the name it kept). */
  name: string | null
  /** "Large, Iced · Oat milk, Extra shot"; `''` with nothing chosen or when unknown. */
  detail: string
  imageUrl: string | null
  /** The version's price plus the add-ons', in cents; `null` when the line has a problem. */
  unitPriceMinor: number | null
  totalMinor: number | null
  problem: QuoteLineProblem | null
}

/** Why the order as a whole can't be placed now (its lines' problems are on the lines). */
export type QuoteProblemCode = 'BRANCH_CLOSED'

export interface CheckoutQuote {
  /** The branch, whether it's open, and when it opens next. */
  branch: PublicBranch
  currency: 'USD'
  /** When these prices were read (ISO 8601 UTC). */
  at: string
  /** After this, ask again before placing (`QUOTE_TTL_MINUTES`). */
  expiresAt: string
  /** In the request's order. */
  lines: QuoteLine[]
  /** Of the lines without a problem, in cents. */
  subtotalMinor: number
  /** Equal to the subtotal: no tax, service charge or vouchers yet (vouchers: step 7.5). */
  totalMinor: number
  problems: { code: QuoteProblemCode, message: string }[]
  /** No problem on the order or any line: it can be placed as quoted. */
  orderable: boolean
}
