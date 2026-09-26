import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { MockFailure, mockApi, setupE2e } from './support/mock-api'

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
