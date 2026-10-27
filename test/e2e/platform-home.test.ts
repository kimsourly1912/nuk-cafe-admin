import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { setupE2e } from './support/mock-api'
import { asNewVisitor, clientHeaders } from './support/client-address'

await setupE2e()

// The platform's page at the site's root (D221): the same static page for everyone, on the built
// server, no mocks. It names no cafe, links into none, and Sign in leads to Your cafes.

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
      expect(html).toContain('Scan the QR on your table')
      expect(html).toContain('href="/cafes"')
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
    await page.getByRole('heading', { level: 1, name: 'Angder' }).waitFor()
    expect((await linksOf(page)).filter(href => href.startsWith('/c/'))).toEqual([])

    await page.getByRole('link', { name: 'Sign in' }).click()
    await page.waitForURL(u => u.pathname === '/sign-in' && u.searchParams.get('redirect') === '/cafes')
    await page.getByRole('link', { name: 'Back to home' }).first().click()
    await page.waitForURL(u => u.pathname === '/')
    await page.getByRole('heading', { level: 1, name: 'Angder' }).waitFor()
    await page.close()
  })

  it('signed in, the same page, and Sign in opens Your cafes', async () => {
    const cashier = seed.customers.cashier
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/sign-in?redirect=/cafes'), { waitUntil: 'hydration' })
    await page.getByLabel('Email').fill(cashier.email)
    await page.getByLabel('Password', { exact: true }).fill(cashier.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(u => u.pathname === '/cafes')

    await page.goto(url('/'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { level: 1, name: 'Angder' }).waitFor()
    expect((await linksOf(page)).filter(href => href.startsWith('/c/'))).toEqual([])
    await page.getByRole('link', { name: 'Sign in' }).click()
    await page.waitForURL(u => u.pathname === '/cafes')
    await page.getByRole('link', { name: /Counter/ }).first().waitFor()
    await page.close()
  })

  it('fits a 320px phone: no sideways scrolling, Sign in on screen', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { level: 1, name: 'Angder' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    const signIn = await page.getByRole('link', { name: 'Sign in' }).boundingBox()
    expect(signIn).not.toBeNull()
    expect(signIn!.y + signIn!.height).toBeLessThanOrEqual(640)
    await page.close()
  })
})
