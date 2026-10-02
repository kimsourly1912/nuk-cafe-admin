import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote, CounterOrder, Order } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import type { SeedCustomer } from './support/seed'
import { asNewVisitor, clientHeaders } from './support/client-address'
import { e2eDatabase } from './support/database'
import { setupE2e, toast } from './support/mock-api'

await setupE2e()

// The counter app (step 6.3b, D102) against the e2e server's seeded database: a customer places an
// order over HTTP, the seeded cashier (staff at Riverside) signs in at /counter and takes it through
// payment, ready and complete, or cancels it. The queue refreshes every 10 seconds; tests wait for
// their own order by its number (other test files place orders at Riverside too).

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin
const number = (order: { pickupNumber: number }) => String(order.pickupNumber).padStart(3, '0')

async function signInOverHttp(account: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(account) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

/** One Banana Bread ($2.25) at Riverside, placed by `customer`. */
async function placeOrder(customer: SeedCustomer): Promise<Order> {
  const cookie = await signInOverHttp(customer)
  const menu = await (await fetch(url(`/api/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
  const bread = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.name === 'Banana Bread')!
  const lines = [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 1, note: 'Warm it up' }]
  const quote = await (await fetch(url('/api/public/checkout/quote'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ branchId: seed.openBranchId, lines }) })).json() as CheckoutQuote
  const response = await fetch(url('/api/shop/orders'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ branchId: seed.openBranchId, lines, expectedTotalMinor: quote.totalMinor }),
  })
  expect(response.status).toBe(201)
  return await response.json() as Order
}

/** Signs the cashier in at /counter; with one branch, the queue opens. */
async function cashierAtCounter(width = 1180) {
  const page = await createPage()
  await asNewVisitor(page)
  const problems: string[] = []
  page.on('pageerror', error => problems.push(error.message))
  await page.setViewportSize({ width, height: width < 640 ? 844 : 820 })
  await page.goto(url('/counter'), { waitUntil: 'hydration' })
  await page.waitForURL(u => u.pathname === '/counter/sign-in')
  await page.getByLabel('Email').fill(seed.customers.cashier.email)
  await page.getByLabel('Password', { exact: true }).fill(seed.customers.cashier.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(u => u.pathname === `/counter/${seed.openBranchId}`)
  return { page, problems }
}

/** A counter command over HTTP, as the cashier. */
async function command(order: Order, action: 'pay' | 'ready' | 'complete' | 'cancel', body: Record<string, unknown>) {
  const cookie = await signInOverHttp(seed.customers.cashier)
  const response = await fetch(url(`/api/counter/${seed.openBranchId}/orders/${order.id}/${action}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
}

const column = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) })
const card = (page: Page, order: { pickupNumber: number }) => page.getByRole('article', { name: `Order ${number(order)}` })
const panel = (page: Page) => page.getByRole('dialog')

async function sql(statement: string, args: (string | number)[] = []) {
  const client = e2eDatabase(seed.dbFile)
  try {
    await client.execute({ sql: statement, args })
  }
  finally {
    client.close()
  }
}

describe('the counter', () => {
  it('signs in, takes a cash payment with change, marks the order ready and completes it', async () => {
    const order = await placeOrder(seed.customers.counterShopperA)
    const { page, problems } = await cashierAtCounter()
    await column(page, 'To pay').getByRole('article', { name: `Order ${number(order)}` }).waitFor()
    await expect.poll(() => card(page, order).textContent()).toContain('Banana Bread')

    await page.getByRole('button', { name: `Take payment: order ${number(order)}` }).click()
    const sheet = panel(page)
    await sheet.getByText('1 × Banana Bread').waitFor()
    await sheet.getByText('Warm it up').waitFor()
    // Short: Confirm waits.
    await sheet.getByRole('spinbutton').fill('1')
    await sheet.getByRole('spinbutton').blur()
    await sheet.getByText('Short by').waitFor()
    expect(await sheet.getByRole('button', { name: 'Confirm payment · $2.25' }).isDisabled()).toBe(true)
    // A quick amount: the change to give.
    await sheet.getByRole('button', { name: '$5.00' }).click()
    await sheet.getByText('Change (USD)').waitFor()
    await sheet.getByText('$2.75').waitFor()
    await sheet.getByRole('button', { name: 'Confirm payment · $2.25' }).click()
    await toast(page, `Order ${number(order)} paid`).waitFor()

    await column(page, 'Preparing').getByRole('article', { name: `Order ${number(order)}` }).waitFor()
    await page.getByRole('button', { name: `Mark ready: order ${number(order)}` }).click()
    await column(page, 'Ready').getByRole('article', { name: `Order ${number(order)}` }).waitFor()
    await page.getByRole('button', { name: `Complete: order ${number(order)}` }).click()
    await toast(page, `Order ${number(order)} completed`).waitFor()
    await expect.poll(() => card(page, order).count()).toBe(0)
    expect(problems).toEqual([])
  })

  it('cash in riel at the rate an admin set, rounded up to ៛100; then cancelling the paid order records the money returned', async () => {
    await sql('insert into exchange_rates (id, currency, per_usd, effective_from, set_by) values (?, \'KHR\', 4100, ?, (select id from user where email = \'e2e-admin@example.com\'))', [crypto.randomUUID(), Date.now() - 60_000])
    const order = await placeOrder(seed.customers.counterShopperA)
    const { page } = await cashierAtCounter()
    await page.getByRole('button', { name: `Take payment: order ${number(order)}` }).click()
    const sheet = panel(page)
    await sheet.getByRole('tab', { name: 'Cash riel' }).click()
    // $2.25 × 4,100 = ៛9,225 → ៛9,300.
    await sheet.getByText('៛9,300').first().waitFor()
    await sheet.getByRole('button', { name: '៛10,000' }).click()
    await sheet.getByText('Change (riel)').waitFor()
    await sheet.getByText('៛700', { exact: true }).waitFor()
    await sheet.getByRole('button', { name: 'Confirm payment · ៛9,300' }).click()
    await toast(page, `Order ${number(order)} paid`).waitFor()

    await column(page, 'Preparing').getByRole('button', { name: `Open order ${number(order)}` }).click()
    await panel(page).getByText(/Paid .* by Sophea · Cash riel ៛9,300/).waitFor()
    await panel(page).getByRole('button', { name: 'Cancel order' }).click()
    const dialog = page.getByRole('dialog', { name: `Cancel order ${number(order)}?` })
    await dialog.getByText('Money returned').waitFor()
    await dialog.getByText('An item isn\'t available').click()
    await dialog.getByRole('button', { name: 'Cancel and return ៛9,300' }).click()
    await toast(page, `Order ${number(order)} cancelled`).waitFor()
    await expect.poll(() => card(page, order).count()).toBe(0)
    await sql('delete from exchange_rates')
  })

  it('KHQR at the counter (D130): a QR for this order in dollars or riel, with its number and minutes left; the payment names it', async () => {
    const admin = '(select id from user where email = \'e2e-admin@example.com\')'
    await sql(`insert into khqr_settings (id, enabled, account_id, merchant_name, merchant_city, currencies, version, updated_by, updated_at) values ('default', 1, 'nukcafe@aclb', 'NUK Cafe', 'Phnom Penh', 'USD,KHR', 1, ${admin}, ?)`, [Date.now()])
    await sql(`insert into exchange_rates (id, currency, per_usd, effective_from, set_by) values (?, 'KHR', 4100, ?, ${admin})`, [crypto.randomUUID(), Date.now() - 60_000])
    try {
      const order = await placeOrder(seed.customers.counterShopperA)
      const { page, problems } = await cashierAtCounter()
      await page.getByRole('button', { name: `Take payment: order ${number(order)}` }).click()
      const sheet = panel(page)
      await sheet.getByRole('tab', { name: 'KHQR' }).click()
      await sheet.getByRole('img', { name: `KHQR for order ${number(order)}, $2.25` }).waitFor()
      await sheet.getByText(`Order ${number(order)} · to NUK Cafe`).waitFor()
      expect(await sheet.getByText(/^Works for 1[45]:\d\d$/).count()).toBe(1)

      await sheet.getByRole('button', { name: 'Riel' }).click()
      // $2.25 at ៛4,100 = ៛9,225, rounded up to ៛9,300.
      await sheet.getByRole('img', { name: `KHQR for order ${number(order)}, ៛9,300` }).waitFor()
      await sheet.getByRole('button', { name: 'Confirm KHQR payment · ៛9,300' }).click()
      await toast(page, `Order ${number(order)} paid`).waitFor()

      const client = e2eDatabase(seed.dbFile)
      try {
        const { rows } = await client.execute({ sql: 'select p.method, c.currency, c.amount from counter_payments p join khqr_charges c on c.id = p.khqr_charge_id where p.order_id = ?', args: [order.id] })
        expect(rows.map(row => [row.method, row.currency, row.amount])).toEqual([['khqr', 'KHR', 9300]])
      }
      finally {
        client.close()
      }
      expect(problems).toEqual([])
    }
    finally {
      await sql('delete from khqr_settings')
      await sql('delete from exchange_rates')
    }
  })

  it('KHQR checked with Bakong (D131): the payment is recorded as soon as Bakong confirms it; something else arriving is said and records nothing', async () => {
    const admin = '(select id from user where email = \'e2e-admin@example.com\')'
    await sql(`insert into khqr_settings (id, enabled, account_id, merchant_name, merchant_city, currencies, version, updated_by, updated_at) values ('default', 1, 'nukcafe@aclb', 'NUK Cafe', 'Phnom Penh', 'USD', 1, ${admin}, ?)`, [Date.now()])
    const client = e2eDatabase(seed.dbFile)
    /** The QR the counter made for the order (its MD5 is what the server asks Bakong about). */
    async function chargeOf(order: Order) {
      let charge: { id: string, md5: string } | undefined
      await expect.poll(async () => {
        const { rows } = await client.execute({ sql: 'select id, md5 from khqr_charges where order_id = ?', args: [order.id] })
        charge = rows[0] as unknown as typeof charge
        return charge
      }).toBeTruthy()
      return charge!
    }
    /** Tells the stand-in for Bakong that this QR was paid. */
    const bakongPaid = (md5: string, amount: number, toAccountId = 'nukcafe@aclb') => fetch(`${inject('fakeBakongUrl')}/__test/transactions`, {
      method: 'POST',
      body: JSON.stringify({ md5, transaction: { hash: `hash-${md5.slice(0, 8)}`, fromAccountId: 'customer@abaa', toAccountId, currency: 'USD', amount, externalRef: `FT${md5.slice(0, 10)}`, createdDateMs: Date.now() } }),
    })
    try {
      const order = await placeOrder(seed.customers.counterShopperA)
      const odd = await placeOrder(seed.customers.counterShopperB)
      const { page, problems } = await cashierAtCounter()

      await page.getByRole('button', { name: `Take payment: order ${number(order)}` }).click()
      const sheet = panel(page)
      await sheet.getByRole('tab', { name: 'KHQR' }).click()
      await sheet.getByRole('img', { name: `KHQR for order ${number(order)}, $2.25` }).waitFor()
      await sheet.getByText('Waiting for the payment: it\'s recorded as soon as Bakong confirms it.').waitFor()
      // Above the QR, so a tablet's panel shows it without scrolling (820 px tall here).
      const status = await sheet.getByText('Waiting for the payment: it\'s recorded as soon as Bakong confirms it.').boundingBox()
      expect(status!.y + status!.height).toBeLessThan(820)
      const charge = await chargeOf(order)
      await bakongPaid(charge.md5, 2.25)
      // Nobody presses Confirm: the next check (every 5 s) records it and closes the panel.
      await toast(page, `Order ${number(order)} paid`).waitFor({ timeout: 15_000 })
      await expect.poll(() => sheet.count()).toBe(0)
      const { rows } = await client.execute({ sql: 'select method, khqr_charge_id, reference from counter_payments where order_id = ?', args: [order.id] })
      expect(rows.map(row => [row.method, row.khqr_charge_id, row.reference])).toEqual([['khqr', charge.id, `FT${charge.md5.slice(0, 10)}`]])

      await page.getByRole('button', { name: `Take payment: order ${number(odd)}` }).click()
      await sheet.getByRole('tab', { name: 'KHQR' }).click()
      await sheet.getByRole('img', { name: `KHQR for order ${number(odd)}, $2.25` }).waitFor()
      const oddCharge = await chargeOf(odd)
      await bakongPaid(oddCharge.md5, 2)
      await sheet.getByText('A payment arrived on this QR that doesn\'t match it').waitFor({ timeout: 15_000 })
      await sheet.getByText(/Bakong says \$2\.00 to nukcafe@aclb\. Nothing was recorded/).waitFor()
      expect((await client.execute({ sql: 'select count(*) as n from counter_payments where order_id = ?', args: [odd.id] })).rows[0]!.n).toBe(0)
      expect(problems).toEqual([])
    }
    finally {
      client.close()
      await sql('delete from khqr_settings')
    }
  })

  it('a payment someone else recorded first: says so, and Reload shows the order as it is', async () => {
    const order = await placeOrder(seed.customers.counterShopperB)
    const { page } = await cashierAtCounter()
    await page.getByRole('button', { name: `Take payment: order ${number(order)}` }).click()
    await panel(page).getByRole('button', { name: 'Confirm payment · $2.25' }).waitFor()

    // Another cashier takes it at the same moment.
    const cookie = await signInOverHttp(seed.customers.cashier)
    const paid = await fetch(url(`/api/counter/${seed.openBranchId}/orders/${order.id}/pay`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ version: 1, method: 'khqr' }),
    })
    expect(((await paid.json()) as CounterOrder).status).toBe('preparing')

    await panel(page).getByRole('button', { name: 'Confirm payment · $2.25' }).click()
    await panel(page).getByText(`Order ${number(order)} changed meanwhile: it's paid and being prepared now.`).waitFor()
    await panel(page).getByRole('button', { name: 'Reload' }).click()
    await panel(page).getByRole('button', { name: 'Mark ready' }).waitFor()
    await panel(page).getByText(/by Sophea · KHQR \$2\.25/).waitFor()
  })

  it('paid by someone else while the panel is open: the refresh says so, and Mark ready waits for OK (release check 10.5)', { timeout: 60_000 }, async () => {
    const order = await placeOrder(seed.customers.counterShopperB)
    const { page } = await cashierAtCounter()
    await page.getByRole('button', { name: `Take payment: order ${number(order)}` }).click()
    await panel(page).getByRole('button', { name: 'Confirm payment · $2.25' }).waitFor()

    // Another cashier takes it; this panel learns it from the queue's next refresh (every 10 s).
    await command(order, 'pay', { version: 1, method: 'cash_usd' })
    await panel(page).getByText('Paid meanwhile by Sophea: it\'s being prepared.').waitFor({ timeout: 20_000 })
    // The button under the cashier's finger isn't silently swapped for Mark ready.
    expect(await panel(page).getByRole('button', { name: /^Confirm payment/ }).count()).toBe(0)
    expect(await panel(page).getByRole('button', { name: 'Mark ready' }).count()).toBe(0)

    await panel(page).getByRole('button', { name: 'OK', exact: true }).click()
    await panel(page).getByRole('button', { name: 'Mark ready' }).waitFor()
    await panel(page).getByText(/by Sophea · Cash USD \$2\.25/).waitFor()
  })

  it('`?order=` (Telegram\'s Open order, D113) opens that order, then leaves the URL', async () => {
    const order = await placeOrder(seed.customers.counterShopperA)
    try {
      const { page } = await cashierAtCounter()
      await page.goto(url(`/counter/${seed.openBranchId}?order=${order.id}`), { waitUntil: 'hydration' })
      await panel(page).getByText('1 × Banana Bread').waitFor()
      await expect.poll(() => new URL(page.url()).search).toBe('')
      // Once it has left the queue, the link opens it on Finished today (step 10.2).
      await command(order, 'cancel', { version: 1, reason: 'customer_changed_mind', note: null, returnMethod: null })
      await page.goto(url(`/counter/${seed.openBranchId}?order=${order.id}`), { waitUntil: 'hydration' })
      await page.waitForURL(u => u.pathname === `/counter/${seed.openBranchId}/finished`)
      await page.getByRole('heading', { name: `Order ${number(order)}` }).waitFor()
      await page.getByText('Cancelled by Sophea: customer changed their mind').waitFor()
      await expect.poll(() => new URL(page.url()).search).toBe('')
    }
    finally {
      // Not left unpaid: the customer may have two at most.
      await sql('update orders set status = \'cancelled\' where id = ? and status = \'awaiting_payment\'', [order.id])
    }
  })

  it('Finished today (step 10.2): a completed order is listed with its payment; its panel shows each step and who took it; the chips and search filter', async () => {
    const order = await placeOrder(seed.customers.counterShopperB)
    await command(order, 'pay', { version: 1, method: 'khqr' })
    await command(order, 'ready', { version: 2 })
    await command(order, 'complete', { version: 3 })
    const { page, problems } = await cashierAtCounter()

    await page.getByRole('link', { name: /^Finished today \(\d+\)$/ }).click()
    await page.waitForURL(u => u.pathname === `/counter/${seed.openBranchId}/finished`)
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Order ${number(order)}`, exact: true }) })
    await row.getByText('KHQR', { exact: true }).waitFor()
    await row.getByText('Completed').waitFor()

    await row.getByRole('button', { name: `Order ${number(order)}`, exact: true }).click()
    const aside = page.getByRole('complementary', { name: 'Order' })
    await aside.getByRole('heading', { name: `Order ${number(order)}` }).waitFor()
    await aside.getByText(/KHQR \$2\.25 · by Sophea$/).waitFor()
    await aside.getByText('Completed', { exact: true }).last().waitFor()
    await aside.getByRole('button', { name: 'Close' }).click()
    await aside.waitFor({ state: 'detached' })

    await page.getByRole('button', { name: /^Cancelled/ }).click()
    await expect.poll(() => row.count()).toBe(0)
    await page.getByRole('button', { name: /^All/ }).click()
    await page.getByPlaceholder('Search number or name').fill('no such customer')
    await page.getByText('No matching orders').waitFor()
    expect(problems).toEqual([])
  })

  it('Finished today on a phone: rows, and the order full screen', async () => {
    const order = await placeOrder(seed.customers.counterShopperA)
    await command(order, 'pay', { version: 1, method: 'cash_usd' })
    await command(order, 'ready', { version: 2 })
    await command(order, 'complete', { version: 3 })
    const { page } = await cashierAtCounter(390)
    await page.goto(url(`/counter/${seed.openBranchId}/finished`), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: `Order ${number(order)}, Completed` }).click()
    await panel(page).getByRole('heading', { name: `Order ${number(order)}` }).waitFor()
    await panel(page).getByText(/Cash USD \$2\.25 · by Sophea$/).waitFor()
  })

  it('on a phone: one list at a time, as tabs with counts', async () => {
    const order = await placeOrder(seed.customers.counterShopperB)
    const { page } = await cashierAtCounter(390)
    await page.getByRole('tab', { name: /^To pay/ }).waitFor()
    await card(page, order).waitFor()
    expect(await page.getByRole('region', { name: /^Preparing/ }).count()).toBe(0)
    await page.getByRole('button', { name: `Take payment: order ${number(order)}` }).click()
    const sheet = panel(page)
    await sheet.getByRole('button', { name: 'Confirm payment · $2.25' }).waitFor()
    // Full screen on phones, once its opening animation has settled.
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(390)
  })

  it('refuses an account that works at no branch, on the sign-in page', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/counter/sign-in'), { waitUntil: 'hydration' })
    await page.getByLabel('Email').fill(seed.customers.verified.email)
    await page.getByLabel('Password', { exact: true }).fill(seed.customers.verified.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'This account doesn\'t work at any branch, so it can\'t use the counter.' }).waitFor()
    expect(new URL(page.url()).pathname).toBe('/counter/sign-in')
  })

  it('the customer site\'s account menu links staff to the counter, and only them (D124)', async () => {
    const me = async (account: SeedCustomer) => (await (await fetch(url('/api/shop/me'), { headers: { cookie: await signInOverHttp(account) } })).json()).workspaces
    expect(await me(seed.customers.cashier)).toEqual(['counter'])
    expect(await me(seed.customers.verified)).toEqual([])

    const { page } = await cashierAtCounter(1440)
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: `Account: ${seed.customers.cashier.name}` }).click()
    const counter = page.getByRole('link', { name: 'Counter' })
    expect(await counter.getAttribute('href')).toBe('/counter')
    expect(await page.getByRole('link', { name: 'Admin workspace' }).count()).toBe(0)
    await counter.click()
    await page.waitForURL(u => u.pathname === `/counter/${seed.openBranchId}`)
  })
})

// Coconut Coffee: published, sizes, no time rule, and no other test orders it (switching it off
// here can't change another file's menu).
describe('sold out at the counter (D105)', () => {
  const coconut = async () => {
    const menu = await (await fetch(url(`/api/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
    return menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.name === 'Coconut Coffee')!
  }

  it('switches one version off from the queue\'s Sold out button; the customer menu shows it; "N sold out" lists it; switching back restores it', async () => {
    const { page, problems } = await cashierAtCounter()
    await page.getByRole('link', { name: 'Sold out' }).click()
    await page.waitForURL(u => u.pathname === `/counter/${seed.openBranchId}/sold-out`)
    await page.getByRole('heading', { name: 'Sold out', exact: true }).waitFor()

    await page.getByRole('textbox', { name: 'Find an item' }).fill('coconut')
    const [first] = (await coconut()).variations
    const name = `Coconut Coffee · ${first!.label}`
    const row = page.getByRole('listitem', { name, exact: true })
    const available = row.getByRole('switch', { name: `${name}: available` })
    expect(await available.isChecked()).toBe(true)

    await available.click()
    await row.getByText('Sold out', { exact: true }).first().waitFor()
    await expect.poll(() => row.innerText()).toMatch(/Since \d{1,2}:\d{2}\s[AP]M by Sophea/)
    // The customer's menu shows it sold out.
    await expect.poll(async () => (await coconut()).variations.find(v => v.id === first!.id)!.soldOut).toBe(true)

    // Only the sold-out ones.
    await page.getByRole('textbox', { name: 'Find an item' }).fill('')
    await page.getByRole('button', { name: /^\d+ sold out$/ }).click()
    await row.waitFor()
    expect(await page.getByRole('listitem').filter({ hasText: 'Coconut Coffee' }).count()).toBe(1)

    // Switched back on: it stays in view (a slip can be undone there) until the filter changes.
    await available.click()
    await expect.poll(() => available.isChecked()).toBe(true)
    expect(await row.getByText('Available', { exact: true }).isVisible()).toBe(true)
    await expect.poll(async () => (await coconut()).variations.find(v => v.id === first!.id)!.soldOut).toBe(false)
    // Showing everything and then only the sold-out ones again: it's gone from them.
    await page.getByRole('button', { name: /^\d+ sold out$/ }).click()
    await page.getByRole('button', { name: /^\d+ sold out$/ }).click()
    await expect.poll(() => row.count()).toBe(0)
    expect(problems).toEqual([])
  })

  it('on a phone: the category chips scroll, and each row keeps its switch', async () => {
    const { page } = await cashierAtCounter(390)
    await page.goto(url(`/counter/${seed.openBranchId}/sold-out`), { waitUntil: 'hydration' })
    await page.getByRole('navigation', { name: 'Categories' }).getByRole('button', { name: 'All' }).waitFor()
    const [first] = (await coconut()).variations
    const row = page.getByRole('listitem', { name: `Coconut Coffee · ${first!.label}`, exact: true })
    await row.scrollIntoViewIfNeeded()
    expect(await row.getByRole('switch').isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
