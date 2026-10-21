import type { CancelReason, CounterOrder, CounterOrderHistory, CounterTimelineStep } from '#shared/contracts/orders'
import { formatMinor } from '~/utils/money'
import { clockTime, firstName, formatRiel, PAYMENT_METHOD_LABELS } from './counter'

/**
 * "Finished today" (step 10.2, D117, the owner's frames): what a row and the order panel say about
 * an order that left the queue. Staff are named by first name, like the rest of the counter. Read only.
 */

export type FinishedFilter = 'all' | 'completed' | 'cancelled'

/** When it left the queue: completed, or cancelled. */
export const finishedAt = (order: Pick<CounterOrder, 'completedAt' | 'cancelledAt'>) => order.completedAt ?? order.cancelledAt ?? ''

export function filterFinished<T extends Pick<CounterOrder, 'status'>>(orders: T[], filter: FinishedFilter): T[] {
  return filter === 'all' ? orders : orders.filter(order => order.status === filter)
}

/** The row's payment note: "Cash USD", "KHQR", "Cash riel", "Cash USD · Returned", or "Unpaid". */
export function paymentNote(order: Pick<CounterOrder, 'payment'>): string {
  const payment = order.payment
  if (!payment) return 'Unpaid'
  const method = PAYMENT_METHOD_LABELS[payment.method]
  return payment.returnMethod ? `${method} · Returned` : method
}

/** "2 × Iced Latte, 1 × Banana Bread". */
export const itemSummary = (order: Pick<CounterOrder, 'lines'>) => order.lines.map(line => `${line.quantity} × ${line.itemName}`).join(', ')

const REASONS: Record<CancelReason, string> = {
  customer_changed_mind: 'customer changed their mind',
  item_unavailable: 'item unavailable',
  other: 'other',
}

const byText = (step: Pick<CounterTimelineStep, 'by'>) =>
  step.by.kind === 'staff' ? `by ${firstName(step.by.name ?? 'staff')}` : step.by.kind === 'customer' ? `by the customer (${step.by.name})` : 'automatically'

/**
 * The cancellation card: who and why ("Cancelled by Sophea: item unavailable", "Cancelled by the
 * customer", "Not paid in 30 minutes"), the staff's own note, and how the money went back.
 */
export function cancellationSummary(history: CounterOrderHistory): { title: string, note: string | null, returned: string | null } | null {
  const step = history.timeline.findLast(s => s.toStatus === 'cancelled')
  if (!step) return null
  const title = step.by.kind === 'system'
    ? 'Not paid in 30 minutes'
    : step.by.kind === 'customer'
      ? 'Cancelled by the customer'
      : `Cancelled by ${firstName(step.by.name ?? 'staff')}: ${REASONS[step.reason ?? 'other']}`
  const payment = history.order.payment
  const returned = payment?.returnMethod && payment.returnedAt
    ? `${formatMinor(payment.amountMinor)} returned ${payment.returnMethod === 'cash' ? 'in cash' : 'by KHQR'}${history.returnedBy ? ` by ${firstName(history.returnedBy)}` : ''} at ${clockTime(payment.returnedAt)}`
    : null
  return { title, note: step.note, returned }
}

export interface TimelineItem {
  label: string
  at: string
  detail: string
}

const STEP_LABELS = { awaiting_payment: 'Placed', preparing: 'Paid', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' } as const

/** The timeline: each step with who took it; the payment on "Paid"; the money returned as its own step. */
export function timelineItems(history: CounterOrderHistory): TimelineItem[] {
  const payment = history.order.payment
  const items = history.timeline.map((step): TimelineItem => {
    let detail = byText(step)
    if (step.toStatus === 'preparing' && payment) {
      const amount = payment.method === 'cash_khr' && payment.amountKhr !== null ? formatRiel(payment.amountKhr) : formatMinor(payment.amountMinor)
      detail = `${PAYMENT_METHOD_LABELS[payment.method]} ${amount} · ${detail}`
    }
    return { label: STEP_LABELS[step.toStatus], at: step.at, detail }
  })
  if (payment?.returnMethod && payment.returnedAt) {
    items.push({ label: payment.returnMethod === 'cash' ? 'Cash returned' : 'Returned by KHQR', at: payment.returnedAt, detail: history.returnedBy ? `by ${firstName(history.returnedBy)}` : '' })
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
