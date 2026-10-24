import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { SeedCustomer } from './support/seed'
import { asNewVisitor, clientHeaders } from './support/client-address'
import { setupE2e, toast } from './support/mock-api'

await setupE2e()

// A manager's tools on the counter (D198) against the e2e server's seeded database: Riverside's
// manager opens Manage → Dining tables and Reports, on the counter's API; the cashier (staff at
// Riverside) gets neither, in the header or by address.

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin
const counterHome = `/c/nuk/counter/${seed.openBranchId}`

/** Signs in at /counter; with one branch, the queue opens. Collects the API paths the page asks. */
async function atCounter(account: SeedCustomer, width = 1180) {
  const page = await createPage()
  await asNewVisitor(page)
  const api: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/c/nuk/')) api.push(path.slice('/api/c/nuk'.length))
  })
  await page.setViewportSize({ width, height: width < 640 ? 844 : 820 })
  await page.goto(url('/c/nuk/counter'), { waitUntil: 'hydration' })
  await page.waitForURL(u => u.pathname === '/c/nuk/counter/sign-in')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(u => u.pathname === counterHome)
  return { page, api }
}

async function openManage(page: Page, item: string) {
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function cookieOf(account: SeedCustomer) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(account) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

describe('manager tools on the counter (D198)', () => {
  it('a manager adds a table with its QR code from Manage → Dining tables, on the counter\'s API', async () => {
    const { page, api } = await atCounter(seed.customers.manager)
    await openManage(page, 'Dining tables')
    await page.waitForURL(u => u.pathname === `${counterHome}/tables`)
    await page.getByRole('article', { name: 'T01', exact: true }).waitFor()

    const label = `M${crypto.randomUUID().slice(0, 4)}`
    await page.getByRole('button', { name: 'New table' }).click()
    const dialog = page.getByRole('dialog', { name: 'New table' })
    await dialog.getByLabel('Name', { exact: true }).fill(label)
    await dialog.getByRole('button', { name: 'Add table' }).click()
    await toast(page, `Table "${label}" added`).waitFor()
    const card = page.getByRole('article', { name: label, exact: true })
    await card.waitFor()
    // Archived again, so no other file sees an extra table at Riverside.
    await card.getByRole('button', { name: `Actions for ${label}` }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await toast(page, `Table "${label}" archived`).waitFor()
    // Delete permanently is the owners' (D200): a manager's archived table offers Restore only.
    await page.getByRole('tab', { name: /Archived/ }).click()
    await page.getByRole('article', { name: label, exact: true }).getByRole('button', { name: `Actions for ${label}` }).click()
    await page.getByRole('menuitem', { name: 'Restore' }).waitFor()
    expect(await page.getByRole('menuitem', { name: /Delete/ }).count()).toBe(0)
    await page.keyboard.press('Escape')

    expect(api.filter(path => path.includes('/tables'))).not.toEqual([])
    expect(api.filter(path => path.startsWith('/admin/'))).toEqual([])
    await page.getByRole('link', { name: 'Back to queue' }).click()
    await page.waitForURL(u => u.pathname === counterHome)
  })

  it('a manager reads the branch\'s reports to view and print, without CSV or Telegram', async () => {
    const { page, api } = await atCounter(seed.customers.manager)
    await openManage(page, 'Reports')
    await page.waitForURL(u => u.pathname === `${counterHome}/reports/summary`)
    await page.getByRole('button', { name: 'Print' }).waitFor()
    await page.getByText('Riverside ·', { exact: false }).first().waitFor()
    expect(await page.getByRole('button', { name: 'Download CSV' }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Send to Telegram' }).count()).toBe(0)

    await page.getByRole('tab', { name: 'Order history' }).click()
    await page.waitForURL(u => u.pathname === `${counterHome}/reports/orders`)
    await page.getByRole('button', { name: 'Print' }).waitFor()

    expect(api.some(path => path === `/counter/${seed.openBranchId}/reports/summary`)).toBe(true)
    expect(api.filter(path => path.startsWith('/admin/'))).toEqual([])
  })

  it('staff see no Manage, and opening a manager\'s page by address is refused', async () => {
    const { page } = await atCounter(seed.customers.cashier)
    await page.getByRole('link', { name: 'Sold out' }).waitFor()
    expect(await page.getByRole('button', { name: 'Manage' }).count()).toBe(0)
    await page.goto(url(`${counterHome}/tables`), { waitUntil: 'hydration' })
    await page.getByText('Could not load the tables').waitFor()
    expect(await page.getByRole('article').count()).toBe(0)
  })

  it('the server: staff 403, another branch 404, and a report reads the path\'s branch whatever the query says', async () => {
    const staff = await cookieOf(seed.customers.cashier)
    const manager = await cookieOf(seed.customers.manager)
    const get = (path: string, cookie: string) => fetch(url(`/api/c/nuk/counter/${path}`), { headers: { cookie } })

    expect((await get(`${seed.openBranchId}/tables`, staff)).status).toBe(403)
    expect((await get(`${seed.openBranchId}/reports/branches`, staff)).status).toBe(403)
    expect((await get(`${seed.closedBranchId}/tables`, manager)).status).toBe(404)
    expect((await get(`${seed.openBranchId}/tables`, manager)).status).toBe(200)

    const today = await (await get(`${seed.openBranchId}/reports/branches`, manager)).json() as { id: string, today: string }[]
    expect(today.map(b => b.id)).toEqual([seed.openBranchId])
    const summary = await get(`${seed.openBranchId}/reports/summary?branchId=${seed.closedBranchId}&from=${today[0]!.today}&to=${today[0]!.today}`, manager)
    expect(summary.status).toBe(200)
    expect((await summary.json() as { branch: { id: string } }).branch.id).toBe(seed.openBranchId)
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

  it.each([1180, 390])('Manage, Dining tables and the Summary meet the rules in light and dark and fit at %ipx', { timeout: 60_000 }, async (width) => {
    const { page } = await atCounter(seed.customers.manager, width)
    await page.getByRole('button', { name: 'Manage' }).waitFor()
    await bothModes(page)
    await openManage(page, 'Dining tables')
    await page.getByRole('article', { name: 'T01', exact: true }).waitFor()
    await bothModes(page)
    await page.goto(url(`${counterHome}/reports/summary`), { waitUntil: 'hydration' })
    await page.getByRole('tab', { name: 'Summary' }).waitFor()
    await page.getByText('Riverside ·', { exact: false }).first().waitFor()
    await bothModes(page)
  })
})
