import { mkdir } from 'node:fs/promises'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { MockFailure, mockApi, setupE2e } from './support/mock-api'
import { allowBrowserProblems } from './support/browser-problems'
import { asNewVisitor } from './support/client-address'

await setupE2e()

describe('Google account page fallback', () => {
  it('the real public endpoint returns only availability and prevents HTTP caching', async () => {
    const response = await fetch(url('/api/account/providers'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ google: false })
  })

  it('keeps Google hidden when rollout is disabled and preserves the email form', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    for (const path of ['/sign-in', '/sign-up']) {
      await page.goto(url(path), { waitUntil: 'hydration' })
      await page.getByLabel('Email', { exact: true }).waitFor()
      expect(await page.getByRole('button', { name: 'Continue with Google' }).count()).toBe(0)
    }
  })

  it('explains an unverified account conflict and retains the original cafe redirect', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/sign-in?error=account_not_linked&redirect=/c/nuk/checkout'), { waitUntil: 'hydration' })
    await page.getByRole('alert').filter({ hasText: 'Sign in with your email and password and verify your account email before using Google.' }).waitFor()
    expect(await page.getByRole('link', { name: 'Create an account', exact: true }).getAttribute('href')).toContain('redirect=')
    await page.getByLabel('Email', { exact: true }).fill('person@example.com')
  })

  it('uses bounded copy for cancellation or arbitrary upstream error descriptions', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/sign-in?error=access_denied&error_description=DO_NOT_RENDER_PROVIDER_TEXT'), { waitUntil: 'hydration' })
    await page.getByRole('alert').filter({ hasText: 'Google sign-in did not finish.' }).waitFor()
    expect(await page.getByText('DO_NOT_RENDER_PROVIDER_TEXT').count()).toBe(0)
    await page.getByLabel('Email', { exact: true }).waitFor()
  })
})

// The document keeps its disabled build flag; the current server availability is authoritative.
async function enableGoogle(page: Awaited<ReturnType<typeof createPage>>) {
  await page.route(url('/api/account/providers'), route => route.fulfill({ json: { google: true } }))
}

describe('enabled Google account pages', () => {
  it('keeps password sign-in usable when provider discovery fails and retries without losing input', async () => {
    const page = await createPage()
    allowBrowserProblems(/GET \/api\/account\/providers → 503/)
    const api = await mockApi(page, {
      'GET /account/providers': () => { throw new MockFailure(503, 'UNAVAILABLE', 'Could not check Google availability.') },
    })
    await page.goto(url('/sign-in'), { waitUntil: 'hydration' })
    await page.getByText('Could not check Google sign-in', { exact: true }).waitFor()
    await page.getByLabel('Email', { exact: true }).fill('kept@example.com')
    expect(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled()).toBe(true)
    api.set({ 'GET /account/providers': () => ({ google: true }) })
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
    expect(await page.getByLabel('Email', { exact: true }).inputValue()).toBe('kept@example.com')
  })

  it('waits for current availability and updates it on each client-side page entry', async () => {
    const page = await createPage()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let google = true
    let reads = 0
    await mockApi(page, {
      'GET /account/providers': async () => {
        reads++
        if (reads === 1) await held
        return { google }
      },
    })
    await page.goto(url('/sign-in'), { waitUntil: 'hydration' })
    await expect.poll(() => reads).toBe(1)
    try {
      expect(await page.getByLabel('Email', { exact: true }).count()).toBe(0)
      expect(await page.getByRole('button', { name: 'Continue with Google' }).count()).toBe(0)
    }
    finally {
      release()
    }
    await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
    google = false
    await page.getByRole('link', { name: 'Create an account', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).waitFor()
    expect(reads).toBe(2)
    expect(await page.getByRole('button', { name: 'Continue with Google' }).count()).toBe(0)
    google = true
    await page.getByRole('link', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
    expect(reads).toBe(3)
  })

  it('keeps Google visible after sign-in, sign-out and client-side return without a reload', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await enableGoogle(page)
    await page.goto(url('/sign-in?redirect=/c/nuk'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
    const customer = inject('shopSeed').customers.verified
    await page.getByLabel('Email', { exact: true }).fill(customer.email)
    await page.getByLabel('Password', { exact: true }).fill(customer.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url('/c/nuk'))
    await page.getByRole('button', { name: 'DS, account: Dara Sok', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('link', { name: 'Sign in', exact: true }).click()
    await page.getByLabel('Email', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
    expect(new URL(page.url()).pathname).toBe('/sign-in')
  })

  it.each([[320, 844], [390, 844], [768, 900], [1024, 900], [1440, 900], [844, 390]])('keeps the Google form in place during initiation at %s × %s', async (width, height) => {
    const page = await createPage()
    await page.setViewportSize({ width, height })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const api = await mockApi(page, {
      'POST /auth/sign-in/social': async () => {
        await held
        return { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test-state' }
      },
    })
    await enableGoogle(page)
    let leftForGoogle = false
    await page.route('https://accounts.google.com/**', (route) => {
      leftForGoogle = route.request().isNavigationRequest() && route.request().frame() === page.mainFrame()
      return route.fulfill({ status: 204 })
    })
    await page.goto(url('/sign-in?redirect=/c/nuk'), { waitUntil: 'hydration' })
    const google = page.getByRole('button', { name: 'Continue with Google' })
    await google.waitFor()
    const before = await google.boundingBox()
    await google.click()
    try {
      await expect.poll(() => api.calls.includes('POST /auth/sign-in/social')).toBe(true)
      expect(await google.isDisabled()).toBe(true)
      expect(await page.getByRole('dialog').count()).toBe(0)
      expect(await google.boundingBox()).toEqual(before)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.AUTH_LAYOUT_SCREENSHOTS) {
        const directory = 'output/playwright/google-enabled'
        await mkdir(directory, { recursive: true })
        await page.screenshot({ path: `${directory}/${width}x${height}-light.png`, fullPage: true })
        await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
        await page.getByRole('button', { name: 'Switch to light mode', exact: true }).waitFor()
        await page.screenshot({ path: `${directory}/${width}x${height}-dark.png`, fullPage: true })
      }
    }
    finally { release() }
    await expect.poll(() => leftForGoogle).toBe(true)
  })
})
