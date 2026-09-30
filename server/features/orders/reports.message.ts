import { BUSINESS_DAY_START_MINUTE } from '#shared/contracts/orders'
import type { ItemSalesQuery, ItemSalesRow, ReportContext, ReportSummary } from '#shared/contracts/reports'
import { localTime } from '../../utils/weekly-windows'
import { businessDateAt } from './reports.rules'
import { METHOD_LABELS } from './reports.csv'

/**
 * A report as a Telegram message (step 8.1c, D112): Telegram's HTML (`<b>` only), short enough
 * for a phone, never an email or a member code. The preview in the portal is the same message as
 * plain text (`plainText`).
 */

/** Telegram's HTML: only `&`, `<` and `>` need escaping in text. */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (minor: number) => usd.format(minor / 100)
const riel = (amount: number) => `៛${amount.toLocaleString('en-US')}`
const count = (n: number) => n.toLocaleString('en-US')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dateParts(date: string) {
  const at = new Date(`${date}T00:00:00Z`)
  return { weekday: WEEKDAYS[at.getUTCDay()]!, day: at.getUTCDate(), month: MONTHS[at.getUTCMonth()]!, year: at.getUTCFullYear() }
}

/** "Tue 30 Sep 2026", "24 – 30 Sep 2026", "28 Aug – 3 Sep 2026" (the portal's words). */
export function periodText(period: { from: string, to: string }): string {
  const a = dateParts(period.from)
  if (period.from === period.to) return `${a.weekday} ${a.day} ${a.month} ${a.year}`
  const b = dateParts(period.to)
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`
  return `${a.day} – ${b.day} ${b.month} ${b.year}`
}

const clock = (minute: number) => `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${minute < 720 ? 'AM' : 'PM'}`

/** "Figures as of 2:35 PM. Business day ends at 4:00 AM." while the period includes today; the zone otherwise. */
function asOfLine(report: ReportContext): string {
  const asOf = new Date(report.asOf)
  const zone = report.branch.timeZone
  const today = businessDateAt(asOf, zone)
  if (report.period.from <= today && today <= report.period.to) {
    return `Figures as of ${clock(localTime(asOf, zone).minute)}. Business day ends at ${clock(BUSINESS_DAY_START_MINUTE)}.`
  }
  return `Business days ${clock(BUSINESS_DAY_START_MINUTE)} to ${clock(BUSINESS_DAY_START_MINUTE)}, ${zone}.`
}

/** `title`: "Summary" when sent from the page, "Closing summary" at the end of the day (D113). */
export function summaryMessage(summary: ReportSummary, title = 'Summary'): string {
  const lines = [
    `<b>${esc(title)} · ${esc(summary.branch.name)}</b>`,
    periodText(summary.period),
    '',
    `Paid sales <b>${money(summary.paid.salesMinor)}</b> · ${count(summary.paid.orders)} ${summary.paid.orders === 1 ? 'order' : 'orders'}${summary.paid.averageMinor === null ? '' : ` · average ${money(summary.paid.averageMinor)}`}`,
  ]
  if (summary.refunds.orders) lines.push(`Refunds −${money(summary.refunds.amountMinor)} (${summary.refunds.orders}) · net sales ${money(summary.netSalesMinor)}`)
  const payments = summary.payments.filter(p => p.orders).map(p => `${METHOD_LABELS[p.method]} ${p.amountKhr === null ? money(p.amountMinor) : riel(p.amountKhr)}`)
  if (payments.length) lines.push(payments.join(' · '))
  if (summary.bestSellers.length) lines.push(`Top: ${summary.bestSellers.slice(0, 3).map(item => `${esc(item.name)} ${item.quantity}`).join(', ')}`)
  const open = summary.current && [
    summary.current.awaitingPayment && `${summary.current.awaitingPayment} waiting for payment`,
    summary.current.preparing && `${summary.current.preparing} preparing`,
  ].filter(Boolean)
  if (open?.length) lines.push(`Still open: ${open.join(', ')}`)
  const cancelled = summary.cancelledUnpaid.customer + summary.cancelledUnpaid.cafe + summary.cancelledUnpaid.system
  if (cancelled) lines.push(`Cancelled before payment: ${cancelled}`)
  lines.push('', `<i>${asOfLine(summary)}</i>`)
  return lines.join('\n')
}

/** How many items a message lists; the rest are in the CSV or the portal. */
export const MESSAGE_ITEMS = 15

export function itemsMessage(report: ReportContext, rows: ItemSalesRow[], query: Pick<ItemSalesQuery, 'search' | 'categoryId'>, categoryName: string | null, attached: boolean): string {
  const filters = [categoryName, query.search && `“${query.search}”`].filter(Boolean) as string[]
  const lines = [
    `<b>Sales by item · ${esc(report.branch.name)}</b>`,
    periodText(report.period) + (filters.length ? ` · ${esc(filters.join(' · '))}` : ''),
    '',
  ]
  if (!rows.length) lines.push('Nothing sold in this period.')
  rows.slice(0, MESSAGE_ITEMS).forEach((row, index) => {
    const refunded = row.refundedMinor ? ` · refunded −${money(row.refundedMinor)}` : ''
    lines.push(`${index + 1}. ${esc(row.name)}: ${row.quantity} sold · ${money(row.salesMinor)}${refunded}`)
  })
  if (rows.length > MESSAGE_ITEMS) lines.push(`…and ${rows.length - MESSAGE_ITEMS} more${attached ? ' in the CSV' : ''}.`)
  if (rows.length) {
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0)
    const sales = rows.reduce((sum, row) => sum + row.salesMinor, 0)
    const refunded = rows.reduce((sum, row) => sum + row.refundedMinor, 0)
    lines.push('', `Totals for ${rows.length} ${rows.length === 1 ? 'item' : 'items'}: ${count(quantity)} sold · <b>${money(sales)}</b>${refunded ? ` · refunded −${money(refunded)}` : ''}`)
  }
  lines.push('', `<i>${asOfLine(report)}</i>`)
  return lines.join('\n')
}

/** The message as the portal previews it: tags removed, entities back to text. */
export function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
