import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { SeedCustomer } from './support/seed'
import { e2eDatabase } from './support/database'
import { setupE2e } from './support/mock-api'
import { asNewVisitor } from './support/client-address'

await setupE2e()

// Review order and Order placed (step 6.2b, D100) against the e2e server's seeded database
// (support/seed.ts): the real quote, the real order placement, real sessions. Each test places its
// orders as its own customer (a customer may have 2 unpaid orders at a time). Prices and tables are
// changed in the database while a page is open, as the admin would.

const seed = inject('shopSeed')

/** Opens a page; collects errors, and Vue's "Hydration completed but contains mismatches". */
async function open(path: string, width = 1440) {
  const page = await createPage()
  await asNewVisitor(page)
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration/i.test(message.text())) problems.push(`${message.text()} ${message.location().url}`)
  })
  page.on('pageerror', error => problems.push(error.message))
  await page.setViewportSize({ width, height: width < 640 ? 844 : 900 })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, problems }
}

const visible = (locator: ReturnType<Page['getByRole']>) => locator.filter({ visible: true })
const button = (page: Page, name: string | RegExp) => visible(page.getByRole('button', { name, exact: typeof name === 'string' }))
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true })
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const at = (path: string) => (u: URL) => u.pathname === path
const onOrderPage = (u: URL) => u.pathname.startsWith('/c/nuk/orders/')

async function addToOrder(page: Page, name: string) {
  await heading(page, 'Coffee').waitFor()
  await visible(card(page, name).getByRole('button', { name: `Add ${name} to order` })).click()
  await expect.poll(() => visible(card(page, name).getByRole('textbox', { name: `Quantity of ${name}` })).inputValue()).toBe('1')
}

async function signIn(page: Page, customer: Pick<SeedCustomer, 'email' | 'password'>) {
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Password', { exact: true }).fill(customer.password)
  await button(page, 'Sign in').click()
}

/** Signs in from the sign-in page and comes back to the menu. */
async function signedIn(customer: SeedCustomer, width = 1440) {
  const opened = await open('/sign-in', width)
  await signIn(opened.page, customer)
  await opened.page.waitForURL(at('/c/nuk'))
  return opened
}

async function reviewOrder(page: Page) {
  await page.goto(url('/c/nuk/checkout'), { waitUntil: 'hydration' })
  await heading(page, 'Review order').waitFor()
}

async function sql(statement: string, args: (string | number)[] = []) {
  const client = e2eDatabase(seed.dbFile)
  try {
    await client.execute({ sql: statement, args })
  }
  finally {
    client.close()
  }
}

describe('placing an order', () => {
  it('signed out: Review order asks to sign in, comes back, places the order with a note; the order page shows the number', async () => {
    const { page, problems } = await open('/c/nuk')
    await addToOrder(page, 'Banana Bread')
    await page.getByRole('complementary', { name: 'Your order' }).getByRole('link', { name: 'Review order' }).click()
    await page.waitForURL(at('/c/nuk/checkout'))
    await heading(page, 'Review order').waitFor()
    await page.getByText('Pickup at Riverside').waitFor()

    await button(page, 'Sign in to place order').click()
    const gate = page.getByRole('dialog')
    await gate.getByRole('heading', { name: 'Sign in to place your order' }).waitFor()
    await gate.getByRole('link', { name: 'Sign in' }).click()
    await page.waitForURL(at('/sign-in'))
    await signIn(page, seed.customers.shopperA)
    await page.waitForURL(at('/c/nuk/checkout'))

    // The order stayed on this device; add a note for the counter.
    await button(page, 'Add a note').click()
    await page.getByLabel('Note for Banana Bread').fill('Warm it up, please')
    await page.getByText('18/140').waitFor()
    await button(page, 'Place order · $2.25').click()

    await page.waitForURL(onOrderPage)
    await page.getByRole('heading', { name: /^Your number \d{3}$/ }).waitFor()
    await page.getByText('Waiting for payment').waitFor()
    await page.getByText('Pay at the counter to start your order. Show this number to the cashier.').waitFor()
    // Tracking (6.5b, D114): the time to pay and the minutes left.
    await page.getByText(/^Pay at the counter by \d{1,2}:\d{2}\s[AP]M$/).waitFor()
    await page.getByText(/^(29|30) min left\. Unpaid orders are cancelled after 30 minutes\.$/).waitFor()
    const summary = page.getByRole('list', { name: 'Order summary' })
    await summary.getByText('1 × Banana Bread').waitFor()
    await summary.getByText('Warm it up, please').waitFor()
    await page.getByText('Riverside · Pickup').waitFor()

    // The order was sent: nothing is left to review, even after a reload of the order page.
    await page.goto(page.url(), { waitUntil: 'hydration' })
    await page.getByText('Waiting for payment').waitFor()
    await reviewOrder(page)
    await page.getByText('Your order is empty').waitFor()
    expect(problems).toEqual([])
  })

  it('an unverified email opens the verify gate; once verified, "I\'ve verified, continue" places the order', async () => {
    const { page } = await signedIn(seed.customers.shopperUnverified)
    await addToOrder(page, 'Banana Bread')
    await reviewOrder(page)
    await button(page, 'Place order · $2.25').click()
    const gate = page.getByRole('dialog')
    await gate.getByRole('heading', { name: 'Verify your email to place orders' }).waitFor()
    await gate.getByText(seed.customers.shopperUnverified.email).waitFor()

    await button(page, 'I\'ve verified, continue').click()
    await gate.getByText('Not verified yet. Open the link in the email first.').waitFor()

    await sql('update user set email_verified = 1 where email = ?', [seed.customers.shopperUnverified.email])
    await button(page, 'I\'ve verified, continue').click()
    await page.waitForURL(onOrderPage)
    await page.getByText('Waiting for payment').waitFor()
  })

  it('a price changed since the quote: the order is refused, the new price is shown next to the old one, and placing again accepts it', async () => {
    const { page, problems } = await signedIn(seed.customers.shopperB)
    await addToOrder(page, 'Blueberry Muffin')
    await reviewOrder(page)
    await button(page, 'Place order · $2.00').waitFor()

    const muffin = 'select v.id from menu_item_variations v join menu_items i on i.id = v.item_id where i.name = \'Blueberry Muffin\''
    await sql(`update menu_item_variations set price_minor = 250 where id in (${muffin})`)
    try {
      await button(page, 'Place order · $2.00').click()
      await page.getByText('Prices have changed', { exact: true }).waitFor()
      expect(await page.getByRole('alert').count()).toBe(0)
      const line = page.getByRole('listitem', { name: 'Blueberry Muffin' })
      await line.getByText('$2.00', { exact: true }).waitFor()
      await line.getByText('$2.50 each').waitFor()
      expect(page.url()).toMatch(/\/checkout$/)

      await button(page, 'Place order · $2.50').click()
      await page.waitForURL(onOrderPage)
      await page.getByRole('list', { name: 'Order summary' }).getByText('$2.50').waitFor()
    }
    finally {
      await sql(`update menu_item_variations set price_minor = 200 where id in (${muffin})`)
    }
    // The server's refusal is an answer the page shows, not an error.
    expect(problems.filter(p => !/409/.test(p))).toEqual([])
  })
})

