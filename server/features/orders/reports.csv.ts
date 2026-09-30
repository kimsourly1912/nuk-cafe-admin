import type { OrderStatus, OrderType, PaymentMethod } from '#shared/contracts/orders'
import type { ItemSalesRow, OrderHistoryRow, PaymentState, ReportSummary } from '#shared/contracts/reports'
import { localDate, localTime } from '#server/utils/weekly-windows'

export { csvFilename } from '#shared/contracts/reports'

/**
 * The reports as CSV (step 8.1b, D111): every matching row, the page's filters and order kept.
 * UTF-8 with a byte-order mark (Excel then reads Khmer and ៛ correctly), CRLF lines, RFC 4180
 * quoting, and text that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab, CR at the
 * start) prefixed with `'`. Money as plain decimals (`8.75`, `-14.00`) so spreadsheets can add it.
 */

/** Text (checked for formulas), a number, an exact amount (`{ amount: "8.75" }`), or empty. */
type Cell = string | number | { amount: string } | null

const FORMULA_START = /^[=+\-@\t\r]/

/** One cell: a number as it is; text neutralized against formulas, then quoted when needed. */
export function csvCell(value: Cell): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') return value.amount
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** Cents as an exact decimal, no floating point: 875 → "8.75", -1400 → "-14.00". */
export function moneyText(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const amount = (minor: number): Cell => ({ amount: moneyText(minor) })

/** "2026-09-30 09:02" in the branch's zone. */
export function localStamp(iso: string, timeZone: string): string {
  const at = new Date(iso)
  const minute = localTime(at, timeZone).minute
  return `${localDate(at, timeZone)} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export const METHOD_LABELS: Record<PaymentMethod, string> = { cash_usd: 'Cash USD', cash_khr: 'Cash riel', khqr: 'KHQR' }
export const PAYMENT_LABELS: Record<PaymentState, string> = { unpaid: 'Unpaid', paid: 'Paid', refunded: 'Refunded', not_paid: 'Not paid' }
export const PROGRESS_LABELS: Record<OrderStatus, string> = { awaiting_payment: 'Waiting for payment', preparing: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' }
const TYPE_LABELS: Record<OrderType, string> = { pickup: 'Pickup', dine_in: 'Dine-in' }

/** The Summary as one table: Section, Measure, Count, Amount (USD), Amount (KHR). */
export function summaryCsv(summary: ReportSummary): string {
  const rows: Cell[][] = [
    ['Report', summary.branch.name, null, null, null],
    ['Report', `Business dates ${summary.period.from} to ${summary.period.to} (04:00 to 04:00, ${summary.branch.timeZone})`, null, null, null],
    ['Report', `As of ${localStamp(summary.asOf, summary.branch.timeZone)}`, null, null, null],
    ['Sales', 'Paid sales', summary.paid.orders, amount(summary.paid.salesMinor), null],
    ['Sales', 'Average order', null, summary.paid.averageMinor === null ? null : amount(summary.paid.averageMinor), null],
    ['Sales', 'Refunds', summary.refunds.orders, amount(-summary.refunds.amountMinor), null],
    ['Sales', 'Net sales', null, amount(summary.netSalesMinor), null],
    ['Sales', 'Orders placed', summary.ordersPlaced, null, null],
    ...summary.payments.map((p): Cell[] => ['Payments', METHOD_LABELS[p.method], p.orders, amount(p.amountMinor), p.amountKhr]),
    ...summary.trend.points.map((p): Cell[] => [summary.trend.unit === 'hour' ? 'Paid sales by hour' : 'Paid sales by day', summary.trend.unit === 'hour' ? `${p.key}:00` : p.key, p.orders, amount(p.salesMinor), null]),
    ...summary.bestSellers.map((row): Cell[] => ['Best sellers', row.name, row.quantity, amount(row.salesMinor), null]),
    ['Cancelled, not paid', 'By customer', summary.cancelledUnpaid.customer, null, null],
    ['Cancelled, not paid', 'By the cafe', summary.cancelledUnpaid.cafe, null, null],
    ['Cancelled, not paid', 'Expired unpaid', summary.cancelledUnpaid.system, null, null],
  ]
  if (summary.current) {
    rows.push(
      ['Current orders (live)', 'Waiting for payment', summary.current.awaitingPayment, null, null],
      ['Current orders (live)', 'Preparing', summary.current.preparing, null, null],
      ['Current orders (live)', 'Ready', summary.current.ready, null, null],
    )
  }
  return toCsv(['Section', 'Measure', 'Count', 'Amount (USD)', 'Amount (KHR)'], rows)
}

export function itemsCsv(rows: ItemSalesRow[]): string {
  return toCsv(
    ['Item', 'Category', 'Quantity sold', 'Paid sales (USD)', 'Refunded (USD)'],
    rows.map(row => [row.name, row.categoryName, row.quantity, amount(row.salesMinor), amount(row.refundedMinor)]),
  )
}

export function ordersCsv(rows: OrderHistoryRow[], timeZone: string): string {
  return toCsv(
    ['Order', 'Business date', 'Placed at', 'Type', 'Table', 'Payment', 'Method', 'Progress', 'Total (USD)'],
    rows.map(row => [
      String(row.pickupNumber).padStart(3, '0'),
      row.businessDate,
      localStamp(row.placedAt, timeZone),
      TYPE_LABELS[row.orderType],
      row.tableLabel,
      PAYMENT_LABELS[row.payment.state],
      row.payment.method ? METHOD_LABELS[row.payment.method] : null,
      PROGRESS_LABELS[row.status],
      amount(row.totalMinor),
    ]),
  )
}
