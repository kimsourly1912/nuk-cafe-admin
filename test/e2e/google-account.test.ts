import { mkdir } from 'node:fs/promises'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { ADMIN, failures, MockFailure, mockApi, setupE2e } from './support/mock-api'
import { allowBrowserProblems } from './support/browser-problems'
import { asNewVisitor } from './support/client-address'

await setupE2e()

describe('Google account page fallback', () => {
  it('permits popup handles only on the two account entry routes and retains CSP', async () => {
    for (const path of ['/sign-in', '/sign-up', '/c/nuk/admin/login', '/c/nuk/counter/sign-in', '/platform/sign-in', '/google-callback', '/cafes']) {
      const response = await fetch(url(path))
      expect(response.headers.get('cross-origin-opener-policy')).toBe(path === '/cafes' ? 'same-origin' : path === '/google-callback' ? 'unsafe-none' : 'same-origin-allow-popups')
      expect(response.headers.get('content-security-policy')).toContain('default-src \'self\'')
    }
  })
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

/** Provider traffic stays offline; the real browser still crosses origins and keeps its popup. */
async function popupFlow(path = '/sign-in', handlers: (current: () => boolean) => Record<string, MockHandler> = () => ({}), redirect = '/verify-email', size?: { width: number, height: number }) {
  const page = await createPage()
  if (size) await page.setViewportSize(size)
  let callback = ''
  let errorCallback = ''
  let signedIn = false
  const api = await mockApi(page, {
    'GET /account/providers': () => ({ google: true }),
    'GET /auth/get-session': () => signedIn ? { user: { id: 'google-user', name: 'Google User', email: 'google@example.com', emailVerified: true } } : null,
    'POST /auth/sign-in/social': ({ body }) => {
      const request = body as { callbackURL: string, errorCallbackURL: string, disableRedirect: boolean }
      expect(request.disableRedirect).toBe(true)
      callback = request.callbackURL
      errorCallback = request.errorCallbackURL
      return { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=offline-test' }
    },
    ...handlers(() => signedIn),
  })
  await page.context().route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Offline Google</title>' }))
  await page.goto(url(`${path}?redirect=${encodeURIComponent(redirect)}`), { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Continue with Google' }).waitFor()
  return { page, api, callback: () => callback, errorCallback: () => errorCallback, signOut: () => {
    signedIn = false
  }, authenticate: () => {
    signedIn = true
  } }
}

describe('Google popup completion', () => {
  it.each(['/sign-in', '/sign-up'])('%s completes only after a fresh authenticated session and keeps the return path', async (path) => {
    const flow = await popupFlow(path)
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    expect(new URL(flow.page.url()).pathname).toBe(path)
    flow.authenticate()
    await popup.goto(flow.callback(), { waitUntil: 'commit' })
    await flow.page.waitForURL(url('/verify-email'))
    await expect.poll(() => popup.isClosed()).toBe(true)
    await flow.page.getByRole('heading', { name: 'Your email is verified', exact: true }).waitFor()
  })

  it.each(['/sign-in', '/sign-up'])('%s shows bounded provider errors in the original form and allows retry', async (path) => {
    const flow = await popupFlow(path)
    await flow.page.getByLabel('Email', { exact: true }).fill('kept@example.com')
    for (const error of ['account_not_linked', 'google_password_required', 'GOOGLE_PASSWORD_REQUIRED', 'access_denied']) {
      const opened = flow.page.waitForEvent('popup')
      await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
      const popup = await opened
      await popup.waitForURL('https://accounts.google.com/**')
      const failure = new URL(flow.errorCallback())
      failure.searchParams.set('error', error)
      failure.searchParams.set('error_description', 'DO_NOT_RENDER_PROVIDER_TEXT')
      await popup.goto(failure.toString(), { waitUntil: 'commit' })
      await flow.page.getByRole('alert').waitFor()
      await expect.poll(() => popup.isClosed()).toBe(true)
      expect(await flow.page.getByText('DO_NOT_RENDER_PROVIDER_TEXT').count()).toBe(0)
      expect(await flow.page.getByLabel('Email', { exact: true }).inputValue()).toBe('kept@example.com')
      expect(await flow.page.getByRole('button', { name: 'Continue with Google' }).isEnabled()).toBe(true)
    }
  })

  it('explains blocked popups without sending an OAuth request', async () => {
    const flow = await popupFlow()
    await flow.page.evaluate(() => {
      window.open = () => null
    })
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    await flow.page.getByRole('alert').filter({ hasText: 'Allow popups for this site' }).waitFor()
    expect(flow.api.calls.includes('POST /auth/sign-in/social')).toBe(false)
  })

  it('does not accept a callback without a real session', async () => {
    const flow = await popupFlow()
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    await popup.goto(flow.callback(), { waitUntil: 'commit' })
    await flow.page.getByRole('alert').filter({ hasText: 'Sign in to continue.' }).waitFor()
    expect(new URL(flow.page.url()).pathname).toBe('/sign-in')
    expect(popup.isClosed()).toBe(true)
  })

  it('refuses an unexpected provider destination and closes the blank popup', async () => {
    const flow = await popupFlow()
    flow.api.set({ 'POST /auth/sign-in/social': () => ({ url: 'https://example.invalid/untrusted' }) })
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await flow.page.getByRole('alert').filter({ hasText: 'Google sign-in is unavailable.' }).waitFor()
    expect(popup.isClosed()).toBe(true)
    expect(new URL(flow.page.url()).pathname).toBe('/sign-in')
  })

  it('times out and allows retry without changing the form', async () => {
    const flow = await popupFlow()
    await flow.page.clock.install()
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    await flow.page.clock.fastForward(181_000)
    await flow.page.getByRole('alert').filter({ hasText: 'Google sign-in timed out.' }).waitFor()
    expect(popup.isClosed()).toBe(true)
    expect(await flow.page.getByRole('button', { name: 'Continue with Google' }).isEnabled()).toBe(true)
  })

  it('ignores a mismatched popup attempt and allows retry after it is closed', async () => {
    const flow = await popupFlow()
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    await flow.page.clock.install()
    const mismatch = new URL(flow.callback())
    mismatch.searchParams.set('googlePopup', 'another-attempt')
    await popup.goto(mismatch.toString())
    await popup.getByText('Returning to your sign-in window', { exact: true }).waitFor()
    await flow.page.clock.runFor(1000)
    expect(await flow.page.getByRole('button', { name: 'Continue with Google' }).isDisabled()).toBe(true)
    await popup.close()
    await flow.page.clock.runFor(250)
    await flow.page.getByRole('alert').filter({ hasText: 'Google sign-in was closed.' }).waitFor()
  })

  it('closes the provider popup when leaving the form', async () => {
    const flow = await popupFlow()
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    await flow.page.getByRole('link', { name: 'Create an account', exact: true }).click()
    await flow.page.getByLabel('Name', { exact: true }).waitFor()
    expect(popup.isClosed()).toBe(true)
  })
})

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

  it.each(['/sign-in', '/sign-up'].flatMap(path => ([[320, 844], [390, 844], [768, 900], [1024, 900], [1440, 900], [844, 390]] as const).map(([width, height]) => [path, width, height] as const)))('keeps %s styled during popup initiation at %s by %s', async (path, width, height) => {
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
    let popupAtGoogle = false
    await page.context().route('https://accounts.google.com/**', (route) => {
      popupAtGoogle = route.request().isNavigationRequest() && route.request().frame().page() !== page
      return route.fulfill({ contentType: 'text/html', body: '<title>Mock Google</title>' })
    })
    await page.goto(url(`${path}?redirect=/c/nuk`), { waitUntil: 'hydration' })
    const google = page.getByRole('button', { name: 'Continue with Google' })
    await google.waitFor()
    const before = await google.boundingBox()
    const submitButton = page.getByRole('button', { name: path === '/sign-in' ? 'Sign in' : 'Create account', exact: true })
    const colors = await submitButton.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))
    const popupOpened = page.waitForEvent('popup')
    await google.click()
    const popup = await popupOpened
    try {
      await expect.poll(() => api.calls.includes('POST /auth/sign-in/social')).toBe(true)
      expect(await google.isDisabled()).toBe(true)
      expect(await page.getByRole('dialog').count()).toBe(0)
      expect(await google.boundingBox()).toEqual(before)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.AUTH_LAYOUT_SCREENSHOTS) {
        const directory = 'output/playwright/google-enabled'
        await mkdir(directory, { recursive: true })
        await page.screenshot({ path: `${directory}/${path.slice(1)}-${width}x${height}-light.png`, fullPage: true })
        await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
        await page.getByRole('button', { name: 'Switch to light mode', exact: true }).waitFor()
        await page.screenshot({ path: `${directory}/${path.slice(1)}-${width}x${height}-dark.png`, fullPage: true })
        await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click()
        await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).waitFor()
      }
    }
    finally { release() }
    await expect.poll(() => popupAtGoogle).toBe(true)
    expect(new URL(page.url()).pathname).toBe(path)
    expect(await submitButton.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))).toEqual(colors)
    expect(await submitButton.isDisabled()).toBe(true)
    await popup.close()
    await page.getByRole('alert').filter({ hasText: 'Google sign-in was closed.' }).waitFor()
    expect(await google.isEnabled()).toBe(true)
    expect(await submitButton.isEnabled()).toBe(true)
  })
})