describe('dine-in', () => {
  it('a table\'s QR code orders to that table; the order page says to collect it at the counter', async () => {
    const { page } = await signedIn(seed.customers.shopperC)
    await page.goto(url(`/table/${seed.openTableToken}`), { waitUntil: 'hydration' })
    await addToOrder(page, 'Banana Bread')
    await reviewOrder(page)
    await page.getByText('Dine-in · Table T01').waitFor()
    await button(page, 'Place order · $2.25').click()
    await page.waitForURL(onOrderPage)
    // No table service (D106): a table order is collected at the counter too.
    await page.getByText('Table T01 order').waitFor()
    await page.getByText('Pay at the counter to start your order. Show this number to the cashier.').waitFor()
    await page.getByText('Riverside · Table T01').waitFor()
  })

  it('signed out at a table: ordering asks to sign in, and the table is still there after signing in (release check 10.5)', async () => {
    const { page, problems } = await open(`/table/${seed.openTableToken}`)
    await addToOrder(page, 'Banana Bread')
    await reviewOrder(page)
    await page.getByText('Dine-in · Table T01').waitFor()

    await button(page, 'Sign in to place order').click()
    await page.getByRole('dialog').getByRole('link', { name: 'Sign in' }).click()
    await page.waitForURL(at('/sign-in'))
    await signIn(page, seed.customers.tableGuest)
    await page.waitForURL(at('/c/nuk/checkout'))

    // The table came back with the order: still dine-in at T01, never pickup instead.
    await page.getByText('Dine-in · Table T01').waitFor()
    await button(page, 'Place order · $2.25').click()
    await page.waitForURL(onOrderPage)
    await page.getByText('Table T01 order').waitFor()
    await page.getByText('Riverside · Table T01').waitFor()
    expect(problems).toEqual([])
  })

  it('a table that stopped taking orders is refused, never switched silently; "Switch to pickup" then places it', async () => {
    const { page } = await signedIn(seed.customers.shopperC)
    await page.goto(url(`/table/${seed.spareTableToken}`), { waitUntil: 'hydration' })
    await addToOrder(page, 'Banana Bread')
    await reviewOrder(page)
    await page.getByText('Dine-in · Table T02').waitFor()

    await sql('update dining_tables set status = \'archived\' where label = \'T02\'')
    await button(page, 'Place order · $2.25').click()
    const alert = page.getByRole('alert')
    await alert.getByRole('button', { name: 'Switch to pickup' }).click()
    await page.getByText('Pickup at Riverside').waitFor()
    await button(page, 'Place order · $2.25').click()
    await page.waitForURL(onOrderPage)
    await page.getByText('Riverside · Pickup').waitFor()
  })
})

describe('on a phone', () => {
  it('the total and the button are in the bottom bar; the sign-in gate is a bottom sheet', async () => {
    const { page, problems } = await open('/c/nuk', 1440)
    await addToOrder(page, 'Banana Bread')
    await page.setViewportSize({ width: 390, height: 844 })
    await reviewOrder(page)
    const bar = page.getByRole('toolbar', { name: 'Place your order' })
    await bar.getByText('$2.25').waitFor()
    expect(await page.getByRole('complementary', { name: 'Order summary' }).isVisible()).toBe(false)
    const box = (await bar.boundingBox())!
    expect(Math.round(box.y + box.height)).toBe(844)

    await bar.getByRole('button', { name: 'Sign in to place order' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('heading', { name: 'Sign in to place your order' }).waitFor()
    await sheet.getByRole('link', { name: 'Create account' }).waitFor()
    // A sheet: it sits at the bottom of the screen.
    await expect.poll(async () => Math.round(((await sheet.boundingBox())!).y + ((await sheet.boundingBox())!).height)).toBe(844)
    expect(problems).toEqual([])
  })
})
