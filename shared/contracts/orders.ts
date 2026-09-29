import * as v from 'valibot'
import type { PublicBranch } from './branches'
import { idSchema } from './common'

/**
 * Orders (phase 6). Step 6.2 (D99): placing an order, `POST /api/shop/orders`, and reading it back.
 * Step 6.1 (D98): the checkout quote, `POST /api/public/checkout/quote`. The
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
/** Online orders stop this long before the branch closes (owner, 2026-09-29, Q40). */
export const LAST_ORDERS_MINUTES = 15
/** An unpaid order is cancelled after this (D45; the expiry task is step 6.6). */
export const PAYMENT_WINDOW_MINUTES = 30
/** Unpaid orders one customer may have at once (owner, 2026-09-29). */
export const MAX_UNPAID_ORDERS = 2
/** The business day starts at 4:00 local time: pickup numbers restart then (owner, 2026-09-29, Q39). */
export const BUSINESS_DAY_START_MINUTE = 4 * 60

/**
 * An order's life (D45): placed and waiting for payment, then (at the counter, step 6.3) preparing,
 * ready and completed, or cancelled. Step 6.2 creates `awaiting_payment` only; the database allows
 * the whole list now, so the counter needs no table rebuild.
 */
export const ORDER_STATUSES = ['awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]
export const ORDER_TYPES = ['pickup', 'dine_in'] as const
export type OrderType = typeof ORDER_TYPES[number]

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
export interface QuotedModifier {
  id: string
  name: string
  priceDeltaMinor: number
}

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
  /** The chosen add-ons still offered, in menu order, with their prices on this item. */
  modifiers: QuotedModifier[]
  imageUrl: string | null
  /** The version's price plus the add-ons', in cents; `null` when the line has a problem. */
  unitPriceMinor: number | null
  totalMinor: number | null
  problem: QuoteLineProblem | null
}

/**
 * Why the order as a whole can't be placed now (its lines' problems are on the lines):
 * `BRANCH_CLOSED`, or `LAST_ORDERS_PASSED` (open, but closing within `LAST_ORDERS_MINUTES`).
 */
export type QuoteProblemCode = 'BRANCH_CLOSED' | 'LAST_ORDERS_PASSED'

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

/**
 * `POST /api/shop/orders` (header `Idempotency-Key`): places the order for the signed-in, verified
 * customer. The lines are priced again; `expectedTotalMinor` is the total the page showed, and a
 * different one is refused (`PRICES_CHANGED`), so a price is never charged unseen. `tableToken`: the
 * table's QR token for dine-in; without it, pickup.
 */
export const placeOrderSchema = v.strictObject({
  branchId: idSchema,
  tableToken: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(100))), null),
  lines: checkoutQuoteSchema.entries.lines,
  expectedTotalMinor: v.pipe(v.number(), v.integer(), v.minValue(0)),
})
export type PlaceOrderInput = v.InferOutput<typeof placeOrderSchema>

export interface OrderLine {
  itemId: string
  itemName: string
  detail: string
  modifiers: QuotedModifier[]
  unitPriceMinor: number
  quantity: number
  totalMinor: number
  note: string | null
}

/** An order as its customer sees it (`GET /api/shop/orders/{id}`, and the answer to placing it). */
export interface Order {
  id: string
  branch: { id: string, name: string }
  /** 1, 2, 3 … per branch and business day; shown as "042". */
  pickupNumber: number
  /** `YYYY-MM-DD`, the branch's business day. */
  businessDate: string
  status: OrderStatus
  orderType: OrderType
  table: { label: string } | null
  lines: OrderLine[]
  subtotalMinor: number
  totalMinor: number
  currency: 'USD'
  placedAt: string
  /** Pay at the counter before this, or the order is cancelled. */
  paymentDueAt: string
  cancelledAt: string | null
}
