import * as v from 'valibot'
import type { PublicBranch } from './branches'
import type { Page } from './common'
import { idSchema, pageQuerySchema } from './common'

/**
 * Orders (phase 6). Step 6.3 (D101): the counter (below). Step 6.2 (D99): placing an order,
 * `POST /api/shop/orders`, and reading it back.
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
  /** The version sold (step 6.5b: Order again adds the same one). */
  variationId: string
  itemName: string
  detail: string
  modifiers: QuotedModifier[]
  unitPriceMinor: number
  quantity: number
  totalMinor: number
  note: string | null
}

/** Who cancelled an order, as its customer is told (step 6.5, D106). */
export const CANCELLED_BY = ['customer', 'cafe', 'system'] as const
export type CancelledBy = typeof CANCELLED_BY[number]

/** The payment as the customer sees it (no cashier, no reference). */
export interface OrderPayment {
  method: PaymentMethod
  amountMinor: number
  /** Cash in riel: the riel paid. */
  amountKhr: number | null
  collectedAt: string
  /** Cancelled after paying (before it was ready): how the money went back. */
  returnMethod: ReturnMethod | null
  returnedAt: string | null
}

/**
 * Why an order was cancelled: by its customer (while unpaid), by the cafe (with its reason; the
 * staff's own words stay at the counter), or by the system (not paid within 30 minutes, D104).
 */
export interface OrderCancellation {
  by: CancelledBy
  /** The cafe's reason; `null` for the customer and the system. */
  reason: CancelReason | null
}

/**
 * An order as its customer sees it (`GET /api/shop/orders/{id}`, and the answer to placing it).
 * Tracking (step 6.5, D106) reads the times each step happened, the payment and the cancellation.
 */
export interface Order {
  id: string
  /** Send it back to cancel (`POST /api/shop/orders/{id}/cancel`). */
  version: number
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
  paidAt: string | null
  readyAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  payment: OrderPayment | null
  cancellation: OrderCancellation | null
}

/** One order in the customer's list: enough for a row, without the lines. */
export interface OrderSummary {
  id: string
  branch: { id: string, name: string }
  pickupNumber: number
  businessDate: string
  status: OrderStatus
  orderType: OrderType
  table: { label: string } | null
  /** Units across the lines ("3 items"). */
  itemCount: number
  totalMinor: number
  placedAt: string
  paymentDueAt: string
}

/** Statuses still in play for the customer: shown under "In progress". */
export const IN_PROGRESS_STATUSES = ['awaiting_payment', 'preparing', 'ready'] as const satisfies readonly OrderStatus[]

/** `GET /api/shop/orders?page=&pageSize=`: the signed-in customer's orders. */
export const customerOrdersQuerySchema = v.object(pageQuerySchema)
export type CustomerOrdersQuery = v.InferOutput<typeof customerOrdersQuerySchema>

/**
 * The customer's orders (step 6.5, D106): every one still in play, newest first, and the finished
 * ones (completed or cancelled) a page at a time, newest first.
 */
export interface CustomerOrders {
  inProgress: OrderSummary[]
  past: Page<OrderSummary>
}

// --- The counter (step 6.3, D101) ---
// `/api/counter/{branchId}/orders`: the branch's queue, and the commands that move an order along.
// Recording the payment starts preparation (D45: no accept step). Each command names the order's
// `version` (a stale one is refused with the order's current state) and sends an `Idempotency-Key`
// (a retry returns the first answer).

/** How the customer paid at the counter (D45). */
export const PAYMENT_METHODS = ['cash_usd', 'cash_khr', 'khqr'] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]
/** How the money went back when a paid order is cancelled before it's ready (owner, 2026-09-29, Q36). */
export const RETURN_METHODS = ['cash', 'khqr'] as const
export type ReturnMethod = typeof RETURN_METHODS[number]
export const CANCEL_REASONS = ['customer_changed_mind', 'item_unavailable', 'other'] as const
export type CancelReason = typeof CANCEL_REASONS[number]
/** The words after "Other" when cancelling, and a KHQR payment's reference. */
export const CANCEL_NOTE_MAX = 200
export const PAYMENT_REFERENCE_MAX = 64
/** A plausible riel rate (per US dollar), so a typo like 41 or 41000 is refused. */
export const KHR_PER_USD_MIN = 1000
export const KHR_PER_USD_MAX = 10_000

/**
 * The riel for a USD amount at a rate, **rounded up to 100 riel** (the smallest note in use; owner,
 * 2026-09-29). $8.75 at 4,100 = ៛35,875 → ៛35,900. Integer arithmetic only.
 */
export function toRiel(amountMinor: number, khrPerUsd: number): number {
  return Math.floor((amountMinor * khrPerUsd + 9_999) / 10_000) * 100
}

const versionSchema = v.pipe(v.number(), v.integer(), v.minValue(1))

