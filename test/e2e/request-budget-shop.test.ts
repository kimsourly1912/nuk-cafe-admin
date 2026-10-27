import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { setupE2e } from './support/mock-api'
import { asNewVisitor } from './support/client-address'

// How many API requests the customer site makes from the browser while someone orders (the
// request-reduction plan, step 6), against the e2e server's seeded database. Server-rendered reads
// happen inside the server and aren't counted. A change that raises a number has to explain why.
await setupE2e()

const seed = inject('shopSeed')

/** Requests since `from`, counted by `METHOD path` (the cafe's `/api/c/nuk` prefix left out). */
function requestsSince(calls: string[], from: number) {
  const counts: Record<string, number> = {}
  for (const call of calls.slice(from)) counts[call] = (counts[call] ?? 0) + 1
  return counts
}

/** Waits until no API request has started for `quietMs`, so a step's background reads are all counted. */
async function settled(calls: string[], quietMs = 750) {
  let seen = -1
  while (seen !== calls.length) {
    seen = calls.length
    await new Promise(resolve => setTimeout(resolve, quietMs))
  }
}

async function open(path: string) {
  const page = await createPage()
  await asNewVisitor(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const calls: string[] = []
  page.on('request', (request) => {
    const address = new URL(request.url())
    if (!address.pathname.startsWith('/api/')) return
    calls.push(`${request.method()} ${address.pathname.replace(/^\/api(?:\/c\/[^/]+)?/, '')}`)
  })
  await page.goto(url(path), { waitUntil: 'hydration' })
  await settled(calls)
  return { page, calls }
}

const visible = (locator: ReturnType<Page['getByRole']>) => locator.filter({ visible: true })
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true })

async function clickLink(page: Page, name: string, path: (address: URL) => boolean) {
  await visible(page.getByRole('link', { name, exact: true })).first().click()
  await page.waitForURL(path)
}

