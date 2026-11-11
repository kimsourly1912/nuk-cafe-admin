import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContextOptions, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { allowBrowserProblems } from './support/browser-problems'
import { setupE2e } from './support/mock-api'

// Explore's real branches (D275 step E4, docs/plans/explore.md → Districts and gateways) on the
// built server: Tuk Trail's two published branches, the nearby list, the menu handoff and Back to
// café, and a tuk-tuk through the gateway, including a district that fails to load. Software WebGL
// is slow in CI, so the waits are long; nothing here measures speed. `EXPLORE_SCREENSHOTS=1` keeps
// screenshots in output/playwright/explore.

const pages: Page[] = []
afterEach(async () => {
  await Promise.all(pages.splice(0).map(page => page.context().close()))
})
await setupE2e()

const seed = inject('shopSeed')
const trail = seed.exploreTrail
const output = join(process.cwd(), 'output', 'playwright', 'explore')
/** Near Old Market, in Phnom Penh: both branches are within 5 km. */
const NEAR_OLD_MARKET = { latitude: 11.5700, longitude: 104.9220 }

async function createExplorePage(options?: BrowserContextOptions) {
  const page = await createPage(undefined, options)
  pages.push(page)
  page.setDefaultTimeout(60_000)
  return page
}

async function shot(page: Page, name: string) {
  if (!process.env.EXPLORE_SCREENSHOTS) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, `${name}.png`) })
}

/** Two of Old Market's items in this browser's order, before the page's own scripts run. */
async function withOldMarketOrder(page: Page) {
  await page.addInitScript((marketId) => {
    if (localStorage.getItem('nuk-cafe:cart')) return
    localStorage.setItem('nuk-cafe:cart', JSON.stringify({ [marketId]: [{ key: 'v1', itemId: 'item-1', variationId: 'v1', modifierIds: [], quantity: 2, name: 'Trail Iced Coffee' }] }))
  }, trail.marketId)
}

function storedOrders(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('nuk-cafe:cart') ?? '{}') as Record<string, { quantity: number }[]>)
}