const WORKSPACES = [
  ['/c/nuk/admin/login', '/c/nuk/admin'],
  ['/c/nuk/counter/sign-in', '/c/nuk/counter'],
  ['/platform/sign-in', '/platform'],
] as const

function workspaceHandlers(current: () => boolean): Record<string, MockHandler> {
  const requireSession = <T>(session: T) => {
    if (!current()) throw failures.unauthorized()
    return session
  }
  return {
    'GET /admin/me': () => requireSession({ ...ADMIN, userId: 'google-user' }),
    'GET /counter/me': () => requireSession({ userId: 'google-user', name: 'Google User', email: 'google@example.com', mustChangePassword: false, twoFactorEnabled: false, branches: [] }),
    'GET /platform/me': () => requireSession({ userId: 'google-user', name: 'Google User', email: 'google@example.com', mustChangePassword: false, twoFactorEnabled: true }),
    'GET /platform/overview': () => ({ cafes: { active: 1, suspended: 0 }, newCafesThisMonth: 0, quietCafes: 0, noActiveOwner: 0, bannedAccounts: 0, timeZone: 'Asia/Phnom_Penh' }),
  }
}

describe('Google workspace entry points', () => {
  it.each(WORKSPACES)('%s completes Google then checks workspace access before returning to %s', async (path, target) => {
    const flow = await popupFlow(path, workspaceHandlers, target)
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    expect(new URL(flow.page.url()).pathname).toBe(path)
    flow.authenticate()
    await popup.goto(flow.callback(), { waitUntil: 'commit' })
    await flow.page.waitForURL(url(target))
    await expect.poll(() => popup.isClosed()).toBe(true)
    const surface = path.includes('/admin/') ? 'admin' : path.includes('/counter/') ? 'counter' : 'platform'
    expect(flow.api.calls.filter(call => call === `GET /${surface}/me`).length).toBeGreaterThan(1)
  })

  it.each(WORKSPACES)('%s does not grant workspace access to an authenticated customer', async (path) => {
    const flow = await popupFlow(path, workspaceHandlers)
    const surface = path.includes('/admin/') ? 'admin' : path.includes('/counter/') ? 'counter' : 'platform'
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    flow.api.set({
      [`GET /${surface}/me`]: () => { throw new MockFailure(403, surface === 'admin' ? 'NOT_ADMIN' : surface === 'counter' ? 'NOT_COUNTER_STAFF' : 'NOT_PLATFORM_ADMIN', 'No workspace access.') },
      'GET /me/cafes': () => [],
      'POST /auth/sign-out': () => {
        flow.signOut()
        return { success: true }
      },
    })
    flow.authenticate()
    await popup.goto(flow.callback(), { waitUntil: 'commit' })
    const message = surface === 'counter' ? 'This account doesn\'t work at any branch' : 'This account doesn\'t have access'
    await flow.page.getByRole('alert').filter({ hasText: message }).waitFor()
    expect(new URL(flow.page.url()).pathname).toBe(path)
    expect(flow.api.calls).toContain('POST /auth/sign-out')
    expect(popup.isClosed()).toBe(true)
  })

  it.each([...WORKSPACES, ['/sign-in', '/'], ['/sign-up', '/']] as const)('%s waits for the authenticator after Google, without requesting workspace access', async (path) => {
    const flow = await popupFlow(path, workspaceHandlers)
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    const calls = flow.api.calls.length
    const callback = new URL(flow.callback())
    callback.searchParams.set('googleTwoFactor', '1')
    await popup.goto(callback.toString(), { waitUntil: 'commit' })
    await flow.page.getByText('Open your authenticator app and enter the 6-digit code for Angder.').waitFor()
    expect(new URL(flow.page.url()).pathname).toBe(path)
    expect(flow.api.calls.slice(calls).filter(call => /GET \/(admin|counter|platform)\/me/.test(call))).toEqual([])
    expect(await flow.page.getByRole('button', { name: 'Verify', exact: true }).isEnabled()).toBe(true)
    expect(popup.isClosed()).toBe(true)
  })

  it.each(WORKSPACES)('%s preserves fields and enables retry after cancelling Google', async (path) => {
    const flow = await popupFlow(path, workspaceHandlers)
    await flow.page.getByLabel('Email', { exact: true }).fill('kept@example.com')
    const opened = flow.page.waitForEvent('popup')
    await flow.page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await opened
    await popup.close()
    await flow.page.getByRole('alert').filter({ hasText: 'Google sign-in was closed.' }).waitFor()
    expect(await flow.page.getByLabel('Email', { exact: true }).inputValue()).toBe('kept@example.com')
    expect(await flow.page.getByRole('button', { name: 'Continue with Google' }).isEnabled()).toBe(true)
  })

  it.each(WORKSPACES.flatMap(([path]) => ([[320, 844], [390, 844], [768, 900], [1024, 900], [1440, 900], [844, 390]] as const).map(([width, height]) => [path, width, height] as const)))('keeps %s styled and usable at %s by %s during Google', async (path, width, height) => {
    const flow = await popupFlow(path, workspaceHandlers, '/', { width, height })
    const google = flow.page.getByRole('button', { name: 'Continue with Google', exact: true })
    const submit = flow.page.getByRole('button', { name: 'Sign in', exact: true })
    const colors = await submit.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))
    const opened = flow.page.waitForEvent('popup')
    await google.click()
    const popup = await opened
    await popup.waitForURL('https://accounts.google.com/**')
    expect(await submit.isDisabled()).toBe(true)
    expect(await flow.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await submit.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))).toEqual(colors)
    if (process.env.AUTH_LAYOUT_SCREENSHOTS) {
      const directory = 'output/playwright/google-workspaces'
      await mkdir(directory, { recursive: true })
      await flow.page.screenshot({ path: `${directory}/${path.replaceAll('/', '-')}-${width}x${height}-light.png`, fullPage: true })
      await flow.page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
      await flow.page.getByRole('button', { name: 'Switch to light mode', exact: true }).waitFor()
      await flow.page.screenshot({ path: `${directory}/${path.replaceAll('/', '-')}-${width}x${height}-dark.png`, fullPage: true })
    }
    await popup.close()
    await flow.page.getByRole('alert').filter({ hasText: 'Google sign-in was closed.' }).waitFor()
    expect(await google.isEnabled()).toBe(true)
  })
})