/** `ready` and `complete`: the version the screen shows. */
export const counterCommandSchema = v.strictObject({ version: versionSchema })
export type CounterCommandInput = v.InferOutput<typeof counterCommandSchema>

/**
 * `POST /api/shop/orders/{id}/cancel` (header `Idempotency-Key`): the customer cancels their own
 * order while it's unpaid (D45), naming the version they saw (step 6.5, D106).
 */
export const cancelMyOrderSchema = v.strictObject({ version: versionSchema })
export type CancelMyOrderInput = v.InferOutput<typeof cancelMyOrderSchema>

/**
 * `pay`: the method, and for riel the rate the screen used (a rate changed since is refused, so
 * the riel asked for is the riel recorded). The amount is always the order's total.
 */
export const payOrderSchema = v.variant('method', [
  v.strictObject({ version: versionSchema, method: v.literal('cash_usd') }),
  v.strictObject({ version: versionSchema, method: v.literal('cash_khr'), khrPerUsd: v.pipe(v.number(), v.integer(), v.minValue(KHR_PER_USD_MIN), v.maxValue(KHR_PER_USD_MAX)) }),
  v.strictObject({
    version: versionSchema,
    method: v.literal('khqr'),
    /** The QR the counter showed (step 10.15, D130); none when the counter's printed KHQR was used. */
    chargeId: v.optional(v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(64)))),
    reference: v.optional(v.pipe(
      v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(PAYMENT_REFERENCE_MAX, `At most ${PAYMENT_REFERENCE_MAX} characters`))),
      v.transform(reference => reference || null),
    ), null),
  }),
])
export type PayOrderInput = v.InferOutput<typeof payOrderSchema>

/**
 * `cancel`: why (words required with "Other"), and for a paid order how the money went back
 * (required then, refused for an unpaid one).
 */
export const cancelOrderSchema = v.pipe(
  v.strictObject({
    version: versionSchema,
    reason: v.picklist(CANCEL_REASONS),
    note: v.optional(v.pipe(
      v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(CANCEL_NOTE_MAX, `At most ${CANCEL_NOTE_MAX} characters`))),
      v.transform(note => note || null),
    ), null),
    returnMethod: v.optional(v.nullable(v.picklist(RETURN_METHODS)), null),
  }),
  v.forward(v.check(input => input.reason !== 'other' || Boolean(input.note), 'Say why the order is cancelled'), ['note']),
)
export type CancelOrderInput = v.InferOutput<typeof cancelOrderSchema>

/** The payment recorded for an order. */
export interface CounterPayment {
  method: PaymentMethod
  /** Always the order's total, in US cents. */
  amountMinor: number
  /** Cash in riel: the riel asked for and the rate used. */
  amountKhr: number | null
  khrPerUsd: number | null
  reference: string | null
  /** The QR the counter showed for this payment (step 10.15, D130). */
  khqrChargeId: string | null
  collectedAt: string
  collectedBy: { name: string }
  /** A paid order cancelled before it was ready: how the money went back. */
  returnMethod: ReturnMethod | null
  returnedAt: string | null
}

/** An order as the counter sees it. */
export interface CounterOrder {
  id: string
  version: number
  pickupNumber: number
  businessDate: string
  status: OrderStatus
  orderType: OrderType
  table: { label: string } | null
  customer: { name: string }
  lines: OrderLine[]
  totalMinor: number
  placedAt: string
  paymentDueAt: string
  paidAt: string | null
  readyAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  payment: CounterPayment | null
}

/** The riel rate an admin set (append-only history). */
export interface ExchangeRate {
  khrPerUsd: number
  effectiveFrom: string
  setBy: { name: string }
}

/**
 * `GET /api/counter/{branchId}/orders`: the orders still in play (waiting for payment and not past
 * their time, preparing, ready), oldest first; the riel rate for payments; and the server's clock,
 * so countdowns don't depend on the tablet's.
 */
export interface CounterQueue {
  orders: CounterOrder[]
  khrRate: ExchangeRate | null
  /** KHQR at the counter (step 10.15): the currencies offered, or `null` while it isn't set up. */
  khqr: { currencies: KhqrCurrency[] } | null
  serverTime: string
  /** Orders of today's business day already completed or cancelled ("Finished today (24)", step 10.2). */
  finishedToday: number
}

/**
 * `GET /api/counter/{branchId}/orders/finished` (step 10.2, D117): today's business day's orders
 * that left the queue (completed or cancelled), the most recently finished first. Read only.
 */
export interface CounterFinishedOrders {
  /** `YYYY-MM-DD`: the business day shown (it starts at 4:00 in the branch's time zone). */
  businessDate: string
  orders: CounterOrder[]
}

/** Who took a step: nobody (the system, e.g. the 30-minute expiry), the customer, or a staff member. */
export interface CounterStepActor {
  kind: 'system' | 'customer' | 'staff'
  /** The staff member's name, or the customer's first name; `null` for the system. */
  name: string | null
}

