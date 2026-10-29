import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote, CustomerOrders, Order } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { setupE2e } from './support/mock-api'
import { asNewVisitor, clientHeaders } from './support/client-address'
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

  it('the site\'s root is the platform\'s; no address leads into a default cafe (D221)', async () => {
    const answer = async (path: string) => {
      const response = await fetch(url(path), { redirect: 'manual' })
      return [response.status, response.headers.get('location')]
    }
    // The platform's own page (platform-home.test.ts), not a redirect.
    expect(await answer('/')).toEqual([200, null])
    for (const path of ['/admin/products?item=i1', `/counter/${seed.openBranchId}?order=o1`, '/checkout', '/orders']) {
      expect((await answer(path))[0], path).toBe(404)
    }
  })

  it('a page has one address, without a trailing slash (D208)', async () => {
    const moved = async (path: string) => {
      const response = await fetch(url(path), { redirect: 'manual' })
      return [response.status, response.headers.get('location')]
    }
    expect(await moved('/c/nuk/')).toEqual([301, '/c/nuk'])
    expect(await moved('/c/nuk/?table=1')).toEqual([301, '/c/nuk?table=1'])
    expect(await moved('/c/nuk/admin/login/?redirect=/c/nuk/admin')).toEqual([301, '/c/nuk/admin/login?redirect=/c/nuk/admin'])
    expect(await moved('/c/nuk')).toEqual([200, null])
    // Never towards another site (the root's own redirect stays on this site, D221), and the API answers as it is.
    expect(String((await moved('//evil.example/'))[1] ?? '')).not.toContain('evil.example')
    expect((await fetch(url('/api/c/nuk/public/branches/'), { redirect: 'manual' })).status).not.toBe(301)

    // A link inside the app to the slashed form lands on the same address.
    const page = await createPage()
    await page.goto(url('/c/nuk/'), { waitUntil: 'hydration' })
    expect(new URL(page.url()).pathname).toBe('/c/nuk')
    await page.evaluate(() => (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } } } }).__vue_app__.config.globalProperties.$router.push('/c/nuk/orders/'))
    await page.waitForURL(address => address.pathname === '/c/nuk/orders')
    await page.close()
  })

  it('page addresses match their exact case, so no check is skipped by changing it (D226)', async () => {
    // The cafe check (server/middleware/31.cafe-pages.ts) and the browser's splitTenantUrl read
    // `/c/` in lowercase; the router must not open a cafe's page under any other spelling.
    for (const path of ['/C/nuk', '/C/nowhere', '/C/quiet-corner', '/C/nuk/admin', '/TABLE/x']) {
      const response = await fetch(url(path), { redirect: 'manual' })
      expect(response.status, path).toBe(404)
      // Before D226, `/C/quiet-corner` rendered the paused cafe by name with 200 instead of its 403 page.
      expect(await response.text(), path).not.toContain('Quiet Corner')
    }
    // A slug is lowercase only (slugSchema), so another spelling names no cafe.
    expect((await fetch(url('/c/NUK'))).status).toBe(404)
    expect((await fetch(url('/c/nuk'))).status).toBe(200)

    const page = await createPage()
    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    const matched = await page.evaluate(() => (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { resolve: (to: string) => { matched: unknown[] } } } } } }).__vue_app__.config.globalProperties.$router.resolve('/C/nuk/admin').matched.length)
    expect(matched).toBe(0)
    await page.close()
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
    await page.getByText('Table B1').filter({ visible: true }).first().waitFor()
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
      await page.getByRole('heading', { name: 'This cafe doesn\'t exist' }).waitFor()
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

