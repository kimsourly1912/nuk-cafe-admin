import * as v from 'valibot'
import { optionalParam, pageQuerySchema } from './common'
import type { CancelledBy, OrderStatus, OrderType, PaymentMethod, ReturnMethod, CANCEL_REASONS } from './orders'
import { ORDER_STATUSES, ORDER_TYPES, PAYMENT_METHODS } from './orders'

/**
 * Reports (step 8.1, docs/plans/reports.md, D110): sales, items and order history for one branch
 * over a range of business dates (04:00 to 04:00 in the branch's time zone). Every definition is in
 * the plan; money is in cents (and whole riel).
 */

/** The longest period a report covers, in business days (owner, 2026-09-30, R5). */
export const REPORT_MAX_DAYS = 93
/** How many best sellers the Summary lists. */
export const REPORT_BEST_SELLERS = 5

const businessDate = v.pipe(v.string(), v.isoDate('A date like 2026-09-30'))

/** The branch and the business dates, `from` to `to` inclusive. */
const periodEntries = {
  branchId: v.pipe(v.string(), v.minLength(1, 'Choose a branch')),
  from: businessDate,
  to: businessDate,
}

/** A period ends on or after it starts and covers at most `REPORT_MAX_DAYS` days. */
const validPeriod = <T extends { from: string, to: string }>() => [
  v.check<T, string>(input => input.from <= input.to, 'The period must end on or after its start'),
  v.check<T, string>(input => daysBetween(input.from, input.to) < REPORT_MAX_DAYS, `A report covers at most ${REPORT_MAX_DAYS} days`),
] as const

/** Whole days from one business date to another (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

const direction = v.optional(v.picklist(['asc', 'desc']), 'desc')
const optionalText = (max: number) => v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max)), '')

// --- Summary ---

const reportPeriodEntries = v.object(periodEntries)
export const reportPeriodQuerySchema = v.pipe(reportPeriodEntries, ...validPeriod<v.InferOutput<typeof reportPeriodEntries>>())
export type ReportPeriodQuery = v.InferOutput<typeof reportPeriodQuerySchema>

export interface ReportContext {
  branch: { id: string, name: string, timeZone: string }
  /** The business dates asked for, and the instants they cover: `[start, end)`. */
  period: { from: string, to: string, start: string, end: string }
  /** When the numbers were read: a report is a snapshot as of this time. */
  asOf: string
}

export interface PaymentMethodTotal {
  method: PaymentMethod
  orders: number
  amountMinor: number
  /** Cash riel only: the riel taken, each payment at the rate it recorded. */
  amountKhr: number | null
}

export interface TrendPoint {
  /** `07` for an hour of the day, `2026-09-30` for a business date. */
  key: string
  salesMinor: number
  orders: number
}

export interface ItemSalesRow {
  itemId: string
  /** The name and category of the item's latest sale in the period. */
  name: string
  categoryId: string | null
  categoryName: string | null
  quantity: number
  salesMinor: number
  refundedMinor: number
}

export interface ReportSummary extends ReportContext {
  paid: { salesMinor: number, orders: number, averageMinor: number | null }
  refunds: { amountMinor: number, orders: number }
  netSalesMinor: number
  /** Paid sales of the period before, as long as this one (for "vs yesterday"). */
  previousPaidSalesMinor: number
  trend: { unit: 'hour' | 'day', points: TrendPoint[] }
  payments: PaymentMethodTotal[]
  bestSellers: ItemSalesRow[]
  /** Orders placed in the period and cancelled without a payment, by who cancelled. */
  cancelledUnpaid: Record<CancelledBy, number>
  ordersPlaced: number
  /** Live counts, only when the period includes today's business date. */
  current: { awaitingPayment: number, preparing: number, ready: number } | null
}

// --- Sales by item ---

