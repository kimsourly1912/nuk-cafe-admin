import type { OrderStatus } from '#shared/contracts/orders'
import { BUSINESS_DAY_START_MINUTE } from '#shared/contracts/orders'
import type { ItemSalesQuery, ItemSalesRow, PaymentState, TrendPoint } from '#shared/contracts/reports'
import { daysBetween } from '#shared/contracts/reports'
import { addDays, localDate, localTime, zonedInstant } from '../../utils/weekly-windows'

/**
 * Pure rules of the reports (step 8.1, docs/plans/reports.md, D110): business days, periods, the
 * sales trend, an order's payment state and the Sales by item table. No I/O.
 */

const MINUTE = 60_000

/** The business date an instant belongs to: the local date 4 hours earlier (04:00 to 04:00, D99). */
export function businessDateAt(instant: Date, timeZone: string): string {
  return localDate(new Date(instant.getTime() - BUSINESS_DAY_START_MINUTE * MINUTE), timeZone)
}

/** The instants business dates `from` to `to` cover: `[from 04:00, to+1 04:00)` in the zone. */
export function periodInstants(period: { from: string, to: string }, timeZone: string): { start: Date, end: Date } {
  return {
    start: zonedInstant(period.from, BUSINESS_DAY_START_MINUTE, timeZone),
    end: zonedInstant(addDays(period.to, 1), BUSINESS_DAY_START_MINUTE, timeZone),
  }
}

/** The period just before, as many days long ("vs yesterday", "vs the previous 7 days"). */
export function previousPeriod(period: { from: string, to: string }): { from: string, to: string } {
  const days = daysBetween(period.from, period.to) + 1
  return { from: addDays(period.from, -days), to: addDays(period.from, -1) }
}

/** Every business date from `from` to `to`, in order. */
export function datesOf(period: { from: string, to: string }): string[] {
  return Array.from({ length: daysBetween(period.from, period.to) + 1 }, (_, i) => addDays(period.from, i))
}

/**
 * Paid sales by local hour for one business day (24 buckets from 04 to 03, the business day's
 * order), or by business date for a longer period. Each payment counts where it was collected.
 */
export function salesTrend(payments: { collectedAt: Date, amountMinor: number }[], period: { from: string, to: string }, timeZone: string): { unit: 'hour' | 'day', points: TrendPoint[] } {
  const unit = period.from === period.to ? 'hour' : 'day'
  const keys = unit === 'hour'
    ? Array.from({ length: 24 }, (_, i) => String((i + BUSINESS_DAY_START_MINUTE / 60) % 24).padStart(2, '0'))
    : datesOf(period)
  const points = new Map(keys.map(key => [key, { key, salesMinor: 0, orders: 0 }]))
  for (const payment of payments) {
    const key = unit === 'hour'
      ? String(Math.floor(localTime(payment.collectedAt, timeZone).minute / 60)).padStart(2, '0')
      : businessDateAt(payment.collectedAt, timeZone)
    const point = points.get(key)
    if (!point) continue
    point.salesMinor += payment.amountMinor
    point.orders += 1
  }
  return { unit, points: [...points.values()] }
}

/** Paid sales ÷ paid orders in whole cents, half up; none without paid orders. */
export function averageMinor(salesMinor: number, orders: number): number | null {
  return orders ? Math.round(salesMinor / orders) : null
}

/**
 * The payment side of an order (D110): its payment returned → refunded; paid → paid; still
 * waiting → unpaid; cancelled with no payment → not paid.
 */
export function paymentState(status: OrderStatus, payment: { returnedAt: Date | null } | null): PaymentState {
  if (payment) return payment.returnedAt ? 'refunded' : 'paid'
  return status === 'awaiting_payment' ? 'unpaid' : 'not_paid'
}

export interface ItemTotalsRow {
  itemId: string
  name: string
  categoryId: string | null
  categoryName: string | null
  /** When this name was sold last (the name and category shown are the latest). */
  lastAt: number
  quantity: number
  totalMinor: number
}

/** Paid and refunded line totals per item in one table; the latest name and category win. */
export function itemSalesRows(paid: ItemTotalsRow[], refunded: ItemTotalsRow[]): ItemSalesRow[] {
  const rows = new Map<string, ItemSalesRow & { lastAt: number }>()
  const take = (row: ItemTotalsRow) => {
    const current = rows.get(row.itemId)
    if (current && current.lastAt >= row.lastAt) return current
    const next = { itemId: row.itemId, name: row.name, categoryId: row.categoryId, categoryName: row.categoryName, lastAt: row.lastAt, quantity: current?.quantity ?? 0, salesMinor: current?.salesMinor ?? 0, refundedMinor: current?.refundedMinor ?? 0 }
    rows.set(row.itemId, next)
    return next
  }
  for (const row of paid) {
    const item = take(row)
    item.quantity += row.quantity
    item.salesMinor += row.totalMinor
  }
  for (const row of refunded) take(row).refundedMinor += row.totalMinor
  return [...rows.values()].map(({ lastAt: _, ...row }) => row)
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** The best sellers: most sold first, then most sales, then by name. */
export function bestSellers(rows: ItemSalesRow[], count: number): ItemSalesRow[] {
  return rows
    .filter(row => row.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || b.salesMinor - a.salesMinor || collator.compare(a.name, b.name))
    .slice(0, count)
}

/** Sales by item: filtered by name and category, sorted, with totals over every matching row. */
export function itemSalesTable(rows: ItemSalesRow[], query: Pick<ItemSalesQuery, 'search' | 'categoryId' | 'sort' | 'direction'>) {
  const search = query.search.toLowerCase()
  const matching = rows.filter(row =>
    (!search || row.name.toLowerCase().includes(search))
    && (!query.categoryId || row.categoryId === query.categoryId))
  const value = (row: ItemSalesRow) => query.sort === 'quantity' ? row.quantity : query.sort === 'sales' ? row.salesMinor : row.refundedMinor
  const sign = query.direction === 'asc' ? 1 : -1
  matching.sort((a, b) => (query.sort === 'name'
    ? sign * collator.compare(a.name, b.name)
    : sign * (value(a) - value(b)) || collator.compare(a.name, b.name)))
  const totals = matching.reduce(
    (sum, row) => ({ items: sum.items + 1, quantity: sum.quantity + row.quantity, salesMinor: sum.salesMinor + row.salesMinor, refundedMinor: sum.refundedMinor + row.refundedMinor }),
    { items: 0, quantity: 0, salesMinor: 0, refundedMinor: 0 },
  )
  return { rows: matching, totals }
}

/** The categories rows fall in, by name (the filter's options). */
export function categoriesOf(rows: ItemSalesRow[]): { id: string, name: string }[] {
  const byId = new Map<string, string>()
  for (const row of rows) if (row.categoryId && row.categoryName) byId.set(row.categoryId, row.categoryName)
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.name, b.name))
}

/** "Sokha Chan" → "Sokha": the only part of a customer's name reports and alerts show (R3). */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'Customer'
