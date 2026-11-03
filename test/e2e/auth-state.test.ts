import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { allowBrowserProblems } from './support/browser-problems'
import { ADMIN, deferred, failures, gotoHydrated, MockFailure, mockApi, openTabs, setupE2e } from './support/mock-api'

await setupE2e()

const USER = { id: 'account-1', name: 'Account One', email: 'account@example.test', emailVerified: true, mustChangePassword: false }
const SESSION = { user: USER, session: { id: 'session-1' } }
const COUNTER = { userId: USER.id, name: USER.name, email: USER.email, mustChangePassword: false, twoFactorEnabled: false, branches: [{ id: 'branch-1', name: 'Main', role: 'staff', permissions: [] }],
}
const PLATFORM = { userId: USER.id, email: USER.email, name: USER.name, mustChangePassword: false, twoFactorEnabled: true }

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => (release = resolve))
  return { promise, release }
}

describe('auth state consistency', () => {
  it.each(['', '?error=TOKEN_EXPIRED'])('verification waits for the session before showing its result (%s)', async (query) => {
    const page = await createPage()
    const held = gate()
    await mockApi(page, { 'GET /auth/get-session': async () => {
      await held.promise
      return SESSION
    },
    })
    await page.goto(url(`/email-verified${query}`), { waitUntil: 'hydration' })
    await page.getByRole('status', { name: 'Loading', exact: true }).waitFor()
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(0)
    expect(await page.getByText('You can order as soon as the cafe is open.').count()).toBe(0)
    held.release()
    await page.getByRole('heading', { name: 'Email verified', exact: true }).waitFor()
    await page.getByText('You\'re signed in as Account One.').waitFor()
  })

  it('verify email keeps its frame and aside while the account loads', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    const held = gate()
    await mockApi(page, { 'GET /auth/get-session': async () => {
      await held.promise
      return { ...SESSION, user: { ...USER, emailVerified: false } }
    },
    })
    await page.goto(url('/verify-email'), { waitUntil: 'hydration' })
    await page.getByRole('status', { name: 'Loading', exact: true }).waitFor()
    expect(await page.locator('[data-aside]').isVisible()).toBe(true)
    const width = await page.locator('[data-aside]').evaluate(el => el.closest('div.flex.w-full')!.getBoundingClientRect().width)
    held.release()
    await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor()
    expect(await page.locator('[data-aside]').evaluate(el => el.closest('div.flex.w-full')!.getBoundingClientRect().width)).toBe(width)
  })

  it('a failed account session check shows Retry instead of a signed-out form', async () => {
    allowBrowserProblems(/GET \/api\/auth\/get-session → 500/)
    const page = await createPage()
    let failed = true
    await mockApi(page, { 'GET /auth/get-session': () => {
      if (failed) throw failures.server()
      return null
    },
    })
    await page.goto(url('/sign-in'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { name: 'Could not check your session', exact: true }).waitFor()
    expect(await page.getByLabel('Email', { exact: true }).count()).toBe(0)
    failed = false
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.getByLabel('Email', { exact: true }).waitFor()
  })

  it.each(['/sign-in', '/sign-up'])('a mounted %s follows a changed account, without submitting its form', async (path) => {
    const page = await createPage()
    let signedIn = false
    await mockApi(page, { 'GET /auth/get-session': () => signedIn ? SESSION : null,
    })
    await page.goto(url(`${path}?redirect=/verify-email`), { waitUntil: 'hydration' })
    await page.getByLabel('Email', { exact: true }).waitFor()
    signedIn = true
    await page.evaluate(() => {
      const channel = new BroadcastChannel('nuk-cafe-admin:data-changed')
      channel.postMessage({ features: ['account'] })
      setTimeout(() => channel.close(), 100)
    })
    await page.waitForURL(url('/verify-email'))
    await page.getByRole('heading', { name: 'Your email is verified', exact: true }).waitFor()
  })

  it('the page own sign-up still goes to Check your email and keeps its return target', async () => {
    const page = await createPage()
    let signedIn = false
    const user = { ...USER, emailVerified: false }
    await mockApi(page, {
      'GET /auth/get-session': () => signedIn
        ? { user, session: SESSION.session }
        : null,
      'POST /auth/sign-up/email': () => {
        signedIn = true
        return { user }
      },

    })
    await page.goto(url('/sign-up?redirect=/c/nuk/checkout'), { waitUntil: 'hydration' })
    await page.getByLabel('Name', { exact: true }).fill(USER.name)
    await page.getByLabel('Email', { exact: true }).fill(USER.email)
    await page.getByLabel('Password', { exact: true }).fill('account-only-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.waitForURL(address => address.pathname === '/verify-email')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/c/nuk/checkout')
    await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor()
  })

  it('the code form stays visible while a successful two-factor sign-in is finalized', async () => {
    const page = await createPage()
    let verified = false
    const held = gate()
    await mockApi(page, {
      'GET /auth/get-session': async () => {
        if (verified) {
          await held.promise
          return SESSION
        }
        return null
      },
      'POST /auth/sign-in/email': () => ({ twoFactorRedirect: true }),
      'POST /auth/two-factor/verify-backup-code': () => {
        verified = true
        return SESSION
      },

    })
    await page.goto(url('/sign-in?redirect=/verify-email'), { waitUntil: 'hydration' })
    await page.getByLabel('Email', { exact: true }).fill(USER.email)
    await page.getByLabel('Password', { exact: true }).fill('account-only-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Use a backup code instead', exact: true }).click()
    await page.getByLabel('Backup code', { exact: true }).fill('fake-backup-code')
    await page.getByRole('button', { name: 'Verify', exact: true }).click()
    await expect.poll(() => verified).toBe(true)
    expect(await page.getByLabel('Password', { exact: true }).count()).toBe(0)
    expect(await page.getByLabel('Backup code', { exact: true }).isVisible()).toBe(true)
    held.release()
    await page.waitForURL(url('/verify-email'))
  })

  it.each([
    ['/c/nuk/admin/account-security', '/c/nuk/admin/login'],
    ['/c/nuk/counter/account-security', '/c/nuk/counter/sign-in'],
    ['/platform/change-password', '/platform/sign-in'],
  ])('another tab logout clears the protected page at %s', async (path, signIn) => {
    const page = await createPage()
    let signedIn = true
    const read = <T>(value: T) => {
      if (!signedIn) throw failures.unauthorized()
      return value
    }
    await mockApi(page, {
      'GET /admin/me': () => read(ADMIN),
      'GET /counter/me': () => read(COUNTER),
      'GET /platform/me': () => read(PLATFORM),

    })
    await page.goto(url(path), { waitUntil: 'hydration' })
    await page.getByRole('heading', { level: 1 }).waitFor()
    signedIn = false
    await page.evaluate(() => {
      const channel = new BroadcastChannel('nuk-cafe-admin:auth')
      channel.postMessage({ event: 'logout' })
      setTimeout(() => channel.close(), 100)
    })
    await page.waitForURL(address => address.pathname === signIn)
    await page.getByLabel('Email', { exact: true }).waitFor()
    expect(await page.getByRole('heading', { name: 'Account security', exact: true }).count()).toBe(0)
  })

  it('a fake reset token stays out of the SSR payload and is discarded on departure', async () => {
    const marker = 'fake-reset-marker-for-state-test'
    const response = await fetch(url(`/reset-password?token=${marker}`))
    expect(await response.text()).not.toContain(marker)
    const page = await createPage()
    await mockApi(page)
    await page.goto(url(`/reset-password?token=${marker}`), { waitUntil: 'hydration' })
    await page.waitForURL(url('/reset-password'))
    await page.getByLabel('New password', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Back to sign in', exact: true }).click()
    await page.getByLabel('Email', { exact: true }).waitFor()
    await page.goBack()
    await page.getByRole('heading', { name: 'This link doesn\'t work anymore', exact: true }).waitFor()
  })

  it('password recovery keeps the customer return path in its callback and Back link', async () => {
    const page = await createPage()
    let callback = ''
    await mockApi(page, { 'POST /auth/request-password-reset': ({ body,
    }) => {
      callback = (body as { redirectTo: string
      }).redirectTo
      return { success: true }
    },
    })
    await page.goto(url('/sign-in?redirect=/c/nuk/checkout'), { waitUntil: 'hydration' })
    await page.getByRole('link', { name: 'Forgot password?', exact: true }).click()
    await page.getByRole('heading', { name: 'Forgot your password?', exact: true }).waitFor()
    await page.getByLabel('Email', { exact: true }).fill(USER.email)
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
    await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor()
    expect(new URL(callback, url('/')).searchParams.get('redirect')).toBe('/c/nuk/checkout')
    await page.getByRole('link', { name: 'Back to sign in', exact: true }).click()
    await page.waitForURL(address => address.pathname === '/sign-in')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/c/nuk/checkout')
  })

  it('a failed workspace session check can be retried without showing credentials first', async () => {
    allowBrowserProblems(/GET \/api\/c\/nuk\/admin\/me → 500/)
    const page = await createPage()
    let failed = true
    await mockApi(page, {
      'GET /admin/me': () => {
        if (failed) throw failures.server()
        return ADMIN
      },
    })
    await page.goto(url('/c/nuk/admin/login?redirect=/c/nuk/admin/categories'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { name: 'Could not check your session', exact: true }).waitFor()
    expect(await page.getByLabel('Email', { exact: true }).count()).toBe(0)
    failed = false
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.waitForURL(url('/c/nuk/admin/categories'))
  })

  it('Your cafes does not infer no cafe access from a failed account/role read', async () => {
    allowBrowserProblems(
      /GET \/api\/auth\/get-session → 503/,
      /console.error: \[nuxt-better-auth\] Failed to fetch session during app startup: Error: \[nuxt-better-auth\] Failed to fetch session: Mock session check unavailable\./,
    )
    const page = await createPage()
    await mockApi(page, {
      'GET /me/cafes': () => [],
      'GET /auth/get-session': () => { throw new MockFailure(503, 'SERVER_ERROR', 'Mock session check unavailable.') },
    })
    await page.goto(url('/cafes'), { waitUntil: 'hydration' })
    await page.getByText('Could not load your cafes', { exact: true }).waitFor()
    expect(await page.getByText('You don\'t have access to a cafe yet', { exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Switch account', exact: true }).count()).toBe(0)
  })

  it('an older session answer cannot turn two-step sign-in back on after a newer success', async () => {
    const page = await createPage()
    const oldRead = deferred()
    let passwordChanged = false
    let enabled = true
    await mockApi(page, {
      'GET /admin/me': request => passwordChanged && enabled ? oldRead.handler(request) : { ...ADMIN, twoFactorEnabled: enabled },
      'POST /auth/change-password': () => {
        passwordChanged = true
        return { success: true }
      },
      'POST /auth/two-factor/disable': () => {
        enabled = false
        return { success: true }
      },
    })
    await page.goto(url('/c/nuk/admin/change-password?redirect=/c/nuk/admin/account-security'), { waitUntil: 'hydration' })
    await page.getByLabel(/^Current password/).fill('old password')
    await page.getByLabel(/^New password/).fill('a new long password')
    await page.getByLabel(/^Repeat new password/).fill('a new long password')
    await page.getByRole('button', { name: 'Change password', exact: true }).click()
    await oldRead.started()
    await page.getByRole('heading', { name: 'Account security', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Turn off', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Turn off two-step sign-in?' })
    await dialog.getByLabel('Your password').fill('a new long password')
    await dialog.getByRole('button', { name: 'Turn off', exact: true }).click()
    await expect.poll(() => page.getByTestId('two-factor-status').textContent()).toBe('Off')
    oldRead.release({ ...ADMIN, twoFactorEnabled: true })
    await page.waitForTimeout(200)
    expect(await page.getByTestId('two-factor-status').textContent()).toBe('Off')
  })

  it('an identity change during password reset discards the token and the late completion', async () => {
    const page = await createPage()
    const held = gate()
    let submitted = false
    await mockApi(page, {
      'POST /auth/reset-password': async () => {
        submitted = true
        await held.promise
        return { success: true }
      },
    })
    await page.goto(url('/reset-password?token=interrupted-reset-fake-token'), { waitUntil: 'hydration' })
    await page.getByLabel('New password', { exact: true }).fill('a new long password')
    await page.getByRole('button', { name: 'Save password', exact: true }).click()
    await expect.poll(() => submitted).toBe(true)
    await page.evaluate(() => {
      const channel = new BroadcastChannel('nuk-cafe-admin:auth')
      channel.postMessage({ event: 'login' })
      setTimeout(() => channel.close(), 100)
    })
    await page.waitForTimeout(200)
    held.release()
    await page.getByRole('heading', { name: 'This link doesn\'t work anymore', exact: true }).waitFor()
    expect(new URL(page.url()).pathname).toBe('/reset-password')
    expect(await page.getByRole('button', { name: 'Save password', exact: true }).count()).toBe(0)
  })

  it('leaving a pending sign-in prevents its late completion from redirecting the new page', async () => {
    const page = await createPage()
    const held = gate()
    let signedIn = false
    let submitted = false
    await mockApi(page, {
      'GET /auth/get-session': () => signedIn ? SESSION : null,
      'POST /auth/sign-in/email': async () => {
        submitted = true
        await held.promise
        signedIn = true
        return SESSION
      },
    })
    await page.goto(url('/sign-in?redirect=/verify-email'), { waitUntil: 'hydration' })
    await page.getByLabel('Email', { exact: true }).fill(USER.email)
    await page.getByLabel('Password', { exact: true }).fill('account-only-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect.poll(() => submitted).toBe(true)
    await page.getByRole('link', { name: 'Back to home', exact: true }).click()
    await page.waitForURL(url('/'))
    held.release()
    await page.getByRole('button', { name: 'AO, account: Account One', exact: true }).waitFor()
    await page.waitForTimeout(300) // The released auth action may settle, but its old page cannot advance.
    expect(new URL(page.url()).pathname).toBe('/')
  })

  it('an ordinary role refresh keeps the already-decided Your cafes content visible', async () => {
    const page = await createPage()
    const held = gate()
    let holding = false
    let reads = 0
    await mockApi(page, {
      'GET /me/cafes': () => [],
      'GET /auth/get-session': async () => {
        reads++
        if (holding) await held.promise
        return SESSION
      },
    })
    await page.goto(url('/cafes'), { waitUntil: 'hydration' })
    const message = page.getByText('You don\'t have access to a cafe yet', { exact: true })
    await message.waitFor()
    const before = reads
    holding = true
    await page.evaluate(() => {
      const channel = new BroadcastChannel('nuk-cafe-admin:data-changed')
      channel.postMessage({ features: ['cafe'] })
      setTimeout(() => channel.close(), 100)
    })
    await expect.poll(() => reads).toBeGreaterThan(before)
    expect(await message.isVisible()).toBe(true)
    held.release()
  })

  it('a two-factor change refreshes the same account at another workspace without signing it out', async () => {
    const [admin, counter] = await openTabs(2)
    let enabled = true
    await mockApi(admin!, {
      'GET /admin/me': () => ({ ...ADMIN, userId: USER.id, twoFactorEnabled: enabled }),
      'POST /auth/two-factor/disable': () => {
        enabled = false
        return { success: true }
      },
    })
    await mockApi(counter!, { 'GET /counter/me': () => ({ ...COUNTER, twoFactorEnabled: enabled }) })
    await gotoHydrated(admin!, '/c/nuk/admin/account-security')
    await gotoHydrated(counter!, '/c/nuk/counter/account-security')
    await expect.poll(() => counter!.getByTestId('two-factor-status').textContent()).toBe('On')
    await admin!.getByRole('button', { name: 'Turn off', exact: true }).click()
    const dialog = admin!.getByRole('dialog', { name: 'Turn off two-step sign-in?' })
    await dialog.getByLabel('Your password').fill('account-only-password')
    await dialog.getByRole('button', { name: 'Turn off', exact: true }).click()
    await expect.poll(() => counter!.getByTestId('two-factor-status').textContent()).toBe('Off')
    expect(new URL(counter!.url()).pathname).toBe('/c/nuk/counter/account-security')
  })

  it('returning through an account page to another cafe starts a fresh app instance', async () => {
    const page = await createPage()
    const pending = deferred()
    let signedIn = false
    await mockApi(page, {
      'GET /cafes/brown-bean': () => ({ slug: 'brown-bean', name: 'Brown Bean', logoUrl: null, status: 'active' }),
      'GET /auth/get-session': () => signedIn ? SESSION : null,
      'GET /shop/me': () => ({ ...USER, guest: false, memberCode: 'ABCD-EFGH', phone: null, marketingOptIn: false, workspaces: [], createdAt: '2026-11-02T00:00:00.000Z' }),
      'GET /shop/orders': pending.handler,
      'POST /public/checkout/quote': pending.handler,
    })
    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor()
    signedIn = true
    await page.evaluate(() => {
      const app = document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } } } }
      void app.__vue_app__.config.globalProperties.$router.push('/sign-in?redirect=/c/brown-bean/checkout')
    })
    await page.waitForURL(url('/c/brown-bean/checkout'))
    await page.waitForLoadState('domcontentloaded')
    expect(await page.evaluate(() => new URL((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).name).pathname)).toBe('/c/brown-bean/checkout')
  })
})