describe('Explore with real branches', () => {
  it('lists nearby branches, opens the right menu and comes back to the café\'s counter', { timeout: 240_000 }, async () => {
    const page = await createExplorePage({ geolocation: NEAR_OLD_MARKET, permissions: ['geolocation'] })
    await page.setViewportSize({ width: 1280, height: 860 })
    await withOldMarketOrder(page)
    await page.goto(url(`/c/${trail.slug}/explore`))
    await page.getByText('Street', { exact: true }).waitFor()
    // The first branch by name, with its own order on the HUD.
    await page.getByText('Old Market · 2 items').waitFor()

    await page.keyboard.press('m')
    const map = page.getByRole('dialog', { name: 'Map' })
    await map.waitFor()
    await map.getByRole('button', { name: 'Explore nearby' }).click()
    await map.getByText('Within 5 km').waitFor()
    await expect(map.getByText(/from you/).count()).resolves.toBe(2)
    await map.getByText('You\'re here').waitFor()
    await expect(map.getByText(/by tuk-tuk in Explore/).count()).resolves.toBe(1)
    await map.getByRole('tab', { name: 'All branches' }).click()
    await map.getByRole('img', { name: 'Map of the cafe\'s 2 branches in Explore' }).waitFor()
    await page.waitForTimeout(400)
    await shot(page, 'branches-overview')

    await map.getByRole('button', { name: 'Set waypoint: Riverwalk' }).click()
    await map.waitFor({ state: 'hidden' })
    await page.getByText('Waypoint: Riverwalk').waitFor()

    // The menu with Riverwalk chosen; Old Market's order stays Old Market's.
    await page.keyboard.press('m')
    await map.getByRole('button', { name: 'View menu: Riverwalk' }).click()
    await page.waitForURL(address => address.pathname === `/c/${trail.slug}` && address.searchParams.get('explore') === trail.riverId)
    await page.getByText(trail.itemName).first().waitFor()
    // The header names the branch (its full name on wide screens carries it as the title).
    await page.getByTitle('Riverwalk', { exact: true }).waitFor()
    const orders = await storedOrders(page)
    expect(orders[trail.marketId]?.[0]?.quantity).toBe(2)
    expect(orders[trail.riverId] ?? []).toEqual([])

    // Back to café: Riverwalk's counter, where View drinks opens its menu again.
    await page.getByRole('link', { name: 'Back to café' }).click()
    await page.waitForURL(address => address.pathname === `/c/${trail.slug}/explore` && address.searchParams.get('at') === trail.riverId)
    await page.getByText('Riverwalk · Ground').waitFor()
    await page.getByRole('button', { name: 'View drinks' }).waitFor()
    await shot(page, 'back-at-counter')
    await page.keyboard.press('e')
    await page.waitForURL(address => address.pathname === `/c/${trail.slug}` && address.searchParams.get('explore') === trail.riverId)
  })

  it('rides through the gateway, held while the next street fails to load, then arrives at its curb', { timeout: 240_000 }, async () => {
    const page = await createExplorePage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    const layout = `**/api/c/${trail.slug}/public/explore/branches/${trail.riverId}`
    allowBrowserProblems(new RegExp(`GET /api/c/${trail.slug}/public/explore/branches/${trail.riverId} → 503`))
    await page.route(layout, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }))
    await page.goto(url(`/c/${trail.slug}/explore?at=${trail.marketId}`))
    await page.getByText('Street', { exact: true }).waitFor()
    const action = (name: string) => page.getByRole('button', { name })

    // No location: the list goes by name, without distances; Ride here still works.
    await page.getByRole('button', { name: 'Open the map' }).first().click()
    const map = page.getByRole('dialog', { name: 'Map' })
    await map.getByRole('button', { name: 'Explore nearby' }).click()
    await map.getByText(/listed by name/).waitFor()
    await expect(map.getByText(/from you/).count()).resolves.toBe(0)
    await map.getByRole('button', { name: 'Ride here: Riverwalk' }).click()
    await map.waitFor({ state: 'hidden' })
    await page.getByText('To Riverwalk', { exact: true }).waitFor({ timeout: 60_000 })

    // Back and right, around the rear of the tuk-tuk and onto the pickup curb (as in E2's test).
    await page.keyboard.down('s')
    try {
      await page.keyboard.down('d')
      await action('Open passenger door').waitFor({ timeout: 35_000 })
    }
    finally {
      await page.keyboard.up('d')
      await page.keyboard.up('s')
    }
    await action('Open passenger door').click()
    await action('Get in').click()
    await action('Skip ride').click()
    await page.getByText('Can\'t reach Riverwalk right now', { exact: true }).waitFor()
    await shot(page, 'ride-held')
    // Held before the gateway: nothing moved districts, and Exit is offered with Retry.
    await action('Exit').waitFor()

    await page.unroute(layout)
    await action('Retry').click()
    // Retry rides the next street's leg; skip it too.
    await action('Skip ride').click()
    await page.getByText('Arrived · Riverwalk', { exact: true }).waitFor()
    await action('Exit').click()
    await page.getByText('Waypoint: Riverwalk').waitFor()
    await shot(page, 'ride-arrived')
    await action('View menu').click()
    await page.waitForURL(address => address.pathname === `/c/${trail.slug}` && address.searchParams.get('explore') === trail.riverId)
  })

  it('says when no branch is in Explore, and the menu stays one tap away', { timeout: 120_000 }, async () => {
    const page = await createExplorePage()
    await page.goto(url(`/c/${seed.secondCafe.slug}/explore`))
    await page.getByText('Street', { exact: true }).waitFor()
    await page.getByText('No branch is in Explore yet, so this is a demo street.').waitFor()
    await page.getByRole('button', { name: 'View menu' }).click()
    await page.waitForURL(address => address.pathname === `/c/${seed.secondCafe.slug}`)
    // The menu opened normally offers no way back into a café.
    await expect(page.getByRole('link', { name: 'Back to café' }).count()).resolves.toBe(0)
  })
})