export const ITEM_SALES_SORTS = ['quantity', 'sales', 'name', 'refunded'] as const
export type ItemSalesSort = typeof ITEM_SALES_SORTS[number]

const itemSalesEntries = v.object({
  ...periodEntries,
  search: optionalText(100),
  categoryId: optionalParam(v.pipe(v.string(), v.maxLength(64))),
  sort: v.optional(v.picklist(ITEM_SALES_SORTS), 'quantity'),
  direction,
  ...pageQuerySchema,
})
export const itemSalesQuerySchema = v.pipe(itemSalesEntries, ...validPeriod<v.InferOutput<typeof itemSalesEntries>>())
export type ItemSalesQuery = v.InferOutput<typeof itemSalesQuerySchema>

export interface ItemSalesReport extends ReportContext {
  items: ItemSalesRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  /** Across every row matching the filters, not just this page. */
  totals: { items: number, quantity: number, salesMinor: number, refundedMinor: number }
  /** The categories the period's sales fall in, for the filter. */
  categories: { id: string, name: string }[]
}

// --- Order history ---

/** The payment side of an order, derived from its payment row and status (D110). */
export const PAYMENT_STATES = ['unpaid', 'paid', 'refunded', 'not_paid'] as const
export type PaymentState = typeof PAYMENT_STATES[number]

export const ORDER_HISTORY_SORTS = ['placed', 'total', 'number'] as const

const orderHistoryEntries = v.object({
  ...periodEntries,
  /** The pickup number, digits only (it restarts every business day). */
  search: v.optional(v.pipe(v.string(), v.trim(), v.regex(/^\d{0,4}$/, 'An order number, like 042')), ''),
  type: optionalParam(v.picklist(ORDER_TYPES)),
  payment: optionalParam(v.picklist(PAYMENT_STATES)),
  progress: optionalParam(v.picklist(ORDER_STATUSES)),
  method: optionalParam(v.picklist(PAYMENT_METHODS)),
  sort: v.optional(v.picklist(ORDER_HISTORY_SORTS), 'placed'),
  direction,
  ...pageQuerySchema,
})
export const orderHistoryQuerySchema = v.pipe(orderHistoryEntries, ...validPeriod<v.InferOutput<typeof orderHistoryEntries>>())
export type OrderHistoryQuery = v.InferOutput<typeof orderHistoryQuerySchema>

export interface OrderHistoryRow {
  id: string
  pickupNumber: number
  businessDate: string
  placedAt: string
  orderType: OrderType
  tableLabel: string | null
  payment: { state: PaymentState, method: PaymentMethod | null }
  status: OrderStatus
  totalMinor: number
}

export interface OrderHistory extends ReportContext {
  orders: OrderHistoryRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface OrderHistoryEvent {
  at: string
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  /** Who did it: the customer, a staff member (by name), or the system (expiry). */
  by: { kind: 'customer' | 'staff' | 'system', name: string | null }
  reason: (typeof CANCEL_REASONS)[number] | null
  note: string | null
}

export interface OrderHistoryDetail {
  id: string
  branch: { id: string, name: string, timeZone: string }
  pickupNumber: number
  businessDate: string
  placedAt: string
  orderType: OrderType
  tableLabel: string | null
  /** The customer's first name only. */
  customerFirstName: string
  status: OrderStatus
  totalMinor: number
  lines: {
    itemName: string
    categoryName: string | null
    detail: string
    modifiers: { name: string, priceDeltaMinor: number }[]
    unitPriceMinor: number
    quantity: number
    totalMinor: number
    note: string | null
  }[]
  payment: {
    state: PaymentState
    method: PaymentMethod | null
    amountMinor: number | null
    amountKhr: number | null
    khrPerUsd: number | null
    reference: string | null
    collectedAt: string | null
    collectedBy: string | null
    returnMethod: ReturnMethod | null
    returnedAt: string | null
    returnedBy: string | null
  }
  timeline: OrderHistoryEvent[]
}
