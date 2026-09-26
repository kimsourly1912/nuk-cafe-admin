import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { gotoHydrated, MockFailure, mockApi, openTabs, setupE2e } from './support/mock-api'

await setupE2e()

const LOGGED_OUT = {
  'GET /staff/auth/session': () => {
    throw new MockFailure('NC1000', 'Unauthorized', 401)
  },
  'POST /staff/auth/refresh': () => {
    throw new MockFailure('NC1000', 'Unauthorized', 401)
  },
}

describe('auth', () => {
  it('sends a logged-out user to login, keeping where they wanted to go', async () => {
    const page = await createPage()
    await mockApi(page, LOGGED_OUT)
    await page.goto(url('/categories'))
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/categories')
  })

  it('shows the backend reason on a failed login', async () => {
    const page = await createPage()
    await mockApi(page, {
      ...LOGGED_OUT,
      'POST /staff/auth/login': () => {
        throw new MockFailure('LOGIN_FAILED', 'Invalid username or password')
      },
    })
    await page.goto(url('/login'), { waitUntil: 'hydration' })
    await page.getByLabel('Username').fill('admin')
    await page.getByLabel('Password', { exact: true }).fill('wrong')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByText('Invalid username or password').waitFor()
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  it('logs in and continues to the redirect target', async () => {
    const page = await createPage()
    const api = await mockApi(page, LOGGED_OUT)
    api.set({ 'POST /staff/auth/login': () => ({ staffId: 1, username: 'admin', groups: ['ADMIN'] }) })
    await page.goto(url('/login?redirect=/categories'), { waitUntil: 'hydration' })
    await page.getByLabel('Username').fill('admin')
    await page.getByLabel('Password', { exact: true }).fill('secret')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/categories')
  })
})

describe('login form', () => {
  it('hides the password, with a show/hide toggle', async () => {
    const page = await createPage()
    await mockApi(page, LOGGED_OUT)
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
    const api = await mockApi(page, LOGGED_OUT)
    api.set({ 'POST /staff/auth/login': () => ({ staffId: 1, username: 'admin', groups: ['ADMIN'] }) })
    await page.goto(url('/login?redirect=//evil.example'), { waitUntil: 'hydration' })
    await page.getByLabel('Username').fill('admin')
    await page.getByLabel('Password', { exact: true }).fill('secret')
    await page.getByRole('button', { name: 'Sign in' }).click()
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

    await tab1!.getByRole('button', { name: 'admin' }).click()
    await tab1!.getByRole('menuitem', { name: 'Log out' }).click()

    await expect.poll(() => new URL(tab2!.url()).pathname).toBe('/login')
    expect(new URL(tab2!.url()).searchParams.get('redirect')).toBe('/categories')
  })

  it('logging in in one tab continues the tabs waiting on login', async () => {
    const [tab1, tab2] = await openTabs(2)
    const api1 = await mockApi(tab1!, LOGGED_OUT)
    const api2 = await mockApi(tab2!, LOGGED_OUT)
    await gotoHydrated(tab1!, '/login')
    await gotoHydrated(tab2!, '/login?redirect=/categories')

    // The backend sets the session cookie for the whole browser.
    const session = () => ({ staffId: 1, username: 'admin', groups: ['ADMIN'] })
    api1.set({ 'POST /staff/auth/login': session, 'GET /staff/auth/session': session })
    api2.set({ 'GET /staff/auth/session': session })
    await tab1!.getByLabel('Username').fill('admin')
    await tab1!.getByLabel('Password', { exact: true }).fill('secret')
    await tab1!.getByRole('button', { name: 'Sign in' }).click()

    await expect.poll(() => new URL(tab2!.url()).pathname).toBe('/categories')
  })
})