describe('each cafe\'s installable apps (D202)', () => {
  const manifest = async (path: string) => {
    const response = await fetch(url(path), { redirect: 'manual' })
    return { status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), location: response.headers.get('location'), body: response.status === 200 ? await response.json() : null }
  }

  it('describe its own counter and admin, by its own name', async () => {
    const nuk = await manifest('/c/nuk/counter.webmanifest')
    expect(nuk).toMatchObject({ status: 200, cache: 'no-cache', body: { id: '/c/nuk/counter', name: 'NUK Cafe Counter', start_url: '/c/nuk/counter', scope: '/c/nuk/counter', display: 'standalone' } })
    expect(nuk.type).toMatch(/^application\/manifest\+json/)
    const brown = await manifest(`/c/${cafe.slug}/admin.webmanifest`)
    expect(brown.body).toMatchObject({ id: `/c/${cafe.slug}/admin`, name: 'Brown Bean Admin', start_url: `/c/${cafe.slug}/admin` })
    expect(JSON.stringify(brown.body)).not.toContain('NUK Cafe')
    expect(JSON.stringify(nuk.body)).not.toContain('Brown Bean')
    // The icons it names are served.
    for (const icon of nuk.body.icons as { src: string }[]) expect((await fetch(url(icon.src))).status).toBe(200)
  })

  it('an unknown cafe has none, a paused one can\'t be installed, a former address redirects', async () => {
    expect((await manifest('/c/nowhere/counter.webmanifest')).status).toBe(404)
    expect((await manifest('/c/nuk/orders.webmanifest')).status).toBe(404)
    expect((await manifest('/c/quiet-corner/admin.webmanifest')).status).toBe(403)
    const client = e2eDatabase(seed.dbFile)
    try {
      await client.execute({ sql: 'insert or ignore into tenant_slugs (slug, tenant_id) values (?, ?)', args: ['brown-bean-old', 'tenant-2'] })
    }
    finally {
      client.close()
    }
    expect(await manifest('/c/brown-bean-old/counter.webmanifest')).toMatchObject({ status: 302, location: `/c/${cafe.slug}/counter.webmanifest` })
  })

  it('are linked from the counter and the admin, not from the menu', async () => {
    const page = await createPage()
    const manifestLink = () => page.locator('link[rel="manifest"]').getAttribute('href', { timeout: 5000 }).catch(() => null)
    await page.goto(url(`/c/${cafe.slug}/counter/sign-in`), { waitUntil: 'hydration' })
    await expect.poll(manifestLink).toBe(`/c/${cafe.slug}/counter.webmanifest`)
    await expect.poll(() => page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content')).toBe('Brown Bean Counter')
    await page.goto(url('/c/nuk/admin/login'), { waitUntil: 'hydration' })
    await expect.poll(manifestLink).toBe('/c/nuk/admin.webmanifest')
    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    expect(await page.locator('link[rel="manifest"]').count()).toBe(0)
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

describe('your cafes (D144)', () => {
  it('lists each account\'s own cafes and what it may open there', async () => {
    const cafesOf = async (cookie: string) => (await (await fetch(url('/api/me/cafes'), { headers: { cookie } })).json() as { slug: string, workspaces: string[] }[])
      .map(({ slug, workspaces }) => ({ slug, workspaces }))
    expect((await fetch(url('/api/me/cafes'))).status).toBe(401)
    expect(await cafesOf(await signIn(seed.customers.beanOwner))).toEqual([{ slug: cafe.slug, workspaces: ['admin', 'counter'] }])
    expect(await cafesOf(await signIn(seed.customers.cashier))).toEqual([{ slug: 'nuk', workspaces: ['counter'] }])
    expect(await cafesOf(await signIn(seed.customers.verified))).toEqual([])
  })

  it('an owner who signs in at another cafe\'s admin moves on to their own from Your cafes', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/c/nuk/admin/login'), { waitUntil: 'hydration' })
    await page.getByLabel('Email').fill(seed.customers.beanOwner.email)
    await page.getByLabel('Password', { exact: true }).fill(seed.customers.beanOwner.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByText('This account doesn\'t manage this cafe.', { exact: false }).waitFor()
    await page.getByRole('link', { name: 'Your cafes' }).click()
    await page.getByRole('link', { name: 'Admin, Brown Bean' }).click()
    await page.waitForURL(address => address.pathname === `/c/${cafe.slug}/admin`)
    await page.getByRole('button', { name: 'Brown Bean Admin: cafe menu' }).waitFor()
  })
})
