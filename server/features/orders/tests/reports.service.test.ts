import { beforeEach, describe, expect, it } from 'vitest'
import type { PayOrderInput } from '#shared/contracts/orders'
import { toRiel } from '#shared/contracts/orders'
import { itemSalesQuerySchema, orderHistoryQuerySchema, reportPeriodQuerySchema } from '#shared/contracts/reports'
import { organization } from '#server/db/tables'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem, updateCategory, updateItem } from '#server/features/menu'
import { cancelOrderAtCounter, markOrderReady, payOrder, setExchangeRate } from '#server/features/orders/counter.service'
import { expireUnpaidOrders } from '#server/features/orders/expiry.service'
import { cancelMyOrder, placeOrder } from '#server/features/orders/orders.service'
import { csvCell, csvFilename, moneyText } from '#server/features/orders/reports.csv'
import { itemsMessage, periodText } from '#server/features/orders/reports.message'
import { itemSalesExport, itemSalesReport, orderHistory, orderHistoryDetail, orderHistoryExport, reportBranches, reportMessage, reportSummary, summaryExport } from '#server/features/orders/reports.service'
import { businessDateAt, periodInstants } from '#server/features/orders/reports.rules'
import { createTestDb, createUser } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { parseInput } from '#server/utils/validation'

// The reports (step 8.1, docs/plans/reports.md, D110) against the real menu, order, counter and
// expiry services and the migrations. One Monday of orders, with every number worked out by hand.

let db: Db
const admin: Actor = { userId: 'admin-1', role: 'admin' }
let branchId: string
let latte: { itemId: string, variationId: string, version: number }
let croissant: { itemId: string, variationId: string }
let coffeeId: string
let cashier: BranchActor
const customers: Actor[] = []

