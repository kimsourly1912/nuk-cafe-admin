import { url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote, CounterOrder, CounterQueue, Order } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { setupE2e } from './support/mock-api'
import { clientHeaders } from './support/client-address'

await setupE2e()

// The counter's order routes (step 6.3, D101) on the built server and its seeded database: real
// sessions and branch membership, the permission each command needs, idempotency keys and HTTP
// codes. The rules themselves are covered by the server tests (counter.service.test.ts).

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin
const counter = (path = '') => url(`/api/c/nuk/counter/${seed.openBranchId}/orders${path}`)

/** Signs in through Better Auth; returns the session cookie. */
async function signIn(account: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(account) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

const send = (path: string, cookie: string, body: unknown, key: string | null = crypto.randomUUID()) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) })

/** An order placed by the seeded counter customer (Banana Bread at Riverside). */
async function placeOrder(cookie: string) {
  const menu = await (await fetch(url(`/api/c/nuk/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
  const bread = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.name === 'Banana Bread')!
  const lines = [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 1, note: null }]
  const quote = await (await fetch(url('/api/c/nuk/public/checkout/quote'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ branchId: seed.openBranchId, lines }) })).json() as CheckoutQuote
  const response = await send(url('/api/c/nuk/shop/orders'), cookie, { branchId: seed.openBranchId, lines, expectedTotalMinor: quote.totalMinor })
  expect(response.status).toBe(201)
  return await response.json() as Order
}

describe('the counter over HTTP', () => {
  it('a cashier sees the order, takes payment, marks it ready and completes it; a retry answers the same', async () => {
    const customer = await signIn(seed.customers.counterCustomer)
    const placed = await placeOrder(customer)
    const cashier = await signIn(seed.customers.cashier)

    const queue = await (await fetch(counter(), { headers: { cookie: cashier } })).json() as CounterQueue
    const inQueue = queue.orders.find(order => order.id === placed.id)!
    expect(inQueue).toMatchObject({ status: 'awaiting_payment', version: 1, customer: { name: 'Pisey Ly' }, payment: null })

    // A command without an Idempotency-Key is refused.
    expect((await send(counter(`/${placed.id}/pay`), cashier, { version: 1, method: 'cash_usd' }, null)).status).toBe(400)

    const key = crypto.randomUUID()
    const paid = await send(counter(`/${placed.id}/pay`), cashier, { version: 1, method: 'cash_usd' }, key)
    expect(paid.status).toBe(200)
    const paidOrder = await paid.json() as CounterOrder
    expect(paidOrder).toMatchObject({ status: 'preparing', version: 2, payment: { method: 'cash_usd', collectedBy: { name: 'Sophea Keo' } } })
    // The same key again: the same answer, still one payment.
    expect(await (await send(counter(`/${placed.id}/pay`), cashier, { version: 1, method: 'cash_usd' }, key)).json()).toEqual(paidOrder)
    // Another key: the order moved on.
    const again = await send(counter(`/${placed.id}/pay`), cashier, { version: 1, method: 'cash_usd' })
    expect([again.status, (await again.json()).data.code]).toEqual([409, 'ORDER_CHANGED'])

    expect((await (await send(counter(`/${placed.id}/ready`), cashier, { version: 2 })).json()).status).toBe('ready')
    const cancel = await send(counter(`/${placed.id}/cancel`), cashier, { version: 3, reason: 'customer_changed_mind', returnMethod: 'cash' })
    expect([cancel.status, (await cancel.json()).data.code]).toEqual([409, 'ORDER_NOT_CANCELLABLE'])
    expect((await (await send(counter(`/${placed.id}/complete`), cashier, { version: 3 })).json()).status).toBe('completed')

    // The customer sees it too.
    const mine = await (await fetch(url(`/api/c/nuk/shop/orders/${placed.id}`), { headers: { cookie: customer } })).json() as Order
    expect(mine.status).toBe('completed')
    const single = await (await fetch(counter(`/${placed.id}`), { headers: { cookie: cashier } })).json() as CounterOrder
    expect(single.status).toBe('completed')
  })

  it('a customer, or staff of another branch, doesn\'t reach the counter: 404, like an unknown branch; signed out: 401', async () => {
    const customer = await signIn(seed.customers.counterCustomer)
    expect((await fetch(counter(), { headers: { cookie: customer } })).status).toBe(404)
    const cashier = await signIn(seed.customers.cashier)
    expect((await fetch(url(`/api/c/nuk/counter/${seed.closedBranchId}/orders`), { headers: { cookie: cashier } })).status).toBe(404)
    expect((await fetch(counter())).status).toBe(401)
  })

  it('a cancelled unpaid order needs a reason; "Other" needs words', async () => {
    const customer = await signIn(seed.customers.counterCustomer)
    const placed = await placeOrder(customer)
    const cashier = await signIn(seed.customers.cashier)
    const refused = await send(counter(`/${placed.id}/cancel`), cashier, { version: 1, reason: 'other' })
    expect([refused.status, Object.keys((await refused.json()).data.fieldErrors)]).toEqual([400, ['note']])
    const cancelled = await send(counter(`/${placed.id}/cancel`), cashier, { version: 1, reason: 'other', note: 'Left the cafe' })
    expect((await cancelled.json()).status).toBe('cancelled')
  })
})