/** One recorded step of an order: placed, paid, ready, completed or cancelled. */
export interface CounterTimelineStep {
  at: string
  toStatus: OrderStatus
  by: CounterStepActor
  /** A cancel's reason, and the staff's own note (the counter sees it; customers never do, D106). */
  reason: CancelReason | null
  note: string | null
}

/** `GET /api/counter/{branchId}/orders/{id}/history`: the order with every step and who took it. */
export interface CounterOrderHistory {
  order: CounterOrder
  timeline: CounterTimelineStep[]
  /** Who handed the money back, for a paid order cancelled before it was ready. */
  returnedBy: string | null
}

/** `POST /api/admin/exchange-rates`: a new riel rate, from now on. */
export const setExchangeRateSchema = v.strictObject({
  khrPerUsd: v.pipe(v.number(), v.integer(), v.minValue(KHR_PER_USD_MIN, `At least ${KHR_PER_USD_MIN}`), v.maxValue(KHR_PER_USD_MAX, `At most ${KHR_PER_USD_MAX}`)),
})
export type SetExchangeRateInput = v.InferOutput<typeof setExchangeRateSchema>

/** `GET /api/admin/exchange-rates`: the current rate and the latest changes, newest first. */
export interface ExchangeRates {
  current: ExchangeRate | null
  history: ExchangeRate[]
}

// --- KHQR at the counter (step 10.15, D130) ---
// A dynamic KHQR (the National Bank of Cambodia's payment QR) made for one order: the customer scans
// it with any Cambodian banking app, the amount already in it. An admin sets the receiving Bakong
// account; the money goes straight there.

export const KHQR_CURRENCIES = ['USD', 'KHR'] as const
export type KhqrCurrency = typeof KHQR_CURRENCIES[number]
/** The KHQR's limits (NBC's SDK). Its text is ASCII: the name customers see is in Latin letters. */
export const KHQR_ACCOUNT_MAX = 32
export const KHQR_NAME_MAX = 25
export const KHQR_CITY_MAX = 15
/** How long a QR at the counter works: 15 minutes, or until the order's time to pay is over. */
export const KHQR_LIFETIME_MINUTES = 15

const ASCII_TEXT = /^[\x20-\x7E]+$/
const asciiText = (max: number, what: string) => v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(`Enter the ${what}`),
  v.maxLength(max, `At most ${max} characters`),
  v.regex(ASCII_TEXT, 'Latin letters, digits and simple punctuation only'),
)

/** `PUT /api/admin/khqr`: the receiving account and what customers see, with the version read. */
export const khqrSettingsSchema = v.strictObject({
  version: v.pipe(v.number(), v.integer(), v.minValue(0)),
  enabled: v.boolean(),
  accountId: v.pipe(
    v.string(),
    v.trim(),
    v.toLowerCase(),
    v.nonEmpty('Enter the Bakong account ID'),
    v.maxLength(KHQR_ACCOUNT_MAX, `At most ${KHQR_ACCOUNT_MAX} characters`),
    v.regex(/^[\w.-]+@[a-z\d]+$/, 'A Bakong account ID looks like name@bank'),
  ),
  merchantName: asciiText(KHQR_NAME_MAX, 'name customers see'),
  merchantCity: asciiText(KHQR_CITY_MAX, 'city'),
  currencies: v.pipe(
    v.array(v.picklist(KHQR_CURRENCIES)),
    v.minLength(1, 'Choose at least one currency'),
    v.transform(list => KHQR_CURRENCIES.filter(currency => list.includes(currency))),
  ),
})
export type KhqrSettingsInput = v.InferOutput<typeof khqrSettingsSchema>

/** `GET /api/admin/khqr`: version 0 until it's first saved. */
export interface KhqrSettings {
  version: number
  enabled: boolean
  accountId: string | null
  merchantName: string | null
  merchantCity: string | null
  currencies: KhqrCurrency[]
  updatedAt: string | null
  updatedBy: { name: string } | null
}

/** `POST /api/counter/{branchId}/orders/{id}/khqr`: the QR for this order in a currency. */
export const createKhqrSchema = v.strictObject({ currency: v.picklist(KHQR_CURRENCIES) })
export type CreateKhqrInput = v.InferOutput<typeof createKhqrSchema>

/** One QR made for an order (the open one is answered again while it works). */
export interface KhqrCharge {
  id: string
  currency: KhqrCurrency
  /** Cents for USD, riel for KHR. */
  amount: number
  /** For riel: the rate it was made at (rounded up to ៛100, as cash riel). */
  khrPerUsd: number | null
  /** The QR's text, drawn as the QR code. */
  qr: string
  /** "Order 042": the bill number in the customer's and the cafe's bank history. */
  billNumber: string
  merchantName: string
  createdAt: string
  expiresAt: string
}
