import type { CancelReason, Order, OrderStatus, OrderSummary, PaymentMethod } from '#shared/contracts/orders'
import { IN_PROGRESS_STATUSES } from '#shared/contracts/orders'
import { formatMinor } from '~/utils/money'
import { pluralize } from '~/utils/text'

/** The customer's orders (step 6.2b, D100; tracking, step 6.5b, D114). */

/** "042": pickup numbers are shown with three digits (owner, 2026-09-29). */
export const formatPickupNumber = (n: number) => String(n).padStart(3, '0')

type BadgeColor = 'warning' | 'info' | 'success' | 'neutral'

/**
 * The badge for a status: its words and its color role (the 6.5 review): a cancelled order is
 * neutral, not red: it's a final state, not the customer's error.
 */
export function statusBadge(status: OrderStatus): { label: string, color: BadgeColor, icon: string } {
  switch (status) {
    case 'awaiting_payment': return { label: 'Waiting for payment', color: 'warning', icon: 'i-lucide-clock' }
    case 'preparing': return { label: 'Preparing', color: 'info', icon: 'i-lucide-coffee' }
    case 'ready': return { label: 'Ready', color: 'success', icon: 'i-lucide-bell-ring' }
    case 'completed': return { label: 'Completed', color: 'success', icon: 'i-lucide-circle-check' }
    case 'cancelled': return { label: 'Cancelled', color: 'neutral', icon: 'i-lucide-circle-x' }
  }
}

/** Still moving: waiting for payment, preparing or ready. The page keeps refreshing these. */
export const isInProgress = (status: OrderStatus) => (IN_PROGRESS_STATUSES as readonly OrderStatus[]).includes(status)

/** "Table T01" for a label "T01"; a label that already says "Table 4" stays as it is. */
export const tableName = (label: string) => (/^table\b/i.test(label) ? label : `Table ${label}`)

/** "Pickup" or "Table T01". */
export const orderTypeText = (order: Pick<Order, 'orderType' | 'table'>) =>
  (order.orderType === 'dine_in' && order.table ? tableName(order.table.label) : 'Pickup')

/**
 * What to do next, as the order page says it. Dine-in orders are collected at the counter too: no
 * table-service step exists (D106).
 */
export function nextStep(order: Pick<Order, 'status'>): string {
  switch (order.status) {
    case 'awaiting_payment': return 'Pay at the counter to start your order. Show this number to the cashier.'
    case 'preparing': return 'We\'re making your order. We\'ll show it here when it\'s ready.'
    case 'ready': return 'Show this number at the counter.'
    default: return ''
  }
}

export interface TrackerStep {
  label: string
  state: 'done' | 'current' | 'upcoming'
}

/** Per status: how many steps are done, and which one is current (-1: none). */
const PROGRESS: Record<OrderStatus, readonly [done: number, current: number]> = {
  awaiting_payment: [0, -1],
  preparing: [1, 1],
  ready: [2, 2],
  completed: [4, -1],
  cancelled: [0, -1],
}

/**
 * The four steps (Paid → Preparing → Ready → Picked up). "Current" is the step the order is at;
 * a cancelled order has no tracker (the review: four empty circles look like it's starting).
 */
export function trackerSteps(status: OrderStatus): TrackerStep[] {
  const labels = ['Paid', 'Preparing', 'Ready', 'Picked up']
  const [done, current] = PROGRESS[status]
  return labels.map((label, index) => ({
    label,
    state: index === current ? 'current' : index < done ? 'done' : 'upcoming',
  }))
}

export interface Countdown {
  /** Whole minutes left, rounded up ("1 min left" until it's over). */
  minutes: number
  /** The last 5 minutes: shown in red. */
  urgent: boolean
  /** Past the time: the expiry task (D104) cancels it within a minute. */
  over: boolean
}

/** Time left to pay, from this device's clock (the server's expiry decides). */
export function countdown(paymentDueAt: string, now: number): Countdown {
  const ms = Date.parse(paymentDueAt) - now
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  return { minutes, urgent: minutes <= 5, over: ms <= 0 }
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_usd: 'Cash',
  cash_khr: 'Cash (riel)',
  khqr: 'KHQR',
}

const REASON_TEXT: Record<CancelReason, string> = {
  customer_changed_mind: 'the customer changed their mind',
  item_unavailable: 'item unavailable',
  other: 'other reasons',
}

/**
 * Why it was cancelled, in the customer's words (the review): not paid in time, by them, or by the
 * cafe with its reason code (never the staff's own note, D106), and the money returned, if any.
 */
export function cancellationText(order: Pick<Order, 'cancellation' | 'payment' | 'totalMinor'>): { title: string, detail: string | null } {
  const by = order.cancellation?.by ?? 'cafe'
  const title = by === 'system'
    ? 'Not paid within 30 minutes'
    : by === 'customer'
      ? 'You cancelled this order'
      : `Cancelled by the cafe: ${REASON_TEXT[order.cancellation?.reason ?? 'other']}.`
  const payment = order.payment
  const returned = payment?.returnMethod
    ? `${formatMinor(payment.amountMinor)} returned ${payment.returnMethod === 'cash' ? 'in cash' : 'by KHQR'}.`
    : null
  return { title, detail: returned }
}

/** "Paid $9.75 · Cash · 10:21 AM" (riel: "Paid ៛40,000 · Cash (riel) · …"). */
export function paymentText(order: Pick<Order, 'payment'>): string | null {
  const payment = order.payment
  if (!payment) return null
  const amount = payment.method === 'cash_khr' && payment.amountKhr !== null
    ? `៛${payment.amountKhr.toLocaleString('en-US')}`
    : formatMinor(payment.amountMinor)
  return `Paid ${amount} · ${PAYMENT_METHOD_LABELS[payment.method]} · ${clockTime(payment.collectedAt)}`
}

/** "10:42 AM" on this device's clock. */
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

const dayKey = (time: number) => new Date(time).toDateString()

/** "Today 10:15 AM", "Yesterday", "Sep 28" (and the year when it isn't this year). */
export function placedText(placedAt: string, now: number): string {
  const time = Date.parse(placedAt)
  if (dayKey(time) === dayKey(now)) return `Today ${clockTime(placedAt)}`
  if (dayKey(time) === dayKey(now - 86_400_000)) return 'Yesterday'
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear()
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "1 item", "3 items". */
export const itemsText = (count: number) => pluralize(count, ['item', 'items'])

/** The menu's order bar (the review): one order by its number, several as a count. */
export function orderBarText(orders: Pick<OrderSummary, 'pickupNumber' | 'status'>[]): { text: string, ready: boolean } | null {
  if (!orders.length) return null
  if (orders.length > 1) {
    const ready = orders.some(o => o.status === 'ready')
    return { text: ready ? `${orders.length} orders in progress · one is ready` : `${orders.length} orders in progress`, ready }
  }
  const order = orders[0]!
  const number = formatPickupNumber(order.pickupNumber)
  if (order.status === 'ready') return { text: `Order ${number} is ready`, ready: true }
  return { text: `Order ${number} · ${statusBadge(order.status).label}`, ready: false }
}
