import { readFile } from 'node:fs/promises'
import { createPage, url } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { ItemSalesReport, ItemSalesRow, OrderHistory, OrderHistoryDetail, OrderHistoryRow, ReportBranch, ReportContext, ReportSummary } from '../../shared/contracts/reports'
import type { MockHandler } from './support/mock-api'
import { failures, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// Reports (step 8.1b, D111): Summary, Sales by item and Order history on a mocked API.

const TODAY = '2026-09-30'
const BRANCH: ReportBranch = { id: 'branch-1', name: 'Riverside', timeZone: 'Asia/Phnom_Penh', today: TODAY }

function context(from = TODAY, to = TODAY): ReportContext {
  return {
    branch: { id: BRANCH.id, name: BRANCH.name, timeZone: BRANCH.timeZone },
    period: { from, to, start: `${from}T21:00:00.000Z`, end: `${to}T21:00:00.000Z` },
    asOf: '2026-09-30T07:35:00.000Z', // 2:35 PM in Phnom Penh
  }
}

const item = (itemId: string, name: string, quantity: number, salesMinor: number, refundedMinor = 0): ItemSalesRow =>
  ({ itemId, name, categoryId: 'cat-2', categoryName: 'Coffee', quantity, salesMinor, refundedMinor })

function summaryOf(from = TODAY, to = TODAY, overrides: Partial<ReportSummary> = {}): ReportSummary {
  const oneDay = from === to
  return {
    ...context(from, to),
    paid: { salesMinor: 128_450, orders: 187, averageMinor: 687 },
    refunds: { amountMinor: 1400, orders: 2 },
    netSalesMinor: 127_050,
    previousPaidSalesMinor: 114_687,
    trend: oneDay
      ? { unit: 'hour', points: ['04', '05', '06', '07', '08', '09'].map((key, i) => ({ key, salesMinor: [0, 0, 0, 12_000, 25_000, 0][i]!, orders: 3 })) }
      : { unit: 'day', points: [{ key: from, salesMinor: 90_000, orders: 120 }, { key: to, salesMinor: 38_450, orders: 67 }] },
    payments: [
      { method: 'cash_usd', orders: 100, amountMinor: 70_210, amountKhr: null },
      { method: 'cash_khr', orders: 60, amountMinor: 40_240, amountKhr: 1_650_000 },
      { method: 'khqr', orders: 27, amountMinor: 18_000, amountKhr: null },
    ],
    bestSellers: [item('item-1', 'Iced Latte', 42, 18_900), item('item-2', 'Croissant', 31, 9_300)],
    cancelledUnpaid: { customer: 6, cafe: 3, system: 4 },
    ordersPlaced: 1204,
    current: oneDay && from === TODAY ? { awaitingPayment: 3, preparing: 5, ready: 2 } : null,
    ...overrides,
  }
}

const ITEMS = [item('item-1', 'Iced Latte', 42, 18_900), item('item-3', 'Matcha', 18, 8100, 450)]

function itemsOf(query: URLSearchParams): ItemSalesReport {
  return {
    ...context(query.get('from')!, query.get('to')!),
    items: ITEMS,
    page: 1,
    pageSize: 20,
    total: 2,
    totalPages: 1,
    totals: { items: 2, quantity: 60, salesMinor: 27_000, refundedMinor: 450 },
    categories: [{ id: 'cat-2', name: 'Coffee' }],
  }
}

const ORDERS: OrderHistoryRow[] = [
  { id: 'ord-1', pickupNumber: 42, businessDate: TODAY, placedAt: '2026-09-30T02:02:00.000Z', orderType: 'pickup', tableLabel: null, payment: { state: 'paid', method: 'khqr' }, status: 'completed', totalMinor: 650 },
  { id: 'ord-2', pickupNumber: 43, businessDate: TODAY, placedAt: '2026-09-30T02:10:00.000Z', orderType: 'dine_in', tableLabel: 'T4', payment: { state: 'unpaid', method: null }, status: 'awaiting_payment', totalMinor: 930 },
]

function historyOf(query: URLSearchParams): OrderHistory {
  return { ...context(query.get('from')!, query.get('to')!), orders: ORDERS, page: 1, pageSize: 20, total: 2, totalPages: 1 }
}

const DETAIL: OrderHistoryDetail = {
  id: 'ord-1',
  branch: { id: BRANCH.id, name: BRANCH.name, timeZone: BRANCH.timeZone },
  pickupNumber: 42,
  businessDate: TODAY,
  placedAt: '2026-09-30T02:02:00.000Z',
  orderType: 'pickup',
  tableLabel: null,
  customerFirstName: 'Sokha',
  status: 'completed',
  totalMinor: 650,
  lines: [{ itemName: 'Iced Latte', categoryName: 'Coffee', detail: 'Large', modifiers: [{ name: 'Oat milk', priceDeltaMinor: 50 }], unitPriceMinor: 650, quantity: 1, totalMinor: 650, note: 'Less sugar please' }],
  payment: { state: 'paid', method: 'khqr', amountMinor: 650, amountKhr: null, khrPerUsd: null, reference: '8812', collectedAt: '2026-09-30T02:04:00.000Z', collectedBy: 'Dara', returnMethod: null, returnedAt: null, returnedBy: null },
  timeline: [
    { at: '2026-09-30T02:02:00.000Z', fromStatus: null, toStatus: 'awaiting_payment', by: { kind: 'customer', name: 'Sokha' }, reason: null, note: null },
    { at: '2026-09-30T02:04:00.000Z', fromStatus: 'awaiting_payment', toStatus: 'preparing', by: { kind: 'staff', name: 'Dara' }, reason: null, note: null },
    { at: '2026-09-30T02:15:00.000Z', fromStatus: 'ready', toStatus: 'completed', by: { kind: 'staff', name: 'Vanna' }, reason: null, note: null },
  ],
}

const params = (u: URL) => u.searchParams

async function open(path: string, handlers: Record<string, MockHandler> = {}, width = 1440) {
  const requests: URLSearchParams[] = []
  const record = (build: (q: URLSearchParams) => unknown): MockHandler => ({ url: u }) => {
    requests.push(params(u))
    return build(params(u))
  }
  const page = await createPage()
  await page.setViewportSize({ width, height: 900 })
  const api = await mockApi(page, {
    'GET /admin/reports/branches': () => [BRANCH],
    'GET /admin/reports/summary': record(q => summaryOf(q.get('from')!, q.get('to')!)),
    'GET /admin/reports/items': record(itemsOf),
    'GET /admin/reports/orders': record(historyOf),
    'GET /admin/reports/orders/{id}': () => DETAIL,
    ...handlers,
  })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, requests, api }
}

