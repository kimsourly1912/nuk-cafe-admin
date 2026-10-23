import { createPage, url } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { BranchSettings } from '../../shared/contracts/branches'
import type { ReportBranch, ReportSummary } from '../../shared/contracts/reports'
import type { MockHandler } from './support/mock-api'
import { ADMIN, failures, menuItemSummaryOf, mockApi, pageOf, RIVERSIDE, setupE2e, staffOf } from './support/mock-api'

await setupE2e()

// The admin's home (D155): today in each branch, "Set up your cafe", shortcuts. Mocked API; the
// harness's defaults are a new cafe with nothing set up.

const TODAY = '2026-10-10'
const BRANCH: ReportBranch = { id: RIVERSIDE.id, name: 'Riverside', timeZone: 'Asia/Phnom_Penh', today: TODAY }

const summary = (branch: ReportBranch, overrides: Partial<ReportSummary> = {}): ReportSummary => ({
  branch: { id: branch.id, name: branch.name, timeZone: branch.timeZone },
  period: { from: TODAY, to: TODAY, start: '2026-10-09T21:00:00.000Z', end: '2026-10-10T21:00:00.000Z' },
  asOf: '2026-10-10T03:00:00.000Z',
  paid: { salesMinor: 12_050, orders: 25, averageMinor: 482 },
  refunds: { amountMinor: 0, orders: 0 },
  netSalesMinor: 12_050,
  previousPaidSalesMinor: 10_000,
  trend: { unit: 'hour', points: [] },
  payments: [],
  bestSellers: [],
  cancelledUnpaid: { customer: 0, cafe: 0, system: 0 },
  ordersPlaced: 30,
  current: { awaitingPayment: 2, preparing: 1, ready: 2 },
  ...overrides,
})

const settings = (hours: BranchSettings['hours']): BranchSettings => ({
  id: RIVERSIDE.id,
  name: RIVERSIDE.name,
  timezone: 'Asia/Phnom_Penh',
  address: null,
  phone: null,
  status: 'active',
  hours,
  openNow: true,
  today: 6,
  pause: { branchId: RIVERSIDE.id, pausedUntil: null, reason: null, pausedByName: null },
  version: 1,
})

/** A cafe that takes orders: hours, a published item, the riel rate; KHQR, staff and a logo left. */
const RUNNING: Record<string, MockHandler> = {
  'GET /admin/reports/branches': () => [BRANCH],
  'GET /admin/reports/summary': () => summary(BRANCH),
  'GET /admin/branches/options': () => [RIVERSIDE],
  'GET /admin/branches/{id}': () => settings([{ weekday: 1, startMinute: 420, endMinute: 1260 }]),
  'GET /admin/menu/items': () => pageOf([menuItemSummaryOf('item-1', 'Latte', { status: 'active' })]),
  'GET /admin/exchange-rates': () => ({ current: { khrPerUsd: 4100, effectiveFrom: '2026-10-01T00:00:00.000Z', setBy: { name: 'Alice' } }, history: [] }),
  'GET /admin/staff': () => pageOf([staffOf(ADMIN.userId, 'alice')]),
}

async function open(handlers: Record<string, MockHandler> = {}, width = 1440) {
  const page = await createPage()
  await page.setViewportSize({ width, height: 900 })
  const api = await mockApi(page, handlers)
  await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
  return { page, api }
}

const checklist = (page: Page) => page.getByRole('region', { name: 'Set up your cafe' })
const stepRow = (page: Page, label: string) => checklist(page).getByRole('listitem').filter({ hasText: label })

describe('dashboard', () => {
  it('a new cafe sees what to do, required steps first, each opening its page; nothing to hide yet', async () => {
    const { page } = await open()
    await checklist(page).waitFor()
    await checklist(page).getByText('0 of 7 done').waitFor()
    const rows = checklist(page).getByRole('listitem')
    expect(await rows.nth(0).textContent()).toContain('Set your opening hours')
    expect(await rows.nth(1).textContent()).toContain('Publish your first menu item')
    expect(await stepRow(page, 'Set your opening hours').getByRole('link', { name: 'Open: Set your opening hours' }).getAttribute('href')).toBe('/c/nuk/admin/branches')
    // Photos (D160): the published items without one, from the step.
    expect(await stepRow(page, 'Add a photo to each published item').getByRole('link').getAttribute('href')).toBe('/c/nuk/admin/products?status=active&photo=missing')
    // Telegram isn't set up on this server: not offered.
    expect(await stepRow(page, 'Telegram').count()).toBe(0)
    expect(await checklist(page).getByRole('button', { name: 'Hide' }).count()).toBe(0)
    // No branch to report on yet.
    expect(await page.getByRole('heading', { name: /^Today/ }).count()).toBe(0)
  })

  it('a running cafe sees today: paid sales against yesterday, orders, waiting and in progress, with links', async () => {
    const { page } = await open(RUNNING)
    const today = page.getByRole('region', { name: 'Today' })
    await today.getByText('$120.50').waitFor()
    await today.getByText('+21%').waitFor()
    await today.getByText('30', { exact: true }).waitFor()
    expect(await today.getByText('Waiting for payment').locator('..').getByText('2', { exact: true }).count()).toBe(1)
    expect(await today.getByText('Preparing or ready').locator('..').getByText('3', { exact: true }).count()).toBe(1)
    expect(await today.getByRole('link', { name: 'Summary' }).getAttribute('href')).toBe(`/c/nuk/admin/reports/summary?branch=${BRANCH.id}&from=${TODAY}&to=${TODAY}`)
    expect(await today.getByRole('link', { name: 'Counter' }).getAttribute('href')).toBe(`/c/nuk/counter/${BRANCH.id}`)
  })

  it('only optional steps left: they come after today and can be hidden, for good on this browser', async () => {
    const { page } = await open(RUNNING)
    await checklist(page).getByText('3 of 7 done').waitFor()
    await checklist(page).getByRole('button', { name: 'Hide' }).click()
    await expect.poll(() => checklist(page).count()).toBe(0)
    await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
    await page.getByRole('region', { name: 'Today' }).getByText('$120.50').waitFor()
    expect(await checklist(page).count()).toBe(0)
  })

  it('a check that fails says so; the others still answer', async () => {
    const { page } = await open({
      ...RUNNING,
      'GET /admin/menu/items': () => {
        throw failures.server()
      },
    })
    await stepRow(page, 'Publish your first menu item').getByText('Couldn\'t check this one. Open it to see.').waitFor()
    await stepRow(page, 'Set your opening hours').getByText('Done:', { exact: false }).waitFor()
  })

  it('several branches: today for each, by name', async () => {
    const other: ReportBranch = { ...BRANCH, id: 'branch-2', name: 'Airport' }
    const { page } = await open({
      ...RUNNING,
      'GET /admin/reports/branches': () => [BRANCH, other],
      'GET /admin/reports/summary': ({ url: request }) => summary(request.searchParams.get('branchId') === other.id ? other : BRANCH),
    })
    await page.getByRole('heading', { name: 'Today at Riverside' }).waitFor()
    await page.getByRole('heading', { name: 'Today at Airport' }).waitFor()
  })

  it('fits a phone without scrolling sideways', async () => {
    const { page } = await open(RUNNING, 390)
    await page.getByRole('region', { name: 'Today' }).getByText('$120.50').waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
