import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { setupE2e } from './support/mock-api'

await setupE2e()

// A promotion as customers see it (M1, D163), on the real server: Brown Bean's seeded "Bean week"
// (20% off the whole menu, all year), so its Latte is $2.40 instead of $3.00. No mocks.

const cafe = inject('shopSeed').secondCafe

async function open(width = 1440) {
  const page = await createPage()
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration/i.test(message.text())) problems.push(message.text())
  })
  await page.setViewportSize({ width, height: width < 640 ? 844 : 900 })
  await page.goto(url(`/c/${cafe.slug}`), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Beans', exact: true }).waitFor()
  return { page, problems }
}

const card = (page: Page) => page.getByRole('article', { name: cafe.itemName, exact: true })

describe('promotions on the customer menu', () => {
  it('shows the offer, the badge and the lower price with the old one struck through, rendered on the server', async () => {
    const { page, problems } = await open()
    const offers = page.getByRole('region', { name: 'Offers' })
    await offers.getByRole('button', { name: 'Bean week' }).waitFor()
    expect(await offers.textContent()).toContain('20% off')
    expect(await offers.textContent()).toContain('Every drink 20% off.')

    const latte = card(page)
    expect(await latte.getByText('20% off').count()).toBeGreaterThan(0)
    expect(await latte.getByText('$2.40').filter({ visible: true }).count()).toBe(1)
    expect(await latte.locator('s').filter({ visible: true }).textContent()).toContain('$3.00')
    expect(problems).toEqual([])
  })

  it('opens an offer with its items by category; the item, the order and Review order show the saving', async () => {
    const { page } = await open()
    await page.getByRole('region', { name: 'Offers' }).getByRole('button', { name: 'Bean week' }).click()
    const offer = page.getByRole('dialog', { name: 'Bean week' })
    const beans = offer.getByRole('region', { name: 'Beans' })
    await beans.getByRole('list', { name: 'Beans in Bean week' }).getByRole('button', { name: new RegExp(cafe.itemName) }).click()
    const detail = page.getByRole('dialog', { name: cafe.itemName })
    await detail.getByText('Bean week').waitFor()
    expect(await detail.locator('s').textContent()).toContain('$3.00')
    await detail.getByRole('button', { name: /Add to order · \$2\.40/ }).click()
    await detail.waitFor({ state: 'hidden' })

    const order = page.getByRole('complementary', { name: 'Your order' })
    await order.getByText('You save').waitFor()
    expect(await order.textContent()).toContain('$0.60')

    await order.getByRole('link', { name: 'Review order' }).click()
    await page.waitForURL(/\/checkout$/)
    await page.getByText('Promotions saved you').waitFor()
    expect(await page.getByText('20% off · Bean week').first().isVisible()).toBe(true)
  })

  it('fits a phone: the offers scroll sideways inside their row, the page doesn\'t', async () => {
    const { page } = await open(390)
    await page.getByRole('region', { name: 'Offers' }).getByRole('button', { name: 'Bean week' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
