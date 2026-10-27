import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { Promotion } from '#shared/contracts/menu-promotions'
import type { CheckoutQuote, Order } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { asNewVisitor, clientHeaders } from './support/client-address'
import { ADMIN, menuItemSummaryOf, mockApi, pageOf, RIVERSIDE, setupE2e, staffOf } from './support/mock-api'

// An accessibility check (D152): axe-core's WCAG 2.1 A and AA rules on the main pages, at a
// desktop and a phone width. Admin pages on mocked data; the customer menu and the counter on the
// seeded server. A finding names the rule and the elements; fix it rather than skipping the rule.
await setupE2e()

const seed = inject('shopSeed')
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/** axe's findings on the page as it is now: `rule: element, element…`. */
async function findings(page: Page): Promise<string[]> {
  // Evaluated through the browser's protocol: the production CSP doesn't apply.
  await page.evaluate(axeSource)
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string, nodes: { target: string[] }[] }[] }> } }).axe
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target.join(' ')) }))
  })
  return violations.map(v => `${v.id}: ${v.targets.slice(0, 4).join(', ')}${v.targets.length > 4 ? ` (+${v.targets.length - 4})` : ''}`)
}

const WIDTHS = [1440, 390]
const origin = new URL(url('/')).origin

/** One order in the queue, placed once over HTTP, so the counter is checked with a card on it. */
let ordered: Promise<Order> | undefined
async function placeOrder(): Promise<Order> {
  const account = seed.customers.a11yGuest
  const signIn = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify({ email: account.email, password: account.password }) })
  expect(signIn.status).toBe(200)
  const cookie = signIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const menu = await (await fetch(url(`/api/c/nuk/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
  const bread = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(sub => sub.items)]).find(i => i.name === 'Banana Bread')!
  const lines = [{ itemId: bread.id, variationId: bread.variations[0]!.id, quantity: 1, note: '' }]
  const quote = await (await fetch(url('/api/c/nuk/public/checkout/quote'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ branchId: seed.openBranchId, lines }) })).json() as CheckoutQuote
  const response = await fetch(url('/api/c/nuk/shop/orders'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ branchId: seed.openBranchId, lines, expectedTotalMinor: quote.totalMinor }),
  })
  expect(response.status).toBe(201)
  return await response.json() as Order
}

const ADMIN_PAGES: { path: string, ready: (page: Page) => Promise<unknown> }[] = [
  { path: '/c/nuk/admin', ready: page => page.getByRole('heading', { level: 1 }).first().waitFor() },
  { path: '/c/nuk/admin/products', ready: page => page.getByRole('article', { name: 'Latte' }).first().waitFor() },
  { path: '/c/nuk/admin/categories', ready: page => page.getByRole('listitem', { name: 'Tea', exact: true }).waitFor() },
  { path: '/c/nuk/admin/staff', ready: page => page.getByText('Sophea').first().waitFor() },
  // The small libraries, empty: their empty states.
  { path: '/c/nuk/admin/options', ready: page => page.getByRole('button', { name: 'New option set' }).first().waitFor() },
  { path: '/c/nuk/admin/add-ons', ready: page => page.getByRole('button', { name: 'New add-on group' }).first().waitFor() },
  // Promotions (D163): the library, the editor and a promotion's page.
  { path: '/c/nuk/admin/promotions', ready: page => page.getByRole('link', { name: 'Coffee week' }).waitFor() },
  { path: '/c/nuk/admin/promotions/new', ready: page => page.getByRole('heading', { name: 'How customers see it' }).waitFor() },
  { path: '/c/nuk/admin/promotions/promo-1', ready: page => page.getByRole('link', { name: 'View post in NUK Cafe News' }).waitFor() },
  // Channels (M2a, D164): a connected channel and one the bot was removed from.
  { path: '/c/nuk/admin/channels', ready: page => page.getByText('Bot removed').waitFor() },
]

const COFFEE_WEEK: Promotion = {
  id: 'promo-1', name: 'Coffee week', description: 'Every coffee 20% off.', status: 'published', phase: 'live', discount: { kind: 'percent', percent: 20 }, label: '20% off',
  scope: 'selected', items: [], categories: [{ id: 'cat-2', name: 'Coffee', status: 'active' }], branches: [], startsOn: '2026-10-01', endsOn: null,
  poster: null, endedAt: null, version: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
}

const ADMIN_MOCKS = {
  'GET /admin/menu/items': () => pageOf([menuItemSummaryOf('item-1', 'Latte', { status: 'active', categoryName: 'Coffee' })]),
  'GET /admin/staff': () => pageOf([staffOf(ADMIN.userId, 'alice', { email: ADMIN.email, admin: true, memberships: [] }), staffOf('staff-2', 'Sophea')]),
  'GET /admin/branches/options': () => [RIVERSIDE],
  'GET /admin/menu/promotions': () => [COFFEE_WEEK],
  'GET /admin/menu/promotions/{id}': () => COFFEE_WEEK,
  'GET /admin/menu/promotions/{id}/results': () => ({ orders: 12, units: 30, discountMinor: 2100, salesMinor: 8400, bySource: { telegram: 3, facebook: 0 } }),
  'GET /admin/menu/promotions/{id}/posts': () => [{ id: 'post-1', promotionId: 'promo-1', channel: { id: 'ch-1', title: 'NUK Cafe News', kind: 'telegram_channel' }, status: 'sent', caption: 'Coffee week: 20% off', withPoster: true, scheduledAt: '2026-10-11T03:00:00.000Z', attempts: 1, sentAt: '2026-10-11T03:00:05.000Z', url: 'https://t.me/nukcafe/101', reason: null, createdBy: 'alice', createdAt: '2026-10-11T03:00:00.000Z', version: 2 }],
  'GET /admin/marketing/channels': () => ({ telegram: { enabled: true, botUsername: 'NukCafeBot' }, channels: [{ id: 'ch-1', kind: 'telegram_channel', title: 'NUK Cafe News', username: 'nukcafe', subscriberCount: 1250, status: 'connected', connectedBy: 'alice', connectedAt: '2026-10-11T03:00:00.000Z', version: 1 }, { id: 'ch-2', kind: 'telegram_channel', title: 'Old channel', username: null, subscriberCount: null, status: 'removed', connectedBy: null, connectedAt: '2026-10-01T03:00:00.000Z', version: 2 }] }),
}

describe('accessibility (axe, WCAG 2.1 AA)', () => {
  for (const width of WIDTHS) {
    for (const target of ADMIN_PAGES) {
      it(`${target.path} at ${width}px`, async () => {
        const page = await createPage()
        await page.setViewportSize({ width, height: 900 })
        await mockApi(page, ADMIN_MOCKS)
        await page.goto(url(target.path), { waitUntil: 'hydration' })
        await target.ready(page)
        expect(await findings(page)).toEqual([])
      })
    }

    it(`the platform's page at ${width}px`, async () => {
      const page = await createPage()
      await page.setViewportSize({ width, height: 900 })
      await page.goto(url('/'), { waitUntil: 'hydration' })
      await page.getByRole('heading', { level: 1, name: 'Angder' }).waitFor()
      expect(await findings(page)).toEqual([])
    })

    it(`the customer menu at ${width}px`, async () => {
      const page = await createPage()
      await page.setViewportSize({ width, height: 900 })
      await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
      await page.getByRole('heading', { level: 2 }).first().waitFor()
      expect(await findings(page)).toEqual([])
    })

    it(`the counter's queue at ${width}px, with an order on it`, async () => {
      const order = await (ordered ??= placeOrder())
      const page = await createPage()
      await asNewVisitor(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto(url('/c/nuk/counter'), { waitUntil: 'hydration' })
      await page.getByLabel('Email').fill(seed.customers.cashier.email)
      await page.getByLabel('Password', { exact: true }).fill(seed.customers.cashier.password)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForURL(u => u.pathname === `/c/nuk/counter/${seed.openBranchId}`)
      await page.getByRole('button', { name: `Open order ${String(order.pickupNumber).padStart(3, '0')}` }).first().waitFor()
      // The pointer stays where Sign in was clicked; at 390px the queue's Take payment lands under it, and its hover colour isn't what's measured.
      await page.mouse.move(0, 0)
      expect(await findings(page)).toEqual([])
    })
  }
})
