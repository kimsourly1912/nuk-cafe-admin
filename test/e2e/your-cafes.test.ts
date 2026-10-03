import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { AccountCafe } from '../../shared/contracts/cafe'
import { ADMIN, failures, mockApi, NUK_PROFILE, setupE2e, SIGNED_OUT } from './support/mock-api'

await setupE2e()

// Your cafes and the cafe switcher (T2c, D144): an account that works at more than one cafe finds
// them all, and moves between them as a full page load.

const NUK: AccountCafe = { ...NUK_PROFILE, workspaces: ['admin', 'counter'] }
const BROWN: AccountCafe = { slug: 'brown-bean', name: 'Brown Bean', logoUrl: '/media/t/tenant-2/logo.webp', status: 'active', workspaces: ['admin', 'counter'] }
const KIOSK: AccountCafe = { slug: 'tea-kiosk', name: 'Tea Kiosk', logoUrl: null, status: 'active', workspaces: ['counter'] }
const QUIET: AccountCafe = { slug: 'quiet-corner', name: 'Quiet Corner', logoUrl: null, status: 'suspended', workspaces: ['admin', 'counter'] }

async function openAdmin(cafes: AccountCafe[]) {
  const page = await createPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  // The other cafe's admin answers for itself after the switch.
  await mockApi(page, { 'GET /me/cafes': () => cafes, 'GET /cafes/brown-bean': () => ({ ...NUK_PROFILE, slug: 'brown-bean', name: 'Brown Bean' }) })
  await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
  return page
}

const switcher = (page: Page) => page.getByRole('button', { name: 'NUK Cafe Admin: cafe menu' })

describe('the cafe switcher', () => {
  it('opens the admin of another cafe the account owns, as a full page load; Your cafes from there too', async () => {
    const page = await openAdmin([BROWN, NUK, KIOSK, QUIET])
    await switcher(page).click()
    const brown = page.getByRole('menuitem', { name: /Brown Bean/ })
    expect(await brown.getAttribute('href')).toBe('/c/brown-bean/admin')
    // Only cafes whose admin opens: not the counter-only one, not a paused one, not this one.
    expect(await page.getByRole('menuitem', { name: /Tea Kiosk|Quiet Corner|NUK Cafe/ }).count()).toBe(0)
    expect(await page.getByRole('menuitem', { name: 'All your cafes' }).getAttribute('href')).toBe('/cafes')

    // A full page load: the other cafe's admin starts from its own session, never this one's.
    await brown.click()
    await page.waitForURL(address => address.pathname === '/c/brown-bean/admin')
    await page.getByRole('button', { name: 'Brown Bean Admin: cafe menu' }).waitFor()
    expect(await page.evaluate(() => new URL((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).name).pathname)).toBe('/c/brown-bean/admin')
  })

  it('is a menu with one cafe too: the customer menu in a new tab and Your cafes, nothing to switch to', async () => {
    const page = await openAdmin([NUK])
    await switcher(page).click()
    const view = page.getByRole('menuitem', { name: /View menu/ })
    expect([await view.getAttribute('href'), await view.getAttribute('target')]).toEqual(['/c/nuk', '_blank'])
    expect(await page.getByRole('menuitem', { name: 'All your cafes' }).getAttribute('href')).toBe('/cafes')
    expect(await page.getByText('Switch cafe').count()).toBe(0)
  })

  it('the sidebar opens the customer menu in a new tab', async () => {
    const page = await openAdmin([NUK])
    const view = page.getByRole('link', { name: 'View menu (opens in a new tab)' })
    expect([await view.getAttribute('href'), await view.getAttribute('target')]).toEqual(['/c/nuk', '_blank'])
    const [tab] = await Promise.all([page.context().waitForEvent('page'), view.click()])
    await tab.waitForLoadState()
    expect(new URL(tab.url()).pathname).toBe('/c/nuk')
  })
})

describe('Your cafes', () => {
  async function open(cafes: AccountCafe[] | (() => never)) {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, { 'GET /me/cafes': typeof cafes === 'function' ? cafes : () => cafes })
    await page.goto(url('/cafes'), { waitUntil: 'hydration' })
    return page
  }

  it('lists each cafe with the workspaces the account may open; a paused one without them', async () => {
    const page = await open([BROWN, NUK, KIOSK, QUIET])
    await page.getByRole('heading', { name: 'Your cafes' }).waitFor()
    expect(await page.getByRole('link', { name: 'Admin, Brown Bean' }).getAttribute('href')).toBe('/c/brown-bean/admin')
    expect(await page.getByRole('link', { name: 'Counter, Brown Bean' }).getAttribute('href')).toBe('/c/brown-bean/counter')
    expect(await page.getByRole('link', { name: 'Counter, Tea Kiosk' }).getAttribute('href')).toBe('/c/tea-kiosk/counter')
    expect(await page.getByRole('link', { name: 'Admin, Tea Kiosk' }).count()).toBe(0)
    await page.getByText('Paused by the platform team').waitFor()
    expect(await page.getByRole('link', { name: /Quiet Corner/ }).count()).toBe(0)
    await expect.poll(() => page.title()).toBe('Your cafes · NUK Platform')
  })

  it('says so for an account that works at no cafe', async () => {
    const page = await open([])
    await page.getByText('This account doesn\'t work at a cafe').waitFor()
    expect(await page.getByRole('link', { name: 'Go to the menu' }).getAttribute('href')).toBe('/c/nuk')
  })

  it('sends a signed-out visitor to sign in, and back here afterwards', async () => {
    const page = await open(() => {
      throw failures.unauthorized()
    })
    await expect.poll(() => new URL(page.url()).pathname).toBe('/sign-in')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/cafes')
  })
})

describe('signing in at the wrong cafe', () => {
  it('keeps the owner of another cafe signed in and offers Your cafes', async () => {
    const page = await createPage()
    const api = await mockApi(page, {
      ...SIGNED_OUT,
      'POST /auth/sign-in/email': () => ({ redirect: false, token: 't', user: { id: ADMIN.userId, email: ADMIN.email } }),
    })
    await page.goto(url('/c/nuk/admin/login'), { waitUntil: 'hydration' })
    api.set({
      'GET /admin/me': () => {
        throw failures.notAdmin()
      },
      'GET /me/cafes': () => [BROWN],
    })
    await page.getByLabel('Email').fill('bea@brown-bean.example')
    await page.getByLabel('Password', { exact: true }).fill('secret')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByText('This account doesn\'t manage this cafe.', { exact: false }).waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
    await page.getByRole('link', { name: 'Your cafes' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/cafes')
    await page.getByRole('link', { name: 'Admin, Brown Bean' }).waitFor()
  })
})
