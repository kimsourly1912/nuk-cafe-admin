import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { ADMIN, failures, gotoHydrated, MockFailure, mockApi, openTabs, setupE2e, SIGNED_OUT } from './support/mock-api'

await setupE2e()

/** Better Auth accepts the credentials, and the account is staff. */
const SIGN_IN_OK = {
  'POST /auth/sign-in/email': () => ({ redirect: false, token: 't', user: { id: ADMIN.userId, email: ADMIN.email } }),
}

async function signIn(page: Page, email = 'admin@nukcafe.test', password = 'secret') {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

describe('auth', () => {
  it('sends a logged-out user to login, keeping where they wanted to go', async () => {
    const page = await createPage()
    await mockApi(page, SIGNED_OUT)
    await page.goto(url('/categories'))
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/categories')
  })

  it('says so on a wrong email or password (Better Auth answers 401)', async () => {
    const page = await createPage()
    await mockApi(page, {
      ...SIGNED_OUT,
      'POST /auth/sign-in/email': () => {
        throw new MockFailure(401, 'INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password')
      },
    })
    await page.goto(url('/login'), { waitUntil: 'hydration' })
    await signIn(page, 'admin@nukcafe.test', 'wrong')
    await page.getByText('Incorrect email or password.').waitFor()
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  it('refuses an account without staff access (a customer) and signs it out again', async () => {
    const page = await createPage()
    const api = await mockApi(page, {
      ...SIGNED_OUT,
      ...SIGN_IN_OK,
    })
    api.set({
      'GET /admin/me': () => {
        throw failures.notStaff()
      },
    })
    await page.goto(url('/login'), { waitUntil: 'hydration' })
    await signIn(page, 'customer@example.com')
    await page.getByText('This account doesn\'t have staff access.').waitFor()
    await expect.poll(() => api.calls).toContain('POST /auth/sign-out')
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  it('logs in and continues to the redirect target', async () => {
    const page = await createPage()
    const api = await mockApi(page, SIGNED_OUT)
    await page.goto(url('/login?redirect=/categories'), { waitUntil: 'hydration' })
    // Once signed in, the session cookie makes /admin/me succeed.
    api.set({ ...SIGN_IN_OK, 'GET /admin/me': () => ADMIN })
    await signIn(page)
    await expect.poll(() => new URL(page.url()).pathname).toBe('/categories')
  })

  it('validates the email before sending anything', async () => {
    const page = await createPage()
    const api = await mockApi(page, SIGNED_OUT)
    await page.goto(url('/login'), { waitUntil: 'hydration' })
    await signIn(page, 'not-an-email')
    await page.getByText('Enter an email address').waitFor()
    expect(api.calls.filter(c => c.startsWith('POST'))).toEqual([])
  })
})

describe('Better Auth session vs staff session', () => {
  it('Better Auth refetching its own session never replaces the staff session', async () => {
    const page = await createPage()
    await mockApi(page, {
      // What Better Auth's client reads at startup: a user without staff fields.
      'GET /auth/get-session': () => ({
        session: { id: 's1', userId: ADMIN.userId, expiresAt: '2099-01-01T00:00:00.000Z' },
        user: { id: ADMIN.userId, email: ADMIN.email, name: 'Better Auth name' },
      }),
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'alice', exact: true }).waitFor()
    // Return to the tab: Better Auth refetches, the staff session stays.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(300)
    expect(new URL(page.url()).pathname).toBe('/categories')
    await page.getByRole('button', { name: 'alice', exact: true }).waitFor()
  })
})

describe('login form', () => {
  it('hides the password, with a show/hide toggle', async () => {
    const page = await createPage()
    await mockApi(page, SIGNED_OUT)
    await page.goto(url('/login'), { waitUntil: 'hydration' })
    await expect.poll(() => page.title()).toBe('Sign in · NUK Cafe Admin')
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('secret')
    expect(await password.getAttribute('type')).toBe('password')
    await page.getByRole('button', { name: 'Show password' }).click()
    expect(await password.getAttribute('type')).toBe('text')
    await page.getByRole('button', { name: 'Hide password' }).click()
    expect(await password.getAttribute('type')).toBe('password')
  })
})

describe('login redirect', () => {
  it('never leaves the site (a //host redirect goes to the dashboard)', async () => {
    const page = await createPage()
    const api = await mockApi(page, SIGNED_OUT)
    await page.goto(url('/login?redirect=//evil.example'), { waitUntil: 'hydration' })
    api.set({ ...SIGN_IN_OK, 'GET /admin/me': () => ADMIN })
    await signIn(page)
    await expect.poll(() => page.url()).toBe(url('/'))
  })
})

describe('auth across tabs', () => {
  it('logging out in one tab sends the other tabs to login', async () => {
    const [tab1, tab2] = await openTabs(2)
    await mockApi(tab1!)
    await mockApi(tab2!)
    await gotoHydrated(tab1!, '/categories')
    await gotoHydrated(tab2!, '/categories')

    await tab1!.getByRole('button', { name: 'alice', exact: true }).click()
    await tab1!.getByRole('menuitem', { name: 'Log out' }).click()

    await expect.poll(() => new URL(tab2!.url()).pathname).toBe('/login')
    expect(new URL(tab2!.url()).searchParams.get('redirect')).toBe('/categories')
  })

  it('logging in in one tab continues the tabs waiting on login', async () => {
    const [tab1, tab2] = await openTabs(2)
    const api1 = await mockApi(tab1!, SIGNED_OUT)
    const api2 = await mockApi(tab2!, SIGNED_OUT)
    await gotoHydrated(tab1!, '/login')
    await gotoHydrated(tab2!, '/login?redirect=/categories')

    // The session cookie is shared by the whole browser.
    api1.set({ ...SIGN_IN_OK, 'GET /admin/me': () => ADMIN })
    api2.set({ 'GET /admin/me': () => ADMIN })
    await signIn(tab1!)

    await expect.poll(() => new URL(tab2!.url()).pathname).toBe('/categories')
  })
})
