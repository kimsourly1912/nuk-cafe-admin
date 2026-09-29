import { url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote, Order } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { setupE2e } from './support/mock-api'

await setupE2e()

// `POST /api/shop/orders` and `GET /api/shop/orders/{id}` (step 6.2, D99) on the built server and
// its seeded database: real sessions, the verified-email rule, idempotency keys and HTTP codes.

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin

/** Signs in through Better Auth; returns the session cookie. */
async function signIn(customer: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(customer) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

async function anOrder() {
  const menu = await (await fetch(url(`/api/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
  const bread = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.name === 'Banana Bread')!
  const lines = [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 2, note: 'Warm' }]
  const quote = await (await fetch(url('/api/public/checkout/quote'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ branchId: seed.openBranchId, lines }) })).json() as CheckoutQuote
  return { branchId: seed.openBranchId, lines, expectedTotalMinor: quote.totalMinor }
}

const post = (body: unknown, headers: Record<string, string>) =>
  fetch(url('/api/shop/orders'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body) })

describe('placing an order over HTTP', () => {
  it('a verified customer places it (201); the same key again answers 200 with the same order', async () => {
    const cookie = await signIn(seed.customers.verified)
    const body = await anOrder()
    const key = crypto.randomUUID()
    const first = await post(body, { cookie, 'idempotency-key': key })
    expect(first.status).toBe(201)
    const order = await first.json() as Order
    expect(order).toMatchObject({ status: 'awaiting_payment', orderType: 'pickup', branch: { name: 'Riverside' }, totalMinor: body.expectedTotalMinor })
    expect(order.pickupNumber).toBeGreaterThan(0)
    expect(order.lines[0]).toMatchObject({ itemName: 'Banana Bread', quantity: 2, note: 'Warm' })

    const again = await post(body, { cookie, 'idempotency-key': key })
    expect(again.status).toBe(200)
    expect((await again.json() as Order).id).toBe(order.id)

    const read = await fetch(url(`/api/shop/orders/${order.id}`), { headers: { cookie } })
    expect((await read.json() as Order).pickupNumber).toBe(order.pickupNumber)
  })

  it('refuses: signed out 401, email not verified 403, no key 400, a changed total 409', async () => {
    const body = await anOrder()
    expect((await post(body, { 'idempotency-key': crypto.randomUUID() })).status).toBe(401)
    const unverified = await signIn(seed.customers.unverified)
    const refused = await post(body, { 'cookie': unverified, 'idempotency-key': crypto.randomUUID() })
    expect([refused.status, (await refused.json()).data.code]).toEqual([403, 'EMAIL_NOT_VERIFIED'])
    const cookie = await signIn(seed.customers.reset)
    expect((await post(body, { cookie })).status).toBe(400)
    const changed = await post({ ...body, expectedTotalMinor: body.expectedTotalMinor + 1 }, { 'cookie': cookie, 'idempotency-key': crypto.randomUUID() })
    expect([changed.status, (await changed.json()).data.code]).toEqual([409, 'PRICES_CHANGED'])
  })

  it('someone else\'s order is 404', async () => {
    const owner = await signIn(seed.customers.reset)
    const order = await (await post(await anOrder(), { 'cookie': owner, 'idempotency-key': crypto.randomUUID() })).json() as Order
    const other = await signIn(seed.customers.verified)
    expect((await fetch(url(`/api/shop/orders/${order.id}`), { headers: { cookie: other } })).status).toBe(404)
  })
})