describe('request budget: customer site', () => {
  it('a guest orders: menu, Review order, back, Review order, Place order, Your orders', async () => {
    const { page, calls } = await open('/c/nuk')
    const steps: Record<string, Record<string, number>> = { 'open the menu': requestsSince(calls, 0) }
    async function step(name: string, run: () => Promise<unknown>) {
      const from = calls.length
      await run()
      await settled(calls)
      steps[name] = requestsSince(calls, from)
    }

    await step('add Banana Bread', async () => {
      await heading(page, 'Coffee').waitFor()
      await visible(page.getByRole('article', { name: 'Banana Bread', exact: true }).getByRole('button', { name: 'Add Banana Bread to order' })).click()
    })
    await step('Review order', async () => {
      await clickLink(page, 'Review order', u => u.pathname === '/c/nuk/checkout')
      await heading(page, 'Review order').waitFor()
    })
    await step('back to the menu', async () => {
      await clickLink(page, 'Back to the menu', u => u.pathname === '/c/nuk')
      await heading(page, 'Coffee').waitFor()
    })
    await step('Review order again', async () => {
      await clickLink(page, 'Review order', u => u.pathname === '/c/nuk/checkout')
      await heading(page, 'Review order').waitFor()
    })
    await step('Place order', async () => {
      await page.getByLabel('Your name').fill('Budget Guest')
      await visible(page.getByRole('button', { name: /^Place order/ })).click()
      await page.waitForURL(u => u.pathname.startsWith('/c/nuk/orders/'))
      await page.getByText('Waiting for payment').waitFor()
    })
    await step('Your orders', async () => {
      await clickLink(page, 'Your orders', u => u.pathname === '/c/nuk/orders')
    })
    await step('back to the menu from Your orders', async () => {
      await page.getByRole('banner').getByRole('link', { name: 'NUK Cafe', exact: true }).click() // the cafe's name: back to the menu
      await page.waitForURL(u => u.pathname === '/c/nuk')
      await heading(page, 'Coffee').waitFor()
    })
    console.info('[request-budget] shop guest', JSON.stringify(steps, null, 2))

    const orderId = Object.keys(steps['Place order']!).find(call => /^GET \/shop\/orders\/[^/]+$/.test(call))!.split('/').pop()
    expect(steps).toEqual({
      // The menu and branches come rendered with the page; Better Auth's client and the account
      // header each read the session.
      'open the menu': { 'GET /auth/get-session': 2 },
      'add Banana Bread': {},
      // Each visit quotes the order again: prices and stock are checked on the server.
      'Review order': { 'POST /public/checkout/quote': 1 },
      // The menu and branches are kept between visits (D173).
      'back to the menu': {},
      'Review order again': { 'POST /public/checkout/quote': 1 },
      'Place order': {
        'POST /auth/sign-in/anonymous': 1,
        'GET /auth/get-session': 1,
        'GET /shop/me': 1,
        'POST /shop/orders': 1,
        [`GET /shop/orders/${orderId}`]: 1,
        [`GET /shop/orders/${orderId}/telegram`]: 1,
      },
      'Your orders': { 'GET /shop/orders': 1 },
      'back to the menu from Your orders': {},
    })
  }, 90_000)

  it('a signed-in customer: sign in, the menu, Your orders, back, Review order, back', async () => {
    // From the cafe's menu, as customers arrive (D221: the account pages name no cafe of their own).
    const { page, calls } = await open('/sign-in?redirect=/c/nuk')
    const customer = seed.customers.budgetShopper
    const steps: Record<string, Record<string, number>> = {}
    async function step(name: string, run: () => Promise<unknown>) {
      const from = calls.length
      await run()
      await settled(calls)
      steps[name] = requestsSince(calls, from)
    }
    await step('sign in, to the menu', async () => {
      await page.getByLabel('Email').fill(customer.email)
      await page.getByLabel('Password', { exact: true }).fill(customer.password)
      await visible(page.getByRole('button', { name: 'Sign in', exact: true })).click()
      await page.waitForURL(u => u.pathname === '/c/nuk')
      await heading(page, 'Coffee').waitFor()
    })
    await step('Your orders', async () => {
      await visible(page.getByRole('button', { name: `NP, account: ${customer.name}` })).click()
      await clickLink(page, 'Your orders', u => u.pathname === '/c/nuk/orders')
    })
    await step('back to the menu', async () => {
      await page.getByRole('banner').getByRole('link', { name: 'NUK Cafe', exact: true }).click()
      await page.waitForURL(u => u.pathname === '/c/nuk')
      await heading(page, 'Coffee').waitFor()
    })
    await step('Review order (a full page load)', async () => {
      await page.goto(url('/c/nuk/checkout'), { waitUntil: 'hydration' })
      await heading(page, 'Review order').waitFor()
    })
    await step('back to the menu again', async () => {
      await clickLink(page, 'Back to the menu', u => u.pathname === '/c/nuk')
      await heading(page, 'Coffee').waitFor()
    })
    console.info('[request-budget] shop signed in', JSON.stringify(steps, null, 2))
    expect(steps).toEqual({
      // Signing in leaves the server-rendered sign-in page: the menu loads in the browser. Two
      // sessions: the sign-in page's own (Better Auth's, no cafe, D221) and the menu's account.
      'sign in, to the menu': {
        'POST /auth/sign-in/email': 1,
        'GET /auth/get-session': 2,
        'GET /shop/me': 1,
        'GET /public/branches': 1,
        'GET /public/menu': 1,
        'GET /shop/orders': 1,
      },
      'Your orders': {},
      'back to the menu': {},
      // A full load starts from nothing: the session (Better Auth, the account and the sign-in
      // check), the cafe and the branches again.
      'Review order (a full page load)': { 'GET /auth/get-session': 3, 'GET /cafes/nuk': 1, 'GET /public/branches': 1, 'GET /shop/me': 1 },
      'back to the menu again': { 'GET /public/menu': 1, 'GET /shop/orders': 1 },
    })
  }, 90_000)
})
