import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote, CustomerOrders, Order } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { setupE2e } from './support/mock-api'
import { clientHeaders } from './support/client-address'
import { e2eDatabase } from './support/database'

await setupE2e()

// Two cafes on one site (D141): NUK Cafe at `/c/nuk` (the Standard sample menu) and Brown Bean at
// `/c/brown-bean` (one item), on the built server and its seeded database, no mocks. Each address
// shows only its own cafe; a QR code finds its own cafe; an account sees each cafe's own orders and
// works only where it's staff.

const seed = inject('shopSeed')
const cafe = seed.secondCafe
const origin = new URL(url('/')).origin

async function signIn(person: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(person) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

const itemsOf = (menu: PublicMenu) => menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)])

describe('each cafe at its own address', () => {
  it('renders only its own menu', async () => {
    const nuk = await (await fetch(url('/c/nuk'))).text()
    const brown = await (await fetch(url(`/c/${cafe.slug}`))).text()
    expect(nuk).toContain('Banana Bread')
    expect(nuk).not.toContain(cafe.itemName)
    expect(brown).toContain(cafe.itemName)
    expect(brown).not.toContain('Banana Bread')
    expect(brown).toContain('Bean Street')
    expect(brown).not.toContain('Riverside')
  })

  it('an address that names no cafe is not found, page and API alike', async () => {
    expect((await fetch(url('/c/nowhere'))).status).toBe(404)
    expect((await fetch(url('/c/nowhere/checkout'))).status).toBe(404)
    expect((await fetch(url('/api/c/nowhere/public/branches'))).status).toBe(404)
    // Another cafe's branch named in this cafe's API: not found either.
    expect((await fetch(url(`/api/c/nuk/public/menu?branchId=${cafe.branchId}`))).status).toBe(404)
  })

  it('addresses from before cafe addresses go to NUK Cafe\'s, the query kept', async () => {
    const moved = async (path: string) => (await fetch(url(path), { redirect: 'manual' })).headers.get('location')
    expect(await moved('/')).toBe('/c/nuk')
    expect(await moved('/admin/products?item=i1')).toBe('/c/nuk/admin/products?item=i1')
    expect(await moved(`/counter/${seed.openBranchId}?order=o1`)).toBe(`/c/nuk/counter/${seed.openBranchId}?order=o1`)
    expect(await moved('/checkout')).toBe('/c/nuk/checkout')
  })

  it('an address a cafe had before redirects to its current one (D142)', async () => {
    const client = e2eDatabase(seed.dbFile)
    try {
      // As the platform console records a change of address: the old one stays the cafe's.
      await client.execute({ sql: 'insert or ignore into tenant_slugs (slug, tenant_id) values (?, ?)', args: ['brown-bean-old', 'tenant-2'] })
    }
    finally {
      client.close()
    }
    const moved = await fetch(url('/c/brown-bean-old/checkout?table=1'), { redirect: 'manual' })
    expect([moved.status, moved.headers.get('location')]).toEqual([302, `/c/${cafe.slug}/checkout?table=1`])
    // The platform console's API is the platform team's only.
    expect((await fetch(url('/api/platform/me'))).status).toBe(401)
  })

  it('a table\'s QR code opens its own cafe\'s menu, at that table', async () => {
    const page = await createPage()
    await page.goto(url(`/table/${cafe.tableToken}`), { waitUntil: 'hydration' })
    await page.waitForURL(address => address.pathname === `/c/${cafe.slug}`)
    await page.getByRole('heading', { name: 'Beans', exact: true }).waitFor()
    await page.getByText('Table B1').first().waitFor()
    expect(await page.getByText('Banana Bread').count()).toBe(0)
  })
})

