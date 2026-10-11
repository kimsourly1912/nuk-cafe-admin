import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { asNewVisitor } from './support/client-address'
import { e2eDatabase } from './support/database'
import { setupE2e, toast } from './support/mock-api'

await setupE2e()

// A channel post's Order now link (M2a, D164) on the real server: `?promo=` opens the offer,
// `?src=telegram` is remembered and the order placed next says it came from Telegram. No mocks.

const seed = inject('shopSeed')

async function open(path: string) {
  const page = await createPage()
  await asNewVisitor(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return page
}

const visible = (locator: ReturnType<Page['getByRole']>) => locator.filter({ visible: true })
const storedSource = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('nuk-cafe:order-source') ?? 'null') as { slug: string, source: string } | null)

async function sourceOf(orderId: string) {
  const client = e2eDatabase(seed.dbFile)
  try {
    const result = await client.execute({ sql: 'select source from orders where id = ?', args: [orderId] })
    return result.rows[0]?.source ?? null
  }
  finally {
    client.close()
  }
}

describe('a channel post\'s link', () => {
  it('opens the offer, remembers the channel and leaves the address clean', async () => {
    const cafe = seed.secondCafe
    const page = await open(`/c/${cafe.slug}?promo=${cafe.promotionId}&src=telegram`)
    await page.getByRole('dialog', { name: 'Bean week' }).waitFor()
    await page.waitForURL(u => !u.search)
    expect(await storedSource(page)).toMatchObject({ slug: cafe.slug, source: 'telegram' })
  })

  it('says when the offer has ended, and ignores an unknown source', async () => {
    const page = await open(`/c/${seed.secondCafe.slug}?promo=promo-ended&src=instagram`)
    await toast(page, 'This offer isn\'t on right now').waitFor()
    expect(await storedSource(page)).toBeNull()
  })

  it('marks the order placed next as from Telegram', async () => {
    const page = await open('/c/nuk?src=telegram')
    await page.waitForURL(u => !u.search)
    await page.getByRole('heading', { name: 'Coffee', exact: true }).waitFor()
    const card = page.getByRole('article', { name: 'Banana Bread', exact: true })
    await visible(card.getByRole('button', { name: 'Add Banana Bread to order' })).click()
    await page.getByRole('complementary', { name: 'Your order' }).getByRole('link', { name: 'Review order' }).click()
    await page.waitForURL(u => u.pathname === '/c/nuk/checkout')
    await page.getByLabel('Your name').fill('Dara')
    await visible(page.getByRole('button', { name: /^Place order/ })).click()
    await page.waitForURL(u => u.pathname.startsWith('/c/nuk/orders/'))
    const orderId = new URL(page.url()).pathname.split('/').pop()!
    expect(await sourceOf(orderId)).toBe('telegram')
    // Used once: the next order isn't counted again.
    expect(await storedSource(page)).toBeNull()
  })
})
