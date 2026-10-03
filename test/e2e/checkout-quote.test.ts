import { url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote } from '#shared/contracts/orders'
import type { PublicMenu, PublicMenuItem } from '#shared/contracts/public-menu'
import { setupE2e } from './support/mock-api'

await setupE2e()

// `POST /api/public/checkout/quote` (step 6.1, D98) on the built server and its seeded database
// (support/seed.ts, the Standard sample menu): the route as a browser on the site reaches it.

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin

const post = (body: unknown, headers: Record<string, string> = { origin }) =>
  fetch(url('/api/c/nuk/public/checkout/quote'), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

async function menuItem(name: string): Promise<PublicMenuItem> {
  const menu = await (await fetch(url(`/api/c/nuk/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
  return menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.name === name)!
}

describe('the checkout quote route', () => {
  it('prices the lines from the menu, per line, with the total', async () => {
    const bread = await menuItem('Banana Bread')
    const response = await post({ branchId: seed.openBranchId, lines: [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 3, note: ' Warm please ' }] })
    expect(response.status).toBe(200)
    const quote = await response.json() as CheckoutQuote
    const unit = bread.variations[0]!.priceMinor
    expect(quote.lines[0]).toMatchObject({ name: 'Banana Bread', unitPriceMinor: unit, totalMinor: unit * 3, note: 'Warm please', problem: null })
    expect(quote).toMatchObject({ totalMinor: unit * 3, orderable: true, branch: { name: 'Riverside', openNow: true } })
  })

  it('a closed branch is priced but not orderable', async () => {
    const bread = await menuItem('Banana Bread')
    const quote = await (await post({ branchId: seed.closedBranchId, lines: [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 1 }] })).json() as CheckoutQuote
    expect(quote.problems.map(p => p.code)).toEqual(['BRANCH_CLOSED'])
    expect(quote.orderable).toBe(false)
  })

  it('refuses a request from another site, a bad body, and an unknown branch', async () => {
    const bread = await menuItem('Banana Bread')
    const lines = [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 1 }]
    expect((await post({ branchId: seed.openBranchId, lines }, { origin: 'https://evil.example' })).status).toBe(403)
    const invalid = await post({ branchId: seed.openBranchId, lines: [{ ...lines[0], quantity: 21, unitPriceMinor: 1 }] })
    expect(invalid.status).toBe(400)
    expect(Object.keys((await invalid.json()).data.fieldErrors ?? {}).length).toBeGreaterThan(0)
    expect((await post({ branchId: '01990000-0000-7000-8000-000000000000', lines })).status).toBe(404)
  })
})
