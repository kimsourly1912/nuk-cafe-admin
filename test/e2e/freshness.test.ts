import type { BrowserContext, Page } from 'playwright-core'
import { createPage, getBrowser, url, waitForHydration } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockApi } from './support/mock-api'
import { mockApi, setupE2e } from './support/mock-api'

// plugins/data-freshness.client.ts and components/OfflineBanner.vue.
// Cases: docs/reference/app-behavior.md → "Data freshness".
await setupE2e()

const listLoads = (api: MockApi) => api.calls.filter(c => c === 'GET /staff/categories').length

/** Tabs opened in the same context share a BroadcastChannel, like tabs of one browser window. */
const newContext = async () => (await getBrowser()).newContext()

async function openTab(path = '/categories', context?: BrowserContext) {
  const page = context ? await context.newPage() : await createPage()
  await page.clock.install()
  const api = await mockApi(page)
  // Raw context pages lack test-utils' `waitUntil: 'hydration'` wrapper.
  await page.goto(url(path))
  await waitForHydration(page, url(path), 'hydration')
  if (path === '/categories') await page.getByRole('cell', { name: 'Tea' }).waitFor()
  return { page, api }
}

/** Headless Chrome never hides the tab; fake the Page Visibility API. */
function setVisibility(page: Page, state: 'hidden' | 'visible') {
  return page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

async function createCategory(page: Page, name: string) {
  await page.getByRole('button', { name: 'New category' }).first().click()
  await page.getByRole('dialog', { name: 'New category' }).locator('input').first().fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('dialog', { name: 'New category' }).waitFor({ state: 'hidden' })
}

describe('data freshness: other tabs of this browser', () => {
  it('a save in tab 1 refreshes the same list in tab 2 at once, without switching tabs', async () => {
    const context = await newContext()
    const tab1 = await openTab('/categories', context)
    const tab2 = await openTab('/categories', context)
    const before = listLoads(tab2.api)

    await createCategory(tab1.page, 'Latte')
    await expect.poll(() => listLoads(tab2.api)).toBe(before + 1)
  })

  it('a tab showing another page does nothing (it loads fresh when opened)', async () => {
    const context = await newContext()
    const tab1 = await openTab('/categories', context)
    const tab2 = await openTab('/', context)
    await createCategory(tab1.page, 'Latte')
    await tab1.page.waitForTimeout(500)
    expect(listLoads(tab2.api)).toBe(0)
  })

  it('the tab that saved refreshes once, and does not echo messages back', async () => {
    const context = await newContext()
    const tab1 = await openTab('/categories', context)
    const tab2 = await openTab('/categories', context)
    const before1 = listLoads(tab1.api)
    const before2 = listLoads(tab2.api)
    await createCategory(tab1.page, 'Latte')
    await expect.poll(() => listLoads(tab2.api)).toBe(before2 + 1)
    await tab1.page.waitForTimeout(500)
    expect(listLoads(tab1.api)).toBe(before1 + 1)
    expect(listLoads(tab2.api)).toBe(before2 + 1)
  })
})

describe('data freshness: returning to the tab', () => {
  it('refetches data older than 5s', async () => {
    const { page, api } = await openTab()
    const before = listLoads(api)
    await setVisibility(page, 'hidden')
    await page.clock.fastForward(6_000)
    await setVisibility(page, 'visible')
    await expect.poll(() => listLoads(api)).toBe(before + 1)
  })

  it('does not refetch data loaded less than 5s ago', async () => {
    const { page, api } = await openTab()
    const before = listLoads(api)
    await setVisibility(page, 'hidden')
    await page.clock.fastForward(2_000)
    await setVisibility(page, 'visible')
    await page.waitForTimeout(300)
    expect(listLoads(api)).toBe(before)
  })
})

describe('data freshness: connection', () => {
  it('shows an offline banner, and refetches when the connection is back', async () => {
    const { page, api } = await openTab()
    const before = listLoads(api)
    await page.context().setOffline(true)
    await page.getByText('You\'re offline').waitFor()
    await page.context().setOffline(false)
    await page.getByText('You\'re offline').waitFor({ state: 'hidden' })
    await expect.poll(() => listLoads(api)).toBe(before + 1)
  })
})
