import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { CheckoutQuote } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import type { SeedCustomer } from './support/seed'
import { asNewVisitor, clientHeaders } from './support/client-address'
import { setupE2e, toast } from './support/mock-api'

await setupE2e()

// Pausing online orders from the counter (D199) against the e2e server's seeded database, at Zulu
// Pop-up (open around the clock, where no other file orders): its manager pauses, the counter shows
// it, checkout refuses it, Resume ends it. Each test ends with the branch resumed.

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin
const branchId = seed.popupBranchId
const counterHome = `/c/nuk/counter/${branchId}`

async function cookieOf(account: SeedCustomer) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(account) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

const post = (path: string, cookie: string, body?: unknown) => fetch(url(`/api/c/nuk/counter/${path}`), {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin, cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
})

/** A one-line quote at Zulu Pop-up, as checkout asks for it. */
async function quote(): Promise<CheckoutQuote> {
  const menu = await (await fetch(url(`/api/c/nuk/public/menu?branchId=${branchId}`))).json() as PublicMenu
  const item = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => !i.soldOut && i.variations.length === 1)!
  const lines = [{ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, note: null }]
  const response = await fetch(url('/api/c/nuk/public/checkout/quote'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ branchId, lines }) })
  expect(response.status).toBe(200)
  return await response.json() as CheckoutQuote
}

async function atCounter(width = 1180) {
  const page = await createPage()
  await asNewVisitor(page)
  await page.setViewportSize({ width, height: width < 640 ? 844 : 820 })
  await page.goto(url('/c/nuk/counter'), { waitUntil: 'hydration' })
  await page.waitForURL(u => u.pathname === '/c/nuk/counter/sign-in')
  await page.getByLabel('Email').fill(seed.customers.popupManager.email)
  await page.getByLabel('Password', { exact: true }).fill(seed.customers.popupManager.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(u => u.pathname === counterHome)
  return page
}

async function pauseFromManage(page: Page, choice: string, reason?: string) {
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitem', { name: 'Pause online orders…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Pause online orders' })
  await dialog.getByRole('radio', { name: choice }).click()
  if (reason) await dialog.getByLabel(/^Reason/).fill(reason)
  await dialog.getByRole('button', { name: 'Pause orders' }).click()
  await dialog.waitFor({ state: 'hidden' })
}

describe('pausing online orders at the counter (D199)', () => {
  it('a manager pauses from Manage: the queue and header say so, checkout refuses, Resume ends it', async () => {
    const page = await atCounter()
    await page.getByText('Open', { exact: true }).first().waitFor()
    await pauseFromManage(page, '30 minutes', 'Machine broken')
    // The toast and the banner share the words.
    await toast(page, /^Online orders paused until/).first().waitFor()

    const banner = page.getByRole('status').filter({ hasText: 'Online orders paused until' })
    await banner.getByText('By Rina Sok · Machine broken', { exact: false }).waitFor()
    await page.getByText('Paused', { exact: true }).first().waitFor()
    expect((await quote()).problems.map(p => p.code)).toEqual(['ORDERING_PAUSED'])

    // The menu offers Resume instead of Pause while paused.
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('menuitem', { name: 'Resume online orders' }).waitFor()
    await page.keyboard.press('Escape')

    await banner.getByRole('button', { name: 'Resume now' }).click()
    await toast(page, 'Online orders are on again').waitFor()
    await banner.waitFor({ state: 'hidden' })
    await page.getByText('Open', { exact: true }).first().waitFor()
    expect((await quote()).orderable).toBe(true)
  })

  it('the server: staff 403, a manager of another branch 404, and the pause read back (customers see only its end)', async () => {
    const cashier = await cookieOf(seed.customers.cashier)
    const riverside = await cookieOf(seed.customers.manager)
    const popup = await cookieOf(seed.customers.popupManager)
    expect((await post(`${seed.openBranchId}/pause`, cashier, { for: '15m' })).status).toBe(403)
    expect((await post(`${branchId}/pause`, riverside, { for: '15m' })).status).toBe(404)

    const paused = await post(`${branchId}/pause`, popup, { for: '15m', reason: 'Rush' })
    expect(paused.status).toBe(200)
    const body = await paused.json() as { pausedUntil: string, reason: string, pausedByName: string }
    expect(body).toMatchObject({ reason: 'Rush', pausedByName: 'Rina Sok' })
    expect(Date.parse(body.pausedUntil) - Date.now()).toBeGreaterThan(14 * 60_000)
    // Customers see only when it's back.
    const branches = await (await fetch(url('/api/c/nuk/public/branches'))).json() as { id: string, pausedUntil: string | null }[]
    expect(branches.find(b => b.id === branchId)).toEqual(expect.objectContaining({ pausedUntil: body.pausedUntil }))
    expect(JSON.stringify(branches)).not.toContain('Rina')

    expect((await post(`${branchId}/resume`, popup)).status).toBe(200)
    expect((await quote()).orderable).toBe(true)
  })

  it('customers see it on the menu: not taking online orders, back at the end, adding off; then open again', async () => {
    const popup = await cookieOf(seed.customers.popupManager)
    expect((await post(`${branchId}/pause`, popup, { for: '15m' })).status).toBe(200)
    try {
      const page = await createPage()
      await asNewVisitor(page)
      await page.addInitScript(id => localStorage.setItem('nuk-cafe:branch', id), branchId)
      await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
      await page.getByText('Not taking online orders right now', { exact: true }).waitFor()
      await page.getByText(/^Back at \d{1,2}:\d{2} (AM|PM)$/).first().waitFor()
      const add = page.getByRole('button', { name: /^Add .+ to order$/ }).filter({ visible: true }).first()
      expect(await add.isDisabled()).toBe(true)
    }
    finally {
      expect((await post(`${branchId}/resume`, popup)).status).toBe(200)
    }
    const page = await createPage()
    await asNewVisitor(page)
    await page.addInitScript(id => localStorage.setItem('nuk-cafe:branch', id), branchId)
    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: /^Add .+ to order$/ }).filter({ visible: true }).first().waitFor()
    expect(await page.getByText('Not taking online orders right now').count()).toBe(0)
  })

  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
  async function axeFindings(page: Page): Promise<string[]> {
    await page.evaluate(axeSource)
    return page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string, nodes: { target: string[] }[] }[] }> } }).axe
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).slice(0, 4).join(', ')}`)
    })
  }
  async function bothModes(page: Page) {
    // The pointer rests where the last click was: a hovered control isn't what's measured.
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
    // Colours ease between the modes: measure once they have settled.
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  it.each([1180, 390])('the dialog and the paused queue meet the rules in light and dark and fit at %ipx', { timeout: 60_000 }, async (width) => {
    const page = await atCounter(width)
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('menuitem', { name: 'Pause online orders…' }).click()
    await page.getByRole('dialog', { name: 'Pause online orders' }).getByRole('radio', { name: '15 minutes' }).waitFor()
    await bothModes(page)
    await page.getByRole('dialog', { name: 'Pause online orders' }).getByRole('button', { name: 'Pause orders' }).click()
    const banner = page.getByRole('status').filter({ hasText: 'Online orders paused until' })
    await banner.waitFor()
    await bothModes(page)
    await banner.getByRole('button', { name: 'Resume now' }).click()
    await banner.waitFor({ state: 'hidden' })
  })
})
