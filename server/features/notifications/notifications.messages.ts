import type { WeeklyWindow } from '#shared/contracts/common'
import { MINUTES_PER_DAY } from '#shared/contracts/common'
import type { NotificationKind } from '#shared/contracts/notifications'
import { BUSINESS_DAY_START_MINUTE } from '#shared/contracts/orders'
import type { OrderAlert } from '../orders'
import { addDays, zonedInstant } from '../../utils/weekly-windows'
import { escapeHtml } from './notifications.rules'
import type { StoredMessage } from './notifications.schema'

/**
 * Pure rules of the alerts and the closing summary (step 8.1d, D113): what a message says, and
 * when a business day closes. Messages carry the customer's first name only (R3).
 */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (minor: number) => usd.format(minor / 100)
const riel = (amount: number) => `៛${amount.toLocaleString('en-US')}`
const METHODS = { cash_usd: 'Cash USD', cash_khr: 'Cash riel', khqr: 'KHQR' } as const

/** "#042": pickup numbers restart every business day. */
export const orderNumber = (pickupNumber: number) => `#${String(pickupNumber).padStart(3, '0')}`

/**
 * Telegram only accepts buttons with a public https address: none on a local machine (R2's
 * "Open order" opens the order in the counter app).
 */
export function openOrderButton(siteUrl: string | undefined, alert: Pick<OrderAlert, 'branch' | 'orderId'>): StoredMessage['button'] {
  if (!siteUrl?.startsWith('https://')) return undefined
  return { text: 'Open order', url: new URL(`/counter/${alert.branch.id}?order=${alert.orderId}`, siteUrl).toString() }
}

/** "Pickup · Sokha", "Dine-in · T4 · Sokha". */
function who(alert: OrderAlert) {
  const type = alert.orderType === 'dine_in' ? `Dine-in${alert.tableLabel ? ` · ${alert.tableLabel}` : ''}` : 'Pickup'
  return `${type} · ${alert.customerFirstName}`
}

/** The new-order alert: the lines with their options, each note under its own line, the total. */
export function newOrderMessage(alert: OrderAlert, siteUrl?: string): StoredMessage {
  const lines = [
    `🧾 <b>New order ${orderNumber(alert.pickupNumber)} · ${escapeHtml(alert.branch.name)}</b>`,
    escapeHtml(who(alert)),
    '',
  ]
  for (const line of alert.lines) {
    const options = [line.detail, ...line.modifiers].filter(Boolean)
    lines.push(`${line.quantity} × ${escapeHtml(line.itemName)}${options.length ? ` (${escapeHtml(options.join(', '))})` : ''}`)
    if (line.note) lines.push(`   ↳ <i>${escapeHtml(line.note)}</i>`)
  }
  lines.push('', `Total <b>${money(alert.totalMinor)}</b>`, '⏳ Waiting for payment. Preparation starts after payment.')
  return { html: lines.join('\n'), button: openOrderButton(siteUrl, alert) }
}

/** The payment alert: who paid how much, how; preparation starts. */
export function paymentMessage(alert: OrderAlert, siteUrl?: string): StoredMessage {
  const payment = alert.payment
  const paid = payment
    ? `${METHODS[payment.method]} ${payment.method === 'cash_khr' && payment.amountKhr !== null ? riel(payment.amountKhr) : money(payment.amountMinor)}`
    : money(alert.totalMinor)
  return {
    html: [
      `✅ <b>Paid ${orderNumber(alert.pickupNumber)} · ${escapeHtml(alert.branch.name)}</b>`,
      `${escapeHtml(who(alert))} · ${paid}`,
      'Preparation can start.',
    ].join('\n'),
    button: openOrderButton(siteUrl, alert),
  }
}

export const alertSubject = (kind: Extract<NotificationKind, 'new_order' | 'payment'>, alert: Pick<OrderAlert, 'pickupNumber'>) =>
  `${kind === 'new_order' ? 'New order' : 'Paid'} ${orderNumber(alert.pickupNumber)}`

/** ISO weekday of a `YYYY-MM-DD` date: 1 = Monday … 7 = Sunday. */
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7

/**
 * When business date `date` closes (D113): the end of its last opening window, in the branch's zone.
 * A business day runs 04:00 to 04:00, so its windows are the ones starting on `date` from 04:00 and
 * those starting on the next calendar day before 04:00 (after midnight). An overnight window ends
 * the next day. `null`: no window, a closed day, and no closing summary (R4).
 */
export function closingInstant(windows: WeeklyWindow[], date: string, timeZone: string): Date | null {
  const next = addDays(date, 1)
  let end: number | null = null
  for (const window of windows) {
    const startDate = window.weekday === weekdayOf(date) && window.startMinute >= BUSINESS_DAY_START_MINUTE
      ? date
      : window.weekday === weekdayOf(next) && window.startMinute < BUSINESS_DAY_START_MINUTE ? next : null
    if (!startDate) continue
    const length = window.endMinute > window.startMinute ? window.endMinute - window.startMinute : window.endMinute + MINUTES_PER_DAY - window.startMinute
    const windowEnd = zonedInstant(startDate, window.startMinute, timeZone).getTime() + length * 60_000
    if (end === null || windowEnd > end) end = windowEnd
  }
  return end === null ? null : new Date(end)
}

/** How long after closing the summary goes: the last orders are usually finished by then. */
export const CLOSING_SUMMARY_DELAY_MINUTES = 30
/** A summary not sent within this long of its time (the server was down) isn't sent late. */
export const CLOSING_SUMMARY_WINDOW_HOURS = 12
