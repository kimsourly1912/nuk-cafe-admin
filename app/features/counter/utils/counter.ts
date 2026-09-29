import type { CounterOrder, CounterPayment, OrderStatus, PaymentMethod } from '#shared/contracts/orders'
import { ApiError } from '~/utils/api-error'
import { formatMinor } from '~/utils/money'

/**
 * The counter's pure rules (step 6.3b, D102): the board's columns, what a card says, the change
 * to give, and what a refused command means for the screen.
 */

export type ColumnId = 'to_pay' | 'preparing' | 'ready'

export interface Column {
  id: ColumnId
  label: string
  status: OrderStatus
  /** The same color roles as the customer's order page (D100). */
  color: 'warning' | 'info' | 'success'
}

export const COLUMNS: Column[] = [
  { id: 'to_pay', label: 'To pay', status: 'awaiting_payment', color: 'warning' },
  { id: 'preparing', label: 'Preparing', status: 'preparing', color: 'info' },
  { id: 'ready', label: 'Ready', status: 'ready', color: 'success' },
]

/** "042". */
export const orderNumber = (order: Pick<CounterOrder, 'pickupNumber'>) => String(order.pickupNumber).padStart(3, '0')

/** "Pickup" or "Dine-in · Table T01". */
export function orderTypeText(order: Pick<CounterOrder, 'orderType' | 'table'>): string {
  if (order.orderType !== 'dine_in' || !order.table) return 'Pickup'
  return `Dine-in · ${/^table\b/i.test(order.table.label) ? order.table.label : `Table ${order.table.label}`}`
}

/** The customer's first name ("Sokha" for "Sokha Chan"): enough to call out at the counter. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'Customer'

/** "2 items", counting quantities. */
export function itemCount(order: Pick<CounterOrder, 'lines'>): string {
  const count = order.lines.reduce((sum, line) => sum + line.quantity, 0)
  return `${count} ${count === 1 ? 'item' : 'items'}`
}

/** "Iced Latte, Banana Bread": each item once, in order. */
export const itemNames = (order: Pick<CounterOrder, 'lines'>) => [...new Set(order.lines.map(line => line.itemName))].join(', ')

const MINUTE = 60_000

/** "Just now", "4 min ago", "1 h 5 min ago". */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / MINUTE))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min ago` : `${hours} h ago`
}

/** Less than 5 minutes left to pay: the card says so in amber. */
export const payBySoon = (order: Pick<CounterOrder, 'paymentDueAt'>, now: number) => Date.parse(order.paymentDueAt) - now < 5 * MINUTE

/** "10:42 AM" on this device's clock. */
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** Orders shown as new: arrived in the last minute (after the screen's first load). */
export const NEW_FOR_MS = 60_000

/** Matches an order by its number ("42", "042") or the customer's name. */
export function matchesSearch(order: Pick<CounterOrder, 'pickupNumber' | 'customer'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (/^\d+$/.test(q)) return order.pickupNumber === Number(q) || orderNumber(order).includes(q)
  return order.customer.name.toLowerCase().includes(q)
}

// --- Money at the counter ---

/** "៛35,900". */
export const formatRiel = (amount: number) => `៛${amount.toLocaleString('en-US')}`

/** Quick "amount received" buttons: the next $5, $10, $20 and $50 at or above the total, three at most. */
export function usdQuickAmounts(totalMinor: number): number[] {
  const steps = [500, 1000, 2000, 5000].map(step => Math.ceil(totalMinor / step) * step)
  return [...new Set(steps)].filter(amount => amount > totalMinor).slice(0, 3)
}

/** The same in riel: the next ៛10,000, ៛50,000 and ៛100,000 (the notes customers hand over). */
export function rielQuickAmounts(totalKhr: number): number[] {
  const steps = [10_000, 20_000, 50_000, 100_000].map(step => Math.ceil(totalKhr / step) * step)
  return [...new Set(steps)].filter(amount => amount > totalKhr).slice(0, 3)
}

export type Change = { kind: 'exact' } | { kind: 'change', amount: number } | { kind: 'short', amount: number }

/** What to give back: nothing typed means the exact amount; less than the total is short. */
export function changeDue(total: number, received: number | null | undefined): Change {
  if (received == null || received === total) return { kind: 'exact' }
  return received > total ? { kind: 'change', amount: received - total } : { kind: 'short', amount: total - received }
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_usd: 'Cash USD',
  cash_khr: 'Cash riel',
  khqr: 'KHQR',
}

/** "Paid 10:20 AM by Sophea · Cash riel ៛29,800". */
export function paymentText(payment: CounterPayment): string {
  const amount = payment.method === 'cash_khr' && payment.amountKhr !== null ? formatRiel(payment.amountKhr) : formatMinor(payment.amountMinor)
  return `Paid ${clockTime(payment.collectedAt)} by ${firstName(payment.collectedBy.name)} · ${PAYMENT_METHOD_LABELS[payment.method]} ${amount}`
}

/**
 * What a refused payment or cancellation means for the panel:
 * - `changed`: someone else moved the order on (or the rate changed); reload shows it as it is;
 * - `expired`: the 30 minutes to pay are over;
 * - `retry`: no answer, or the server failed: Try again sends the same key (never a second payment);
 * - `other`: the server's message (a validation or permission problem).
 */
export type CommandFailure = 'changed' | 'expired' | 'retry' | 'other'

export function commandFailure(error: unknown, action: 'payment' | 'cancellation'): { kind: CommandFailure, message: string } {
  const apiError = ApiError.from(error)
  switch (apiError.code) {
    case 'ORDER_CHANGED':
    case 'EXCHANGE_RATE_CHANGED':
    case 'NO_EXCHANGE_RATE':
    case 'ORDER_NOT_CANCELLABLE':
      return { kind: 'changed', message: apiError.message }
    case 'PAYMENT_EXPIRED':
      return { kind: 'expired', message: apiError.message }
  }
  if (apiError.retryable) {
    return { kind: 'retry', message: `We couldn't confirm the ${action}. Try again: it won't be recorded twice.` }
  }
  return { kind: 'other', message: apiError.message }
}