describe('each cafe by its own name (D143)', () => {
  it('names itself on its menu and in its profile', async () => {
    const profile = async (slug: string) => (await fetch(url(`/api/cafes/${slug}`))).json()
    expect(await profile('nuk')).toEqual({ slug: 'nuk', name: 'NUK Cafe', logoUrl: null, status: 'active' })
    expect(await profile(cafe.slug)).toMatchObject({ slug: cafe.slug, name: 'Brown Bean' })
    expect((await fetch(url('/api/cafes/nowhere'))).status).toBe(404)
    // A paused cafe still has a profile: its pages name it.
    expect(await profile('quiet-corner')).toMatchObject({ name: 'Quiet Corner', status: 'suspended' })

    const brown = await (await fetch(url(`/c/${cafe.slug}`))).text()
    expect(brown).toContain('<title>Menu · Brown Bean</title>')
    expect(brown).not.toContain('NUK Cafe')
  })

  it('an address that names no cafe says so', async () => {
    const page = await createPage()
    for (const path of ['/c/nowhere', '/c/nowhere/admin']) {
      await page.goto(url(path))
      await page.getByRole('heading', { name: 'Cafe not found' }).waitFor()
      expect(await page.getByRole('button', { name: /Back to/ }).count()).toBe(0)
    }
  })

  it('a paused cafe says so, by name, to customers and to its staff', async () => {
    const page = await createPage()
    expect((await page.goto(url('/c/quiet-corner')))?.status()).toBe(403)
    await page.getByRole('heading', { name: 'Ordering is paused' }).waitFor()
    await page.getByText('Quiet Corner isn\'t taking orders at the moment.').waitFor()
    await expect.poll(() => page.title()).toBe('Ordering is paused · Quiet Corner')
    await page.goto(url('/c/quiet-corner/admin'))
    await page.getByRole('heading', { name: 'This cafe is paused' }).waitFor()
    await page.getByText(/Quiet Corner is paused by the platform team/).waitFor()
  })
})

describe('one account, two cafes', () => {
  it('sees each cafe\'s own orders only', async () => {
    const cookie = await signIn(seed.customers.cafeHopper)
    const menu = await (await fetch(url(`/api/c/${cafe.slug}/public/menu?branchId=${cafe.branchId}`))).json() as PublicMenu
    const latte = itemsOf(menu).find(item => item.name === cafe.itemName)!
    const lines = [{ itemId: latte.id, variationId: latte.variations[0]!.id, quantity: 1, note: null }]
    const quote = await (await fetch(url(`/api/c/${cafe.slug}/public/checkout/quote`), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ branchId: cafe.branchId, lines }) })).json() as CheckoutQuote
    const placed = await fetch(url(`/api/c/${cafe.slug}/shop/orders`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ branchId: cafe.branchId, tableToken: null, lines, expectedTotalMinor: quote.totalMinor }),
    })
    expect(placed.status).toBe(201)
    const order = await placed.json() as Order

    const listed = async (slug: string) => (await (await fetch(url(`/api/c/${slug}/shop/orders`), { headers: { cookie } })).json() as CustomerOrders).inProgress.map(o => o.id)
    expect(await listed(cafe.slug)).toEqual([order.id])
    expect(await listed('nuk')).toEqual([])
    expect((await fetch(url(`/api/c/nuk/shop/orders/${order.id}`), { headers: { cookie } })).status).toBe(404)
    expect((await fetch(url(`/api/c/${cafe.slug}/shop/orders/${order.id}`), { headers: { cookie } })).status).toBe(200)
  })

  it('works at the counter only where it\'s staff', async () => {
    const cookie = await signIn(seed.customers.cashier)
    expect((await fetch(url('/api/c/nuk/counter/me'), { headers: { cookie } })).status).toBe(200)
    const elsewhere = await fetch(url(`/api/c/${cafe.slug}/counter/me`), { headers: { cookie } })
    expect([elsewhere.status, (await elsewhere.json()).data.code]).toEqual([403, 'NOT_STAFF'])
    expect((await fetch(url(`/api/c/${cafe.slug}/counter/${seed.openBranchId}/orders`), { headers: { cookie } })).status).toBe(404)
  })
})
