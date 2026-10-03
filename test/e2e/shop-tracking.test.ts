import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote, Order } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import type { SeedCustomer } from './support/seed'
import { setupE2e } from './support/mock-api'
import { asNewVisitor, clientHeaders } from './support/client-address'

await setupE2e()

// Order tracking (step 6.5b, D114) against the e2e server's seeded database (support/seed.ts): the
// customer's order page follows the counter (paid, ready, picked up) by polling, the customer
// cancels while unpaid (and loses a race to a payment), Order again refills the order, Your orders
// lists them and the menu shows the bar. Orders are placed and moved over the real API; each test
// uses its own seeded customer (`followerA`–`followerC`).

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin
/** The page reads again every 10 s while an order is in progress. */
const POLL = { timeout: 20_000 }
const PREPARING = 'We\'re making your order. We\'ll show it here when it\'s ready.'

/** Signs in through Better Auth over HTTP; returns the session cookie. */
async function apiSignIn(account: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(account) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

const send = (path: string, cookie: string, body: unknown) =>
  fetch(url(path), { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) })

/** Two Banana Breads at Riverside, with a note, placed as `customer`. */
async function placeOrder(customer: SeedCustomer) {
  const cookie = await apiSignIn(customer)
  const menu = await (await fetch(url(`/api/c/nuk/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
  const bread = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.name === 'Banana Bread')!
  const lines = [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 2, note: 'Warm please' }]
  const quote = await (await fetch(url('/api/c/nuk/public/checkout/quote'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ branchId: seed.openBranchId, lines }) })).json() as CheckoutQuote
  const response = await send('/api/c/nuk/shop/orders', cookie, { branchId: seed.openBranchId, lines, expectedTotalMinor: quote.totalMinor })
  expect(response.status).toBe(201)
  return await response.json() as Order
}

/** The cashier moves an order along: pay (cash), ready, complete. */
async function counter(order: Order, action: 'pay' | 'ready' | 'complete', version: number) {
  const cashier = await apiSignIn(seed.customers.cashier)
  const body = action === 'pay' ? { version, method: 'cash_usd' } : { version }
  const response = await send(`/api/c/nuk/counter/${seed.openBranchId}/orders/${order.id}/${action}`, cashier, body)
  expect(response.status).toBe(200)
}

const number = (order: Order) => String(order.pickupNumber).padStart(3, '0')
const visible = (locator: ReturnType<Page['getByRole']>) => locator.filter({ visible: true })
const button = (page: Page, name: string) => visible(page.getByRole('button', { name, exact: true }))

/** A page signed in as `customer` (through the sign-in page), at `path`. */
async function signedIn(customer: SeedCustomer, path: string, width = 1440) {
  const page = await createPage()
  await asNewVisitor(page)
  const problems: string[] = []
  page.on('pageerror', error => problems.push(error.message))
  await page.setViewportSize({ width, height: width < 640 ? 844 : 900 })
  await page.goto(url(`/sign-in?redirect=${encodeURIComponent(path)}`), { waitUntil: 'hydration' })
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Password', { exact: true }).fill(customer.password)
  await button(page, 'Sign in').click()
  await page.waitForURL(u => u.pathname === path.split('?')[0])
  return { page, problems }
}

describe('following an order', () => {
  // Three real 10-second polls: longer than the default 30 s.
  it('shows waiting for payment with the time to pay, then follows the counter to picked up; Order again refills the order', { timeout: 90_000 }, async () => {
    const order = await placeOrder(seed.customers.followerA)
    const { page, problems } = await signedIn(seed.customers.followerA, `/orders/${order.id}`)

    await page.getByRole('heading', { name: `Your number ${number(order)}` }).waitFor()
    await expect.poll(() => page.getByText('Waiting for payment', { exact: true }).isVisible()).toBe(true)
    await expect.poll(() => page.getByText(/^Pay at the counter by \d{1,2}:\d{2} [AP]M$/).isVisible()).toBe(true)
    await expect.poll(() => page.getByText(/^(29|30) min left/).isVisible()).toBe(true)
    await expect.poll(() => page.getByText('“Warm please”').isVisible()).toBe(true)
    expect(await button(page, 'Cancel order').isVisible()).toBe(true)

    await counter(order, 'pay', 1)
    // The status line, not the tracker's "Preparing" label (shown from the start).
    await expect.poll(() => page.getByText(PREPARING).isVisible(), POLL).toBe(true)
    await expect.poll(() => page.getByText(/Paid \$\d+\.\d{2} · Cash · /).isVisible()).toBe(true)
    expect(await button(page, 'Cancel order').count()).toBe(0)
    expect(await page.getByRole('listitem').filter({ hasText: 'Preparing' }).getAttribute('aria-current')).toBe('step')

    await counter(order, 'ready', 2)
    await expect.poll(() => page.getByText('Ready for pickup').isVisible(), POLL).toBe(true)
    await expect.poll(() => page.title()).toBe(`Ready: ${number(order)} · NUK Cafe`)

    await counter(order, 'complete', 3)
    await expect.poll(() => page.getByText(/^Picked up at /).isVisible(), POLL).toBe(true)
    await expect.poll(() => page.title()).toBe('Your order · NUK Cafe')

    await button(page, 'Order again').click()
    await page.waitForURL(u => u.pathname === '/')
    await expect.poll(() => page.getByText('Added 2 items to your order').first().isVisible()).toBe(true)
    const panel = page.getByRole('complementary', { name: 'Your order' })
    await expect.poll(() => panel.getByText('Banana Bread', { exact: true }).isVisible()).toBe(true)
    expect(problems).toEqual([])
  })

  it('cancels while unpaid, from a bottom sheet on a phone; Your orders lists it under Past', async () => {
    const order = await placeOrder(seed.customers.followerB)
    const { page } = await signedIn(seed.customers.followerB, `/orders/${order.id}`, 390)

    await button(page, 'Cancel order').click()
    const sheet = page.getByRole('dialog', { name: `Cancel order ${number(order)}?` })
    await sheet.waitFor()
    await sheet.getByText('You haven\'t paid, so nothing is charged.').waitFor()
    await sheet.getByRole('button', { name: 'Cancel order' }).click()

    await expect.poll(() => page.getByText('You cancelled this order').isVisible()).toBe(true)
    await expect.poll(() => page.getByText('Cancelled', { exact: true }).first().isVisible()).toBe(true)
    expect(await page.getByRole('list', { name: 'Progress' }).count()).toBe(0)

    await page.goto(url('/orders'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { name: 'Past' }).waitFor()
    const row = page.getByRole('link', { name: `Order ${number(order)}, Cancelled` })
    await row.waitFor()
    await row.click()
    await page.waitForURL(u => u.pathname === `/orders/${order.id}`)
  })

  it('a payment at the counter wins over the customer\'s cancel: the sheet says so and the page shows Preparing', async () => {
    const order = await placeOrder(seed.customers.followerB)
    const { page } = await signedIn(seed.customers.followerB, `/orders/${order.id}`)

    await button(page, 'Cancel order').click()
    const dialog = page.getByRole('dialog', { name: `Cancel order ${number(order)}?` })
    await dialog.waitFor()
    await counter(order, 'pay', 1)
    await dialog.getByRole('button', { name: 'Cancel order' }).click()

    await expect.poll(() => dialog.getByText(`Order ${number(order)} is paid now, so it can't be cancelled here. Ask at the counter.`).isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click()
    await expect.poll(() => page.getByText(PREPARING).isVisible()).toBe(true)
    expect(await button(page, 'Cancel order').count()).toBe(0)
  })

  it('another customer\'s order is not found', async () => {
    const order = await placeOrder(seed.customers.followerA)
    const { page } = await signedIn(seed.customers.followerC, `/orders/${order.id}`)
    await expect.poll(() => page.getByText('This order wasn\'t found').isVisible()).toBe(true)
  })
})

