import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { mockApi, setupE2e } from './support/mock-api'

// plugins/data-freshness.client.ts and components/OfflineBanner.vue
await setupE2e()

async function openCategories() {
  const page = await createPage()
  await page.clock.install()
  const api = await mockApi(page)
  await page.goto(url('/categories'), { waitUntil: 'hydration' })
  await page.getByRole('cell', { name: 'Tea' }).waitFor()
  const listLoads = () => api.calls.filter(c => c === 'GET /staff/categories').length
  return { page, listLoads }
}

/** Headless Chrome never hides the tab; fake the Page Visibility API. */
function setVisibility(page: Page, state: 'hidden' | 'visible') {
  return page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

describe('data freshness', () => {
  it('refetches lists when the user comes back after 30s away', async () => {
    const { page, listLoads } = await openCategories()
    const before = listLoads()
    await setVisibility(page, 'hidden')
    await page.clock.fastForward(31_000)
    await setVisibility(page, 'visible')
    await expect.poll(listLoads).toBe(before + 1)
  })

  it('does not refetch on a quick tab switch', async () => {
    const { page, listLoads } = await openCategories()
    const before = listLoads()
    await setVisibility(page, 'hidden')
    await page.clock.fastForward(5_000)
    await setVisibility(page, 'visible')
    await page.waitForTimeout(300)
    expect(listLoads()).toBe(before)
  })

  it('shows an offline banner, and refetches when the connection is back', async () => {
    const { page, listLoads } = await openCategories()
    const before = listLoads()
    await page.context().setOffline(true)
    await page.getByText('You\'re offline').waitFor()
    await page.context().setOffline(false)
    await page.getByText('You\'re offline').waitFor({ state: 'hidden' })
    await expect.poll(listLoads).toBe(before + 1)
  })
})