const lastQuery = (requests: URLSearchParams[]) => Object.fromEntries(requests.at(-1)!.entries())

async function choosePreset(page: Page, name: string) {
  await page.getByRole('button', { name: /^Period:/ }).click()
  await page.getByRole('button', { name, exact: true }).click()
}

describe('Reports: Summary', () => {
  it('shows today in the branch\'s zone: sales, payments, current orders, best sellers, cancelled', async () => {
    const { page, requests } = await open('/admin/reports/summary')
    await page.getByText('$1,284.50').first().waitFor()
    expect(lastQuery(requests)).toEqual({ branchId: 'branch-1', from: TODAY, to: TODAY })
    await page.getByText('Riverside · Asia/Phnom_Penh · business day 4:00 AM – 4:00 AM · Updated 2:35 PM').waitFor()
    await page.getByText('+12%').waitFor()
    await page.getByText('vs yesterday').waitFor()
    await page.getByText('−$14.00').waitFor()
    await page.getByText('$1,270.50').waitFor()
    await page.getByText('៛1,650,000').waitFor()
    await page.getByRole('heading', { name: 'Current orders' }).waitFor()
    await page.getByRole('row', { name: /Iced Latte/ }).waitFor()
    await page.getByText('Expired unpaid').waitFor()
    // The hour chart is trimmed to the hours with sales (7 AM, 8 AM), as the screen-reader table says.
    expect(await page.locator('table.sr-only tbody tr').count()).toBe(2)
    expect(page.url()).toContain(`from=${TODAY}&to=${TODAY}`)
  })

  it('a preset changes the period in the URL, and the next report keeps it', async () => {
    const { page, requests } = await open('/admin/reports/summary')
    await page.getByText('$1,284.50').first().waitFor()
    await choosePreset(page, 'Last 7 days')
    await expect.poll(() => lastQuery(requests).from).toBe('2026-09-24')
    await page.getByRole('heading', { name: 'Paid sales by day' }).waitFor()
    await page.getByRole('heading', { name: 'Orders placed in this period' }).waitFor()
    expect(await page.getByRole('heading', { name: 'Current orders' }).count()).toBe(0)
    await page.getByText('vs the 7 days before').waitFor()

    // The sidebar's link has no dates: the period this tab last looked at is kept.
    await page.locator('a[href="/admin/reports/items"]').click()
    await page.waitForURL(/\/admin\/reports\/items/)
    await page.getByText('Iced Latte').first().waitFor()
    expect(lastQuery(requests)).toMatchObject({ from: '2026-09-24', to: TODAY })
    expect(await page.getByRole('button', { name: /^Period:/ }).textContent()).toContain('Last 7 days')
  })

  it('a period in the URL is used; one no report can show falls back to today', async () => {
    const { page, requests } = await open('/admin/reports/summary?from=2026-09-01&to=2026-09-30')
    await page.getByText('$1,284.50').first().waitFor()
    expect(lastQuery(requests)).toMatchObject({ from: '2026-09-01', to: TODAY })
    await page.goto(url('/admin/reports/summary?from=2026-01-01&to=2026-09-30'), { waitUntil: 'hydration' })
    await expect.poll(() => lastQuery(requests)).toMatchObject({ from: TODAY, to: TODAY })
  })

  it('an empty period says so; a failed load offers Try again', async () => {
    let fail = true
    const { page } = await open('/admin/reports/summary', {
      'GET /admin/reports/summary': ({ url: u }) => {
        if (fail) throw failures.server()
        return summaryOf(params(u).get('from')!, params(u).get('to')!, { paid: { salesMinor: 0, orders: 0, averageMinor: null }, bestSellers: [] })
      },
    })
    await page.getByText('Couldn\'t load the report').waitFor()
    fail = false
    await page.getByRole('button', { name: /Try again|Retry/ }).click()
    await page.getByText('No paid orders in this period.').waitFor()
    await page.getByText('Nothing sold in this period.').waitFor()
  })

  it('Download CSV saves the server\'s file with its byte-order mark and the page\'s period', async () => {
    const csvQueries: URLSearchParams[] = []
    const { page } = await open('/admin/reports/summary', {
      'GET /admin/reports/summary.csv': ({ url: u }) => {
        csvQueries.push(params(u))
        return '﻿Section,Measure\r\nSales,Paid sales\r\n'
      },
    })
    await page.getByText('$1,284.50').first().waitFor()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`riverside-${TODAY}-summary.csv`)
    const bytes = await readFile((await download.path())!)
    expect([...bytes.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
    expect(bytes.subarray(3).toString('utf8')).toBe('Section,Measure\r\nSales,Paid sales\r\n')
    expect(Object.fromEntries(csvQueries[0]!.entries())).toEqual({ branchId: 'branch-1', from: TODAY, to: TODAY })
    await toast(page, `Downloaded riverside-${TODAY}-summary.csv`).waitFor()
  })

  it('a refused download shows the server\'s reason', async () => {
    const { page } = await open('/admin/reports/orders', {
      'GET /admin/reports/orders.csv': () => {
        throw failures.validation('More than 20,000 orders match. Choose a shorter period or narrow the filters.')
      },
    })
    await page.getByRole('button', { name: 'Order #042' }).waitFor()
    await page.getByRole('button', { name: 'Download CSV' }).click()
    await toast(page, 'Could not download the CSV').waitFor()
    await page.getByText('More than 20,000 orders match.', { exact: false }).first().waitFor()
  })

  it('prints only the report, with its print header', async () => {
    const { page } = await open('/admin/reports/summary')
    await page.getByText('$1,284.50').first().waitFor()
    expect(await page.getByText('NUK Cafe · Riverside · Summary').isVisible()).toBe(false)
    await page.emulateMedia({ media: 'print' })
    await page.getByText('NUK Cafe · Riverside · Summary').waitFor()
    await page.getByText(/Printed .* by /).waitFor()
    expect(await page.getByRole('button', { name: 'Download CSV' }).isVisible()).toBe(false)
    expect(await page.getByRole('link', { name: 'Summary' }).isVisible()).toBe(false)
    await page.getByRole('heading', { name: 'How these are counted' }).waitFor()
  })

  it('is in the sidebar under Reports', async () => {
    const { page } = await open('/admin/reports')
    await page.waitForURL(/\/admin\/reports\/summary/)
    expect(await page.getByRole('link', { name: 'Order history' }).getAttribute('href')).toBe('/admin/reports/orders')
  })
})

describe('Reports: Sales by item', () => {
  it('sorts on the server by a column, filters by category, and shows the totals row', async () => {
    const { page, requests } = await open('/admin/reports/items')
    await page.getByText('Totals for 2 items').waitFor()
    await page.getByText('−$4.50').first().waitFor()
    await page.getByRole('button', { name: 'Sort by paid sales' }).click()
    await expect.poll(() => lastQuery(requests)).toMatchObject({ sort: 'sales', direction: 'desc' })
    await page.getByRole('button', { name: 'Paid sales, sorted descending' }).click()
    await expect.poll(() => lastQuery(requests)).toMatchObject({ sort: 'sales', direction: 'asc' })

    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.getByRole('option', { name: 'Coffee' }).click()
    await expect.poll(() => lastQuery(requests).categoryId).toBe('cat-2')
    expect(page.url()).toContain('categoryId=cat-2')
    await page.getByText('The CSV includes all matching items.', { exact: false }).waitFor()
  })
})

describe('Reports: Order history', () => {
  it('filters, then opens an order with its payment and timeline; Back closes it', async () => {
    const { page, requests } = await open('/admin/reports/orders')
    await page.getByRole('button', { name: 'Order #042' }).waitFor()
    await page.getByText('Paid · KHQR').waitFor()
    await page.getByText('Dine-in · T4').waitFor()

    await page.getByRole('combobox', { name: 'Payment' }).click()
    await page.getByRole('option', { name: 'Refunded' }).click()
    await expect.poll(() => lastQuery(requests).payment).toBe('refunded')

    await page.getByRole('button', { name: 'Order #042' }).click()
    const panel = page.getByRole('dialog')
    await panel.getByText('Pickup · Sokha').waitFor()
    await panel.getByText('Large · Oat milk +$0.50').waitFor()
    await panel.getByText('“Less sugar please”').waitFor()
    await panel.getByText('Reference 8812').waitFor()
    await panel.getByText('By Vanna').waitFor()
    await panel.getByText('By the customer').waitFor()
    expect(page.url()).toContain('order=ord-1')

    await page.goBack()
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    expect(page.url()).not.toContain('order=')
    expect(page.url()).toContain('payment=refunded')
  })

  it('`?order=` opens the order from a link; closing it keeps the list', async () => {
    const { page } = await open('/admin/reports/orders?order=ord-1')
    await page.getByRole('dialog').getByText('Reference 8812').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => page.url()).not.toContain('order=')
    await page.getByRole('button', { name: 'Order #042' }).waitFor()
  })

  it('ignores letters in the order number search', async () => {
    const { page, requests } = await open('/admin/reports/orders')
    await page.getByRole('button', { name: 'Order #042' }).waitFor()
    await page.getByPlaceholder('Order number').fill('#42')
    await expect.poll(() => lastQuery(requests).search).toBe('42')
  })

  it('on a phone: filters in a sheet applied together, shown as removable chips, the order full screen', async () => {
    const { page, requests } = await open('/admin/reports/orders', {}, 390)
    await page.getByRole('button', { name: 'Order #042' }).waitFor()
    const before = requests.length
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    await sheet.getByRole('combobox').nth(0).click()
    await page.getByRole('option', { name: 'Dine-in' }).click()
    await sheet.getByRole('combobox').nth(2).click()
    await page.getByRole('option', { name: 'Completed' }).click()
    // Nothing is asked for until Apply.
    expect(requests.length).toBe(before)
    await sheet.getByRole('button', { name: 'Apply filters' }).click()
    await expect.poll(() => lastQuery(requests)).toMatchObject({ type: 'dine_in', progress: 'completed' })
    await page.getByRole('button', { name: 'Filters (2)' }).waitFor()

    await page.getByRole('button', { name: 'Remove filter: Type' }).click()
    await expect.poll(() => lastQuery(requests).type).toBeUndefined()
    await page.getByRole('button', { name: 'Filters (1)' }).waitFor()

    await page.getByRole('button', { name: 'Actions' }).waitFor()
    await page.getByRole('button', { name: 'Order #042' }).click()
    const panel = page.getByRole('dialog')
    await panel.getByText('Reference 8812').waitFor()
    const box = await panel.boundingBox()
    expect(box?.width).toBeGreaterThan(370) // the whole width, less a scrollbar
  })
})
