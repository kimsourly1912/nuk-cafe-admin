import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { setupE2e } from './support/mock-api'
import { asNewVisitor, clientHeaders } from './support/client-address'

await setupE2e()

// The platform's page at the site's root (D221): the same static page for everyone, on the built
// server, no mocks. The server render names no cafe and links into none; signed out, Sign in leads
// to Your cafes. The browser then reads who is signed in and shows where the account works.

const seed = inject('shopSeed')
const origin = new URL(url('/')).origin

async function signInCookie(person: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(person) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

/** Every link's address on the page as it is now. */
const linksOf = (page: Page) => page.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''))

describe('the platform\'s page (D221)', () => {
  it('is one server-rendered page for everyone: no cafe, no session, nothing set', async () => {
    const cashier = seed.customers.cashier
    for (const cookie of [undefined, await signInCookie(cashier)]) {
      const response = await fetch(url('/'), { redirect: 'manual', headers: cookie ? { cookie } : {} })
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(response.headers.getSetCookie()).toEqual([])
      expect(html).toContain('Angder')
      expect(html).toContain('scan the QR code shared by your cafe')
      // The account is the browser's to read: the server renders a loading button, never a session.
      expect(html).not.toContain('Sign in')
      expect(html).toContain('Loading…')
      // No address of any cafe, and nothing of the account that sent the cookie.
      expect(html).not.toMatch(/href="\/c\//)
      expect(html).not.toContain(cashier.email)
      expect(html).not.toContain('Brown Bean')
    }
  })

  it('signed out, Sign in goes to sign-in for Your cafes, whose Back is home', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/'), { waitUntil: 'hydration' })
    expect(await page.title()).toBe('Angder')
    await page.getByRole('heading', { level: 1, name: 'A better way to order from your cafe' }).waitFor()
    expect((await linksOf(page)).filter(href => href.startsWith('/c/'))).toEqual([])

    await page.getByRole('link', { name: 'Sign in' }).click()
    await page.waitForURL(u => u.pathname === '/sign-in' && u.searchParams.get('redirect') === '/cafes')
    await page.getByRole('link', { name: 'Back to home' }).first().click()
    await page.waitForURL(u => u.pathname === '/')
    await page.getByRole('heading', { level: 1, name: 'A better way to order from your cafe' }).waitFor()
    await page.close()
  })

  async function signedInHome(person: { email: string, password: string }) {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/sign-in?redirect=/cafes'), { waitUntil: 'hydration' })
    await page.getByLabel('Email').fill(person.email)
    await page.getByLabel('Password', { exact: true }).fill(person.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(u => u.pathname === '/cafes')
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { level: 1, name: 'A better way to order from your cafe' }).waitFor()
    return page
  }

  it('signed in at one cafe\'s counter, opens it directly; the menu signs out back to Sign in', async () => {
    const cashier = seed.customers.cashier
    const page = await signedInHome(cashier)
    const open = page.getByRole('link', { name: /^Open counter, / })
    await open.waitFor()
    expect(await open.getAttribute('href')).toMatch(/^\/c\/[\w-]+\/counter$/)
    expect(await page.getByRole('link', { name: 'Sign in' }).count()).toBe(0)

    await page.getByRole('button', { name: /account: Sophea Keo/ }).click()
    await page.getByRole('menuitem', { name: 'Your cafes' }).waitFor()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.getByRole('link', { name: 'Sign in' }).waitFor()
    expect(await page.getByRole('link', { name: /^Open counter/ }).count()).toBe(0)
    await page.close()
  })

  it('signed in as a customer, only the account menu: no workspace to open', async () => {
    const page = await signedInHome(seed.customers.verified)
    await page.getByRole('button', { name: /account: Dara Sok/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).waitFor()
    expect(await page.getByRole('menuitem', { name: 'Your cafes' }).count()).toBe(0)
    expect((await linksOf(page)).filter(href => href.startsWith('/c/') || href === '/cafes')).toEqual([])
    await page.close()
  })

  it('fits a 320px phone: no sideways scrolling, Sign in on screen', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { level: 1, name: 'A better way to order from your cafe' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    const signIn = await page.getByRole('link', { name: 'Sign in' }).boundingBox()
    expect(signIn).not.toBeNull()
    expect(signIn!.y + signIn!.height).toBeLessThanOrEqual(640)
    await page.close()
  })

  it('signed in, still fits a 320px phone: the place to work and light/dark move into the account menu', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 320, height: 640 })
    // The longest button: a platform team account (the seed has none; the browser's reads are faked).
    await page.route('**/api/auth/get-session', route => route.fulfill({ json: { session: {}, user: { name: 'Ops Team', email: 'ops@example.com', role: 'superadmin', emailVerified: true } } }))
    await page.route('**/api/me/cafes', route => route.fulfill({ json: [] }))
    await page.goto(url('/'), { waitUntil: 'hydration' })
    const account = page.getByRole('button', { name: /account: Ops Team/ })
    await account.waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    expect(await page.getByRole('link', { name: 'Platform console' }).isVisible()).toBe(false)
    expect(await page.getByRole('button', { name: /^Switch to (dark|light) mode$/ }).isVisible()).toBe(false)

    await account.click()
    expect(await page.getByRole('menuitem', { name: 'Platform console' }).getAttribute('href')).toBe('/platform')
    await page.getByRole('menuitemcheckbox', { name: 'Dark' }).click()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    await page.close()
  })
})