/** Local time in Phnom Penh (UTC+7). */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`)
const MON = '2026-09-28'
const TUE = '2026-09-29'
const RATE = 4100

/** Open 07:00 to 02:00 (past midnight) every day. */
const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 120 }))

async function item(categoryId: string, name: string, priceMinor: number) {
  const draft = await createItem(db, admin, { categoryId, name, description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const published = await publishItem(db, admin, draft.id, { version: draft.version })
  return { itemId: published.id, variationId: published.variations[0]!.id, version: published.version }
}

let customerIndex = 0
/** Each order by its own customer (a customer may only have 2 unpaid). */
async function place(when: Date, lines: { item: { itemId: string, variationId: string }, quantity: number, note?: string }[], totalMinor: number) {
  const customer = customers[customerIndex++ % customers.length]!
  const { orderId } = await placeOrder(db, customer, {
    branchId,
    tableToken: null,
    lines: lines.map(line => ({ itemId: line.item.itemId, variationId: line.item.variationId, modifierIds: [], quantity: line.quantity, note: line.note ?? null })),
    expectedTotalMinor: totalMinor,
  }, crypto.randomUUID(), when)
  return { orderId, customer }
}

const pay = (orderId: string, when: Date, input: PayOrderInput = { version: 1, method: 'cash_usd' }) =>
  payOrder(db, cashier, orderId, input, crypto.randomUUID(), when)

const period = (from: string, to = from) => parseInput(reportPeriodQuerySchema, { branchId, from, to })

beforeEach(async () => {
  db = await createTestDb()
  branchId = newId()
  await db.insert(organization).values({ id: branchId, name: 'Riverside', slug: branchId, timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  await updateBranchSettings(db, admin, branchId, { version: 1, hours })
  const coffee = await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const bakery = await createCategory(db, admin, { name: 'Bakery', description: '', parentId: null, availabilityRuleIds: [] })
  coffeeId = coffee.id
  latte = await item(coffee.id, 'Iced Latte', 875)
  croissant = await item(bakery.id, 'Croissant', 300)
  customers.length = 0
  customerIndex = 0
  for (const name of ['Sokha Chan', 'Dara Sok', 'Vanna Lim', 'Bopha Keo', 'Rithy Om', 'Maly Chea', 'Nita Heng', 'Sina Ly']) {
    customers.push({ userId: (await createUser(db, `${name.split(' ')[0]!.toLowerCase()}@example.com`, name)).id, role: 'customer' })
  }
  cashier = { userId: (await createUser(db, 'sophea@example.com', 'Sophea Meas')).id, role: 'customer', branchId, branchRole: 'staff' }
  const rateSetter: Actor = { userId: (await createUser(db, 'kim@example.com', 'Kim')).id, role: 'admin' }
  await setExchangeRate(db, rateSetter, { khrPerUsd: RATE }, at(MON, '06:00'))
})

/**
 * Monday's orders:
 * A 09:00 latte, paid cash USD 09:05 ($8.75) · B 10:00 two croissants, paid KHQR 10:05 ($6.00)
 * C 11:00 latte, paid cash riel 11:05 ($8.75 = ៛35,900) · E 13:00 latte, never paid (expires 13:30)
 * F 13:10 latte, cancelled by its customer · G 14:00 latte, paid 14:05, cancelled by the cafe on
 * Tuesday 09:00 with the money returned · H 00:10 Tuesday latte, paid 00:30 (both still Monday's business
 * day). Paid Monday: A, B, C, G, H = $41.00 in 5 orders.
 */
async function monday() {
  const a = await place(at(MON, '09:00'), [{ item: latte, quantity: 1, note: 'Less ice' }], 875)
  await pay(a.orderId, at(MON, '09:05'))
  const b = await place(at(MON, '10:00'), [{ item: croissant, quantity: 2 }], 600)
  await pay(b.orderId, at(MON, '10:05'), { version: 1, method: 'khqr', reference: '8812' })
  const c = await place(at(MON, '11:00'), [{ item: latte, quantity: 1 }], 875)
  await pay(c.orderId, at(MON, '11:05'), { version: 1, method: 'cash_khr', khrPerUsd: RATE })
  const e = await place(at(MON, '13:00'), [{ item: latte, quantity: 1 }], 875)
  await expireUnpaidOrders(db, at(MON, '13:31'))
  const f = await place(at(MON, '13:10'), [{ item: latte, quantity: 1 }], 875)
  await cancelMyOrder(db, f.customer, f.orderId, { version: 1 }, crypto.randomUUID(), at(MON, '13:12'))
  const g = await place(at(MON, '14:00'), [{ item: latte, quantity: 1 }], 875)
  await pay(g.orderId, at(MON, '14:05'))
  await cancelOrderAtCounter(db, cashier, g.orderId, { version: 2, reason: 'item_unavailable', note: null, returnMethod: 'cash' }, crypto.randomUUID(), at(TUE, '09:00'))
  const h = await place(at(TUE, '00:10'), [{ item: latte, quantity: 1 }], 875)
  await pay(h.orderId, at(TUE, '00:30'), { version: 1, method: 'khqr', reference: null })
  return { a, b, c, e, f, g, h }
}

describe('business days (D110)', () => {
  it('run from 04:00 to 04:00 in the branch\'s zone: start included, end excluded', () => {
    const { start, end } = periodInstants({ from: MON, to: MON }, 'Asia/Phnom_Penh')
    expect(start.toISOString()).toBe('2026-09-27T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-28T21:00:00.000Z')
    expect(businessDateAt(at(TUE, '00:30'), 'Asia/Phnom_Penh')).toBe(MON)
    expect(businessDateAt(at(TUE, '03:59'), 'Asia/Phnom_Penh')).toBe(MON)
    expect(businessDateAt(at(TUE, '04:00'), 'Asia/Phnom_Penh')).toBe(TUE)
    // Another zone: New York in daylight saving time (UTC-4).
    expect(periodInstants({ from: MON, to: TUE }, 'America/New_York').start.toISOString()).toBe('2026-09-28T08:00:00.000Z')
  })

  it('a period ends on or after it starts, and covers at most 93 days', async () => {
    await expectApiError(() => parseInput(reportPeriodQuerySchema, { branchId: 'b', from: TUE, to: MON }), 400, 'VALIDATION_FAILED')
    await expectApiError(() => parseInput(reportPeriodQuerySchema, { branchId: 'b', from: '2026-01-01', to: '2026-04-04' }), 400, 'VALIDATION_FAILED')
    expect(parseInput(reportPeriodQuerySchema, { branchId: 'b', from: '2026-01-01', to: '2026-04-03' }).to).toBe('2026-04-03')
  })
})

describe('the summary (D110)', () => {
  it('counts each paid order once, at payment time, and refunds when the money went back', async () => {
    await monday()
    const summary = await reportSummary(db, period(MON), at(TUE, '12:00'))
    expect(summary.paid).toEqual({ salesMinor: 4100, orders: 5, averageMinor: 820 })
    expect(summary.refunds).toEqual({ amountMinor: 0, orders: 0 })
    expect(summary.netSalesMinor).toBe(4100)
    expect(summary.payments).toEqual([
      { method: 'cash_usd', orders: 2, amountMinor: 1750, amountKhr: null },
      { method: 'cash_khr', orders: 1, amountMinor: 875, amountKhr: toRiel(875, RATE) },
      { method: 'khqr', orders: 2, amountMinor: 1475, amountKhr: null },
    ])
    expect(toRiel(875, RATE)).toBe(35_900)
    // Placed Monday and cancelled unpaid: E expired (the system), F by its customer. G was paid.
    expect(summary.cancelledUnpaid).toEqual({ customer: 1, cafe: 0, system: 1 })
    expect(summary.ordersPlaced).toBe(7)
    expect(summary.bestSellers.map(row => [row.name, row.quantity, row.salesMinor])).toEqual([['Iced Latte', 4, 3500], ['Croissant', 2, 600]])
    // Asked on Tuesday: Monday isn't today, so no live counts.
    expect(summary.current).toBeNull()
    expect(summary.period).toEqual({ from: MON, to: MON, start: '2026-09-27T21:00:00.000Z', end: '2026-09-28T21:00:00.000Z' })
    expect(summary.asOf).toBe(at(TUE, '12:00').toISOString())

    const tuesday = await reportSummary(db, period(TUE), at(TUE, '12:00'))
    expect(tuesday.paid).toEqual({ salesMinor: 0, orders: 0, averageMinor: null })
    expect(tuesday.refunds).toEqual({ amountMinor: 875, orders: 1 })
    expect(tuesday.netSalesMinor).toBe(-875)
    expect(tuesday.previousPaidSalesMinor).toBe(4100)
  })

  it('shows sales by hour for one day, by business date for longer', async () => {
    await monday()
    const day = await reportSummary(db, period(MON), at(TUE, '12:00'))
    expect(day.trend.unit).toBe('hour')
    expect(day.trend.points.map(p => p.key)).toEqual(['04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '00', '01', '02', '03'])
    const sales = Object.fromEntries(day.trend.points.filter(p => p.orders).map(p => [p.key, p.salesMinor]))
    expect(sales).toEqual({ '09': 875, '10': 600, '11': 875, '14': 875, '00': 875 })

    const week = await reportSummary(db, period(MON, '2026-10-04'), at(TUE, '12:00'))
    expect(week.trend.unit).toBe('day')
    expect(week.trend.points).toHaveLength(7)
    expect(week.trend.points[0]).toEqual({ key: MON, salesMinor: 4100, orders: 5 })
  })

  it('counts current orders live, only when the period includes today', async () => {
    const waiting = await place(at(MON, '15:00'), [{ item: latte, quantity: 1 }], 875)
    const preparing = await place(at(MON, '15:01'), [{ item: latte, quantity: 1 }], 875)
    await pay(preparing.orderId, at(MON, '15:02'))
    const ready = await place(at(MON, '15:03'), [{ item: latte, quantity: 1 }], 875)
    await pay(ready.orderId, at(MON, '15:04'))
    await markOrderReady(db, cashier, ready.orderId, { version: 2 }, crypto.randomUUID(), at(MON, '15:05'))
    expect(waiting).toBeTruthy()
    const summary = await reportSummary(db, period(MON), at(MON, '15:10'))
    expect(summary.current).toEqual({ awaitingPayment: 1, preparing: 1, ready: 1 })
    // Past its 30 minutes, a waiting order isn't counted (the expiry task cancels it).
    expect((await reportSummary(db, period(MON), at(MON, '15:40'))).current?.awaitingPayment).toBe(0)
  })
})

describe('sales by item (D110)', () => {
  it('uses the prices, names and categories as sold, not the menu\'s now', async () => {
    await monday()
    await updateItem(db, admin, latte.itemId, { version: latte.version, name: 'Latte (iced)', variations: [{ valueIds: [], priceMinor: 990, status: 'active' }] })
    const coffee = await updateCategory(db, admin, coffeeId, { version: 1, name: 'Coffee & Tea' })
    expect(coffee.name).toBe('Coffee & Tea')

    const report = await itemSalesReport(db, parseInput(itemSalesQuerySchema, { branchId, from: MON, to: MON }), at(TUE, '12:00'))
    expect(report.items.map(row => [row.name, row.categoryName, row.quantity, row.salesMinor, row.refundedMinor])).toEqual([
      ['Iced Latte', 'Coffee', 4, 3500, 0],
      ['Croissant', 'Bakery', 2, 600, 0],
    ])
    expect(report.totals).toEqual({ items: 2, quantity: 6, salesMinor: 4100, refundedMinor: 0 })
    expect(report.categories.map(c => c.name)).toEqual(['Bakery', 'Coffee'])

    // G's refund counts on Tuesday, when the money went back.
    const tuesday = await itemSalesReport(db, parseInput(itemSalesQuerySchema, { branchId, from: TUE, to: TUE }), at(TUE, '12:00'))
    expect(tuesday.items.map(row => [row.name, row.quantity, row.salesMinor, row.refundedMinor])).toEqual([['Iced Latte', 0, 0, 875]])
  })

  it('filters, sorts and pages, with totals over every matching row', async () => {
    await monday()
    const query = (over: Record<string, string>) => parseInput(itemSalesQuerySchema, { branchId, from: MON, to: MON, ...over })
    const bySales = await itemSalesReport(db, query({ sort: 'sales', direction: 'asc', pageSize: '1' }))
    expect(bySales.items.map(row => row.name)).toEqual(['Croissant'])
    expect(bySales).toMatchObject({ total: 2, totalPages: 2, totals: { items: 2, salesMinor: 4100 } })
    expect((await itemSalesReport(db, query({ search: 'crois' }))).totals).toEqual({ items: 1, quantity: 2, salesMinor: 600, refundedMinor: 0 })
    expect((await itemSalesReport(db, query({ categoryId: coffeeId }))).items.map(row => row.name)).toEqual(['Iced Latte'])
    expect((await itemSalesReport(db, query({ sort: 'name', direction: 'asc' }))).items.map(row => row.name)).toEqual(['Croissant', 'Iced Latte'])
  })
})

describe('order history (D110)', () => {
  it('lists the orders placed in the period with their payment and progress, filtered', async () => {
    const o = await monday()
    const query = (over: Record<string, string> = {}) => parseInput(orderHistoryQuerySchema, { branchId, from: MON, to: MON, ...over })
    const all = await orderHistory(db, query(), at(TUE, '12:00'))
    expect(all.total).toBe(7)
    const byId = Object.fromEntries(all.orders.map(row => [row.id, [row.payment.state, row.payment.method, row.status]]))
    expect(byId[o.a.orderId]).toEqual(['paid', 'cash_usd', 'preparing'])
    expect(byId[o.e.orderId]).toEqual(['not_paid', null, 'cancelled'])
    expect(byId[o.f.orderId]).toEqual(['not_paid', null, 'cancelled'])
    expect(byId[o.g.orderId]).toEqual(['refunded', 'cash_usd', 'cancelled'])
    // Newest first by default.
    expect(all.orders[0]!.id).toBe(o.h.orderId)

    const ids = async (over: Record<string, string>) => (await orderHistory(db, query(over))).orders.map(row => row.id).sort()
    expect(await ids({ payment: 'refunded' })).toEqual([o.g.orderId])
    expect(await ids({ payment: 'not_paid' })).toEqual([o.e.orderId, o.f.orderId].sort())
    expect(await ids({ payment: 'paid', method: 'khqr' })).toEqual([o.b.orderId, o.h.orderId].sort())
    expect(await ids({ progress: 'cancelled' })).toEqual([o.e.orderId, o.f.orderId, o.g.orderId].sort())
    expect(await ids({ search: '1' })).toEqual([o.a.orderId])
    const paged = await orderHistory(db, query({ sort: 'total', direction: 'asc', pageSize: '2', page: '1' }))
    expect(paged).toMatchObject({ total: 7, totalPages: 4 })
    expect(paged.orders[0]!.totalMinor).toBe(600)
    // Tuesday has no orders placed (H, at 00:10 Tuesday, belongs to Monday's business day).
    expect((await orderHistory(db, parseInput(orderHistoryQuerySchema, { branchId, from: TUE, to: TUE }))).total).toBe(0)
  })

  it('shows an order as sold, its payment and every recorded step with who took it', async () => {
    const o = await monday()
    const g = await orderHistoryDetail(db, o.g.orderId)
    expect(g.customerFirstName).toBe('Maly')
    expect(g.payment).toMatchObject({ state: 'refunded', method: 'cash_usd', amountMinor: 875, collectedBy: 'Sophea Meas', returnMethod: 'cash', returnedBy: 'Sophea Meas', returnedAt: at(TUE, '09:00').toISOString() })
    expect(g.timeline.map(e => [e.toStatus, e.by.kind, e.by.name, e.reason])).toEqual([
      ['awaiting_payment', 'customer', 'Maly', null],
      ['preparing', 'staff', 'Sophea Meas', null],
      ['cancelled', 'staff', 'Sophea Meas', 'item_unavailable'],
    ])
    const a = await orderHistoryDetail(db, o.a.orderId)
    expect(a.lines).toEqual([{ itemName: 'Iced Latte', categoryName: 'Coffee', detail: '', modifiers: [], unitPriceMinor: 875, quantity: 1, totalMinor: 875, note: 'Less ice' }])
    const c = await orderHistoryDetail(db, o.c.orderId)
    expect(c.payment).toMatchObject({ method: 'cash_khr', amountKhr: 35_900, khrPerUsd: RATE })
    const e = await orderHistoryDetail(db, o.e.orderId)
    expect(e.timeline.at(-1)).toMatchObject({ toStatus: 'cancelled', by: { kind: 'system', name: null } })
    expect(e.payment.state).toBe('not_paid')
    await expectApiError(() => orderHistoryDetail(db, newId()), 404, 'NOT_FOUND')
  })
})

describe('CSV (8.1b, D111)', () => {
  it('neutralizes formulas, quotes what needs it and keeps amounts exact', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe('\'+1')
    expect(csvCell('-2')).toBe('\'-2')
    expect(csvCell('@SUM(A1)')).toBe('\'@SUM(A1)')
    expect(csvCell('Iced Latte, large')).toBe('"Iced Latte, large"')
    expect(csvCell('ឡាតេ ៛')).toBe('ឡាតេ ៛')
    expect(csvCell({ amount: '-14.00' })).toBe('-14.00')
    expect(csvCell(null)).toBe('')
    expect([moneyText(875), moneyText(-1400), moneyText(5), moneyText(0)]).toEqual(['8.75', '-14.00', '0.05', '0.00'])
    expect(csvFilename('Riverside', { from: MON, to: MON }, 'summary')).toBe('riverside-2026-09-28-summary.csv')
    expect(csvFilename('Zeta Kiosk!', { from: MON, to: TUE }, 'orders')).toBe('zeta-kiosk-2026-09-28-to-2026-09-29-orders.csv')
  })

  it('exports every matching row, in the page\'s order, agreeing with the report', async () => {
    await monday()
    const items = await itemSalesExport(db, parseInput(itemSalesQuerySchema, { branchId, from: MON, to: MON, pageSize: '1' }))
    const lines = items.csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')
    expect(items.csv.startsWith('\uFEFF')).toBe(true)
    expect(lines).toEqual([
      'Item,Category,Quantity sold,Paid sales (USD),Refunded (USD)',
      'Iced Latte,Coffee,4,35.00,0.00',
      'Croissant,Bakery,2,6.00,0.00',
    ])
    const orders = await orderHistoryExport(db, parseInput(orderHistoryQuerySchema, { branchId, from: MON, to: MON, pageSize: '2', sort: 'number', direction: 'asc' }))
    const orderLines = orders.csv.trimEnd().split('\r\n')
    expect(orderLines).toHaveLength(1 + 7)
    expect(orderLines[1]).toBe('001,2026-09-28,2026-09-28 09:00,Pickup,,Paid,Cash USD,Preparing,8.75')
    expect(orders.filename).toBe('riverside-2026-09-28-orders.csv')
    const summary = await summaryExport(db, period(TUE), at(TUE, '12:00'))
    expect(summary.csv).toContain('Sales,Refunds,1,-8.75,')
    expect(summary.csv).toContain('Sales,Net sales,,-8.75,')
  })

  it('lists the active branches with today\'s business date in each zone', async () => {
    expect(await reportBranches(db, at(TUE, '03:00'))).toEqual([{ id: branchId, name: 'Riverside', timeZone: 'Asia/Phnom_Penh', today: MON }])
  })
})

describe('Telegram message (8.1c, D112)', () => {
  it('sends the Summary\'s figures, short, with the period and when they were read', async () => {
    await monday()
    const past = await reportMessage(db, { kind: 'summary', query: { branchId, from: MON, to: MON } }, { attachCsv: true }, at(TUE, '12:00'))
    expect(past.html).toContain('<b>Summary · Riverside</b>')
    expect(past.html).toContain('Paid sales <b>$41.00</b> · 5 orders · average $8.20')
    expect(past.text).not.toContain('<b>')
    expect(past.text).toContain('Mon 28 Sep 2026')
    expect(past.text).toContain('Business days 4:00 AM to 4:00 AM, Asia/Phnom_Penh.')
    expect(past.csv?.filename).toBe('riverside-2026-09-28-summary.csv')
    expect(past.audit).toEqual({ report: 'summary', branchId, from: MON, to: MON })
    expect(JSON.stringify(past)).not.toMatch(/@example\.com/)

    const today = await reportMessage(db, { kind: 'summary', query: { branchId, from: MON, to: MON } }, { attachCsv: false }, at(MON, '12:00'))
    expect(today.text).toContain('Figures as of 12:00 PM. Business day ends at 4:00 AM.')
    expect(today.csv).toBeNull()
  })

  it('lists items in the page\'s filters and order, with totals', async () => {
    await monday()
    const message = await reportMessage(db, { kind: 'items', query: { branchId, from: MON, to: MON, sort: 'sales', direction: 'desc' } }, { attachCsv: true }, at(TUE, '12:00'))
    expect(message.text).toMatch(/^Sales by item · Riverside\nMon 28 Sep 2026\n\n1\. /)
    expect(message.text).toContain('Totals for 2 items: 6 sold · $41.00')
    expect(message.csv?.filename).toBe('riverside-2026-09-28-items.csv')
    await expectApiError(() => reportMessage(db, { kind: 'items', query: { branchId, from: TUE, to: MON } }, { attachCsv: false }), 400, 'VALIDATION_FAILED')
  })

  it('escapes names for Telegram\'s HTML and says how many more there are', () => {
    const report = { branch: { id: 'b', name: 'R&D <Cafe>', timeZone: 'Asia/Phnom_Penh' }, period: { from: MON, to: TUE, start: '', end: '' }, asOf: at(TUE, '12:00').toISOString() }
    const rows = Array.from({ length: 17 }, (_, i) => ({ itemId: `i${i}`, name: i ? `Item ${i}` : 'Tea <b>&', categoryId: null, categoryName: null, quantity: 1, salesMinor: 100, refundedMinor: 0 }))
    const html = itemsMessage(report, rows, { search: '', categoryId: undefined }, null, false)
    expect(html).toContain('<b>Sales by item · R&amp;D &lt;Cafe&gt;</b>')
    expect(html).toContain('1. Tea &lt;b&gt;&amp;: 1 sold · $1.00')
    expect(html).toContain('…and 2 more.')
    expect(periodText({ from: MON, to: TUE })).toBe('28 – 29 Sep 2026')
  })
})
