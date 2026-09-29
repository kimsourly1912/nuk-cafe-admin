import type { Order, OrderStatus } from '#shared/contracts/orders'

/** The customer's orders (step 6.2b, D100; tracking grows here in 6.5). */

/** "042": pickup numbers are shown with three digits (owner, 2026-09-29). */
export const formatPickupNumber = (n: number) => String(n).padStart(3, '0')

/** The badge for a status: its words and its color role. */
export function statusBadge(status: OrderStatus): { label: string, color: 'warning' | 'info' | 'success' | 'neutral' | 'error' } {
  switch (status) {
    case 'awaiting_payment': return { label: 'Waiting for payment', color: 'warning' }
    case 'preparing': return { label: 'Preparing', color: 'info' }
    case 'ready': return { label: 'Ready', color: 'success' }
    case 'completed': return { label: 'Completed', color: 'neutral' }
    case 'cancelled': return { label: 'Cancelled', color: 'error' }
  }
}

/** "Table T01" for a label "T01"; a label that already says "Table 4" stays as it is. */
export const tableName = (label: string) => (/^table\b/i.test(label) ? label : `Table ${label}`)

/** What to do next, as the order page says it. */
export function nextStep(order: Pick<Order, 'status' | 'orderType' | 'table'>): string {
  if (order.status !== 'awaiting_payment') return ''
  if (order.orderType === 'dine_in' && order.table) {
    return `Pay at the counter, then we'll bring it to ${tableName(order.table.label)}.`
  }
  return 'Pay at the counter to start your order. Show this number to the cashier.'
}

/** "10:42 AM" on this device's clock. */
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