describe('finding an order again', () => {
  it('the menu shows a bar for an order in progress, green when it\'s ready; the account menu opens Your orders', async () => {
    const order = await placeOrder(seed.customers.followerC)
    const { page } = await signedIn(seed.customers.followerC, '/', 390)

    const bar = page.getByRole('link', { name: new RegExp(`^Order ${number(order)} · Waiting for payment`) })
    await bar.waitFor()
    await counter(order, 'pay', 1)
    await counter(order, 'ready', 2)
    const ready = page.getByRole('link', { name: new RegExp(`^Order ${number(order)} is ready`) })
    await ready.waitFor(POLL)
    await ready.click()
    await page.waitForURL(u => u.pathname === `/orders/${order.id}`)
    await page.getByText('Ready for pickup').waitFor()

    await page.getByRole('button', { name: /^Account: / }).click()
    await page.getByRole('link', { name: 'Your orders' }).first().click()
    await page.waitForURL(u => u.pathname === '/orders')
    await page.getByRole('heading', { name: 'In progress' }).waitFor()
    await page.getByRole('link', { name: `Order ${number(order)}, Ready` }).waitFor()
    await counter(order, 'complete', 3)
  })

  it('a signed-out visitor gets no bar and no orders request', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/c/nuk/shop/orders')) requests.push(request.url())
    })
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { name: 'Coffee', exact: true }).waitFor()
    await page.getByRole('link', { name: 'Sign in' }).first().waitFor()
    expect(requests).toEqual([])
  })
})
