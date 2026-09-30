import type { CancelReason, OrderStatus, OrderType, PaymentMethod, ReturnMethod } from '#shared/contracts/orders'
import { BUSINESS_DAY_START_MINUTE } from '#shared/contracts/orders'
import type { OrderHistoryEvent, OrderHistoryRow, PaymentState } from '#shared/contracts/reports'
import { formatClock } from '~/utils/clock'
import { formatMinor } from '~/utils/money'

/**
 * Words and colors for the report pages (step 8.1b, D111). The same labels as the counter app
 * ("Cash riel") and the CSV files (`server/features/orders/reports.csv.ts`).
 */

/** "business day 4:00 AM – 4:00 AM": what a date means in every report (D110). */
export const BUSINESS_DAY_TEXT = `business day ${formatClock(BUSINESS_DAY_START_MINUTE)} – ${formatClock(BUSINESS_DAY_START_MINUTE)}`

type BadgeColor = 'success' | 'warning' | 'neutral' | 'info' | 'primary' | 'error'

export const METHOD_LABELS: Record<PaymentMethod, string> = { cash_usd: 'Cash USD', cash_khr: 'Cash riel', khqr: 'KHQR' }

export const PAYMENT_LABELS: Record<PaymentState, string> = { unpaid: 'Unpaid', paid: 'Paid', refunded: 'Refunded', not_paid: 'Not paid' }
const PAYMENT_COLORS: Record<PaymentState, BadgeColor> = { unpaid: 'warning', paid: 'success', refunded: 'neutral', not_paid: 'neutral' }

export const PROGRESS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: 'Waiting for payment',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
const PROGRESS_COLORS: Record<OrderStatus, BadgeColor> = {
  awaiting_payment: 'warning',
  preparing: 'info',
  ready: 'primary',
  completed: 'success',
  cancelled: 'neutral',
}

export const TYPE_LABELS: Record<OrderType, string> = { pickup: 'Pickup', dine_in: 'Dine-in' }

const REASON_LABELS: Record<CancelReason, string> = {
  customer_changed_mind: 'The customer changed their mind',
  item_unavailable: 'An item isn\'t available',
  other: 'Other',
}
const RETURN_LABELS: Record<ReturnMethod, string> = { cash: 'Cash', khqr: 'KHQR' }

/** "Paid · KHQR", "Unpaid": the Payment column's badge. */
export function paymentBadge(payment: OrderHistoryRow['payment']): { label: string, color: BadgeColor } {
  const label = payment.state === 'paid' && payment.method ? `Paid · ${METHOD_LABELS[payment.method]}` : PAYMENT_LABELS[payment.state]
  return { label, color: PAYMENT_COLORS[payment.state] }
}

export const progressBadge = (status: OrderStatus): { label: string, color: BadgeColor } => ({ label: PROGRESS_LABELS[status], color: PROGRESS_COLORS[status] })

/** `42` → "#042": pickup numbers restart every business day. */
export const orderNumber = (pickupNumber: number) => `#${String(pickupNumber).padStart(3, '0')}`

/** "Pickup", "Dine-in · T4". */
export const orderTypeText = (order: Pick<OrderHistoryRow, 'orderType' | 'tableLabel'>) =>
  order.orderType === 'dine_in' && order.tableLabel ? `Dine-in · ${order.tableLabel}` : TYPE_LABELS[order.orderType]

export const formatRiel = (amount: number) => `៛${amount.toLocaleString('en-US')}`

/** "9:02 AM" in the branch's zone. */
export const clockIn = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })

/** "Tue, Sep 30, 9:02 AM" in the branch's zone. */
export const stampIn = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })

/** A step of the timeline, in words: "Paid", "Cancelled". */
export function eventTitle(event: Pick<OrderHistoryEvent, 'fromStatus' | 'toStatus'>): string {
  if (event.fromStatus === null) return 'Placed'
  switch (event.toStatus) {
    case 'preparing': return 'Paid'
    case 'ready': return 'Ready'
    case 'completed': return 'Completed'
    case 'cancelled': return 'Cancelled'
    default: return PROGRESS_LABELS[event.toStatus]
  }
}

/** Who took the step, only as recorded (D110): a staff member's name, the customer, or the system. */
export function eventBy(event: Pick<OrderHistoryEvent, 'by' | 'toStatus'>): string {
  switch (event.by.kind) {
    case 'customer': return 'By the customer'
    case 'system': return event.toStatus === 'cancelled' ? 'Automatically (not paid in 30 minutes)' : 'Automatically'
    case 'staff': return event.by.name ? `By ${event.by.name}` : 'By a staff member'
  }
}

export function eventReason(event: Pick<OrderHistoryEvent, 'reason' | 'note'>): string | null {
  if (!event.reason) return event.note
  const reason = REASON_LABELS[event.reason]
  return event.note ? `${reason}: ${event.note}` : reason
}

export const returnLabel = (method: ReturnMethod) => RETURN_LABELS[method]

/** "+12%", "−8%", or nothing when there's nothing to compare with. */
export function changeText(current: number, previous: number): { text: string, up: boolean } | null {
  if (previous <= 0) return null
  const percent = Math.round(((current - previous) / previous) * 100)
  return { text: `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(percent)}%`, up: percent >= 0 }
}

/** "−$14.00": a refund shown as money going out; "—" for none. */
export const negativeMinor = (minor: number) => (minor === 0 ? '—' : `−${formatMinor(minor)}`)

/** Hours for the chart: `'07'` → "7 AM", `'13'` → "1 PM". */
export function hourLabel(key: string): string {
  const hour = Number(key)
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

/** Days for the chart: `'2026-09-30'` → "Tue 30". */
export function dayLabel(key: string): string {
  const at = new Date(`${key}T00:00:00Z`)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getUTCDay()]} ${at.getUTCDate()}`
}
