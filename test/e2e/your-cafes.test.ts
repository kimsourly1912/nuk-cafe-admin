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
    await expect.poll(() => page.title()).toBe('Your cafes · Angder')
  })

  it('says so for an account that works at no cafe', async () => {
    const page = await open([])
    await page.getByText('This account doesn\'t work at a cafe').waitFor()
    // No link into a guessed cafe (D221).
    expect(await page.locator('a[href^="/c/"]').count()).toBe(0)
  })

  it('sends a signed-out visitor to sign in, and back here afterwards', async () => {
    const page = await open(() => {
      throw failures.unauthorized()
    })
    await expect.poll(() => new URL(page.url()).pathname).toBe('/sign-in')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/cafes')
  })
})

describe('signing in where the account has no access (D239)', () => {
  /** Signs in at `path`, refused there by `me` (403), with `cafes` as the account's cafes (or their handler) and `role` its platform role. */
  async function refusedAt(path: string, me: string, cafes: AccountCafe[] | (() => AccountCafe[]), width = 1440, role = 'customer') {
    const page = await createPage()
    await page.setViewportSize({ width, height: 900 })
    const api = await mockApi(page, {
      ...SIGNED_OUT,
      'GET /counter/me': () => {
        throw failures.unauthorized()
      },
      'GET /platform/me': () => {
        throw failures.unauthorized()
      },
      'POST /auth/sign-in/email': () => ({ redirect: false, token: 't', user: { id: ADMIN.userId, email: ADMIN.email } }),
    })
    await page.goto(url(path), { waitUntil: 'hydration' })
    api.set({
      [me]: () => {
        throw failures.forbidden()
      },
      'GET /me/cafes': typeof cafes === 'function' ? cafes : () => cafes,
      'GET /auth/get-session': () => ({ user: { email: 'mony@example.com', role } }),
    })
    await page.getByLabel('Email').fill('mony@example.com')
    await page.getByLabel('Password', { exact: true }).fill('secret')
    await page.getByRole('button', { name: 'Sign in' }).click()
    return { page, api }
  }

  it('keeps the owner of another cafe signed in and offers Your cafes', async () => {
    const { page, api } = await refusedAt('/c/nuk/admin/login', 'GET /admin/me', [BROWN])
    await page.getByRole('heading', { name: 'No access to the admin app' }).waitFor()
    await page.getByText('This account doesn\'t manage NUK Cafe.', { exact: false }).waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
    expect(await page.getByRole('link', { name: 'Open the counter' }).count()).toBe(0)
    await page.getByRole('link', { name: 'Your cafes' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/cafes')
    await page.getByRole('link', { name: 'Admin, Brown Bean' }).waitFor()
  })

  it('sends this cafe\'s manager on to the counter, focused and announced, still signed in; phone width fits', async () => {
    const { page, api } = await refusedAt('/c/nuk/admin/login', 'GET /admin/me', [{ ...NUK_PROFILE, workspaces: ['counter'] }], 390)
    const panel = page.getByRole('alert').filter({ hasText: 'No access to the admin app' })
    await panel.waitFor()
    await expect.poll(() => panel.evaluate(el => el === document.activeElement)).toBe(true)
    await panel.getByText('This account works at NUK Cafe\'s counter, not in the admin app.').waitFor()
    await panel.getByText('mony@example.com').waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
    // Nowhere else to go: no Your cafes.
    expect(await page.getByRole('link', { name: 'Your cafes' }).count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.getByRole('link', { name: 'Open the counter' }).getAttribute('href')).toBe('/c/nuk/counter')
  })

  it('Use another account signs out and brings the form back, empty', async () => {
    const { page, api } = await refusedAt('/c/nuk/admin/login', 'GET /admin/me', [{ ...NUK_PROFILE, workspaces: ['counter'] }, BROWN])
    // Both: this cafe's counter first, Your cafes beside it.
    await page.getByRole('link', { name: 'Open the counter' }).waitFor()
    await page.getByRole('link', { name: 'Your cafes' }).waitFor()
    await page.getByRole('button', { name: 'Use another account' }).click()
    await expect.poll(() => api.calls).toContain('POST /auth/sign-out')
    await page.getByRole('button', { name: 'Sign in' }).waitFor()
    expect(await page.getByLabel('Email').inputValue()).toBe('')
    expect(new URL(page.url()).pathname).toBe('/c/nuk/admin/login')
  })

  it('keeps a platform team account signed in and offers the platform console, never the cafe', async () => {
    const { page, api } = await refusedAt('/c/nuk/admin/login', 'GET /admin/me', [], 1440, 'superadmin')
    await page.getByRole('heading', { name: 'No access to the admin app' }).waitFor()
    await page.getByText('This is a platform team account', { exact: false }).waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
    expect(await page.getByRole('link', { name: 'Open the platform console' }).getAttribute('href')).toBe('/platform')
    expect(await page.getByRole('link', { name: /Open the counter|Your cafes/ }).count()).toBe(0)
  })

  /** Opens `path` already signed in as `role`, which the workspace refuses (`me` answers 403). */
  async function arriveSignedIn(path: string, me: string, role: string, cafes: AccountCafe[]) {
    const page = await createPage()
    const api = await mockApi(page, {
      'GET /admin/me': () => {
        throw failures.notAdmin()
      },
      'GET /counter/me': () => {
        throw failures.forbidden()
      },
      [me]: () => {
        throw failures.forbidden()
      },
      'GET /auth/get-session': () => ({ user: { email: 'pat@angder.example', role } }),
      'GET /me/cafes': () => cafes,
    })
    await page.goto(url(path), { waitUntil: 'hydration' })
    return { page, api }
  }

  it('already signed in as a platform account, the admin says so at once instead of a sign-in form', async () => {
    const { page, api } = await arriveSignedIn('/c/nuk/admin', 'GET /admin/me', 'superadmin', [])
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/login')
    await page.getByRole('heading', { name: 'No access to the admin app' }).waitFor()
    await page.getByText('pat@angder.example').waitFor()
    expect(await page.getByLabel('Email').count()).toBe(0)
    await page.getByRole('link', { name: 'Open the platform console' }).waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
  })

  it('already signed in as a customer: no access, Back to the menu first, Use another account brings the form', async () => {
    const { page, api } = await arriveSignedIn('/c/nuk/admin/login', 'GET /admin/me', 'customer', [])
    await page.getByText('Only NUK Cafe\'s owners use the admin app.').waitFor()
    expect(await page.getByRole('link').filter({ hasText: /Open|Your cafes/ }).count()).toBe(0)
    // The safe page is the way on; signed in on purpose elsewhere, the session is kept (Q1).
    expect(await page.getByRole('link', { name: 'Back to NUK Cafe\'s menu' }).getAttribute('href')).toBe('/c/nuk')
    expect(api.calls).not.toContain('POST /auth/sign-out')
    api.set({ 'GET /auth/get-session': () => null })
    await page.getByRole('button', { name: 'Use another account' }).click()
    await expect.poll(() => api.calls).toContain('POST /auth/sign-out')
    await page.getByLabel('Email').waitFor()
  })

  it('already signed in as this cafe\'s manager, the admin sign-in offers the counter at once', async () => {
    const { page } = await arriveSignedIn('/c/nuk/admin/login', 'GET /admin/me', 'customer', [{ ...NUK_PROFILE, workspaces: ['counter'] }])
    await page.getByText('This account works at NUK Cafe\'s counter, not in the admin app.').waitFor()
    expect(await page.getByRole('link', { name: 'Open the counter' }).getAttribute('href')).toBe('/c/nuk/counter')
  })

  it('a failed check keeps the session with Try again, which then says where the account may go (Q4)', async () => {
    const { page, api } = await refusedAt('/c/nuk/admin/login', 'GET /admin/me', () => {
      throw failures.server()
    })
    await page.getByText('We couldn\'t check where this account works.', { exact: false }).waitFor()
    await page.getByText('mony@example.com').waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')

    api.set({ 'GET /me/cafes': () => [{ ...NUK_PROFILE, workspaces: ['counter'] }] })
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.getByText('This account works at NUK Cafe\'s counter, not in the admin app.').waitFor()
    expect(await page.getByRole('link', { name: 'Open the counter' }).getAttribute('href')).toBe('/c/nuk/counter')
    expect(api.calls).not.toContain('POST /auth/sign-out')
  })

  it('Try again for an account that works nowhere signs it out, as any customer at a staff sign-in (Q1, Q4)', async () => {
    const { page, api } = await refusedAt('/c/nuk/counter/sign-in', 'GET /counter/me', () => {
      throw failures.server()
    })
    await page.getByRole('button', { name: 'Try again' }).waitFor()
    api.set({ 'GET /me/cafes': () => [] })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => api.calls).toContain('POST /auth/sign-out')
    await page.getByText('This account doesn\'t work at any branch', { exact: false }).waitFor()
    await page.getByLabel('Email').waitFor()
  })

  it('follows another tab: back in view, the panel names the account signed in now (E3)', async () => {
    const { page, api } = await arriveSignedIn('/c/nuk/admin/login', 'GET /admin/me', 'customer', [])
    await page.getByText('pat@angder.example').waitFor()
    api.set({
      'GET /auth/get-session': () => ({ user: { email: 'sam@example.com', role: 'customer' } }),
      'GET /me/cafes': () => [{ ...NUK_PROFILE, workspaces: ['counter'] }],
    })
    await page.evaluate(() => {
      for (const state of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
        document.dispatchEvent(new Event('visibilitychange'))
      }
    })
    await page.getByText('sam@example.com').waitFor()
    await page.getByRole('link', { name: 'Open the counter' }).waitFor()
  })

  it('the platform console keeps a cafe owner signed in and offers Your cafes, never the console (D241)', async () => {
    const { page, api } = await refusedAt('/platform/sign-in', 'GET /platform/me', [BROWN])
    await page.getByRole('heading', { name: 'No access to the platform console' }).waitFor()
    await page.getByText('This account isn\'t on the platform team.', { exact: false }).waitFor()
    await page.getByRole('heading', { name: 'Angder' }).waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
    expect(await page.getByRole('link', { name: 'Your cafes' }).getAttribute('href')).toBe('/cafes')
    expect(await page.getByRole('link', { name: /Open the platform console|Open the counter/ }).count()).toBe(0)
  })

  it('the platform console, a failed check: the session is kept with Try again (Q4)', async () => {
    const { page, api } = await refusedAt('/platform/sign-in', 'GET /platform/me', () => {
      throw failures.server()
    })
    await page.getByText('We couldn\'t check where this account works.', { exact: false }).waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
    api.set({ 'GET /me/cafes': () => [BROWN] })
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.getByRole('link', { name: 'Your cafes' }).waitFor()
  })

  it('already signed in as a customer, the console says so with Back to home, the session kept', async () => {
    const { page, api } = await arriveSignedIn('/platform', 'GET /platform/me', 'customer', [])
    await expect.poll(() => new URL(page.url()).pathname).toBe('/platform/sign-in')
    await page.getByText('Only the platform team uses the console.').waitFor()
    expect(await page.getByLabel('Email').count()).toBe(0)
    expect(await page.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/')
    expect(api.calls).not.toContain('POST /auth/sign-out')
  })

  it('already signed in as a platform team account whose check failed, the console shows the form, never a wrong refusal', async () => {
    const page = await createPage()
    await mockApi(page, {
      'GET /platform/me': () => {
        throw failures.server()
      },
      'GET /auth/get-session': () => ({ user: { email: 'ops@angder.example', role: 'superadmin' } }),
    })
    await page.goto(url('/platform/sign-in'), { waitUntil: 'hydration' })
    await page.getByLabel('Email').waitFor()
    expect(await page.getByRole('heading', { name: 'No access to the platform console' }).count()).toBe(0)
  })

  it('the counter sign-in offers Your cafes to staff of another cafe', async () => {
    const { page, api } = await refusedAt('/c/nuk/counter/sign-in', 'GET /counter/me', [KIOSK])
    await page.getByRole('heading', { name: 'No access to the counter' }).waitFor()
    await page.getByText('This account doesn\'t work at NUK Cafe.', { exact: false }).waitFor()
    expect(api.calls).not.toContain('POST /auth/sign-out')
    expect(await page.getByRole('link', { name: 'Your cafes' }).getAttribute('href')).toBe('/cafes')
  })
})
