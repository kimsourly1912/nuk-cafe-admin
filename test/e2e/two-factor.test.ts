import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { AdminSession, CounterSession } from '../../shared/contracts/identity'
import type { PlatformSession } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { ADMIN, deferred, failures, gotoHydrated, MockFailure, mockApi, NUK_PROFILE, openTabs, setupE2e, SIGNED_OUT, toast } from './support/mock-api'
import { asNewVisitor } from './support/client-address'

await setupE2e()

const seed = inject('shopSeed')

// Two-step sign-in (P1b, D188) in the browser, against a mocked API: the platform console sends a
// super admin without it to its setup, and every sign-in (the console, a cafe's admin, its counter
// and the customer account) asks for the code after the password when the account has it.

const SUPER: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }
const TOTP_URI = 'otpauth://totp/Angder:ops%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Angder'
const BACKUP_CODES = ['aaaa1-bbbb2', 'cccc3-dddd4', 'eeee5-ffff6', 'gggg7-hhhh8']

const TWO_FACTOR_REDIRECT = () => ({ twoFactorRedirect: true, twoFactorMethods: ['totp'] })
const wrongCode = () => new MockFailure(401, 'INVALID_CODE', 'Invalid code')

async function open(path: string, handlers: Record<string, MockHandler>) {
  const page = await createPage()
  page.setDefaultTimeout(8000)
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

async function password(page: Page, button = 'Sign in') {
  await page.getByLabel('Email').fill('ops@example.com')
  await page.getByLabel('Password', { exact: true }).fill('a long password')
  await page.getByRole('button', { name: button, exact: true }).click()
}

/** The sign-in code step's cells (a pin input; a backup code is a plain field). */
const APP_CODE_CELL = 'input[autocomplete="one-time-code"]'
async function enterAppCode(page: Page, code: string) {
  const cells = page.locator(APP_CODE_CELL)
  for (let i = 0; i < 6; i++) await cells.nth(i).fill(code[i] ?? '')
}

/** The setup's code field is six cells: empty each, then fill one digit per cell. */
async function enterSetupCode(page: Page, code: string) {
  const cells = page.locator('#two-factor-code input:not([type="hidden"])')
  for (let i = 0; i < 6; i++) await cells.nth(i).fill(code[i] ?? '')
}

describe('setting up two-step sign-in in the platform console', () => {
  it('is the only page until it is on: password, QR code and key, backup codes, then a code from the app', async () => {
    let session: PlatformSession = { ...SUPER, twoFactorEnabled: false }
    const sent: { path: string, body: unknown }[] = []
    const { page } = await open('/platform/accounts', {
      'GET /platform/me': () => session,
      'POST /auth/two-factor/enable': ({ body }) => {
        sent.push({ path: 'enable', body })
        return { totpURI: TOTP_URI, backupCodes: BACKUP_CODES }
      },
      'POST /auth/two-factor/verify-totp': ({ body }) => {
        sent.push({ path: 'verify', body })
        if ((body as { code: string }).code !== '123456') throw wrongCode()
        session = SUPER
        return { token: 't', user: { id: SUPER.userId } }
      },
      'GET /platform/accounts': () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
    })
    await page.waitForURL(address => address.pathname === '/platform/two-factor' && address.searchParams.get('redirect') === '/platform/accounts')
    await page.getByRole('heading', { name: 'Set up two-step sign-in' }).waitFor()
    await page.getByLabel('Your password').fill('a long password')
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.getByRole('img', { name: 'QR code for your authenticator app' }).waitFor()
    await page.getByRole('button', { name: 'Can\'t scan? Use a setup key' }).click()
    await page.getByTestId('two-factor-key').getByText('JBSW Y3DP EHPK 3PXP').waitFor()
    await page.getByTestId('backup-codes').getByText('aaaa1-bbbb2').waitFor()

    // Turning it on waits until the backup codes are saved.
    const turnOn = page.getByRole('button', { name: 'Turn on two-step sign-in' })
    await enterSetupCode(page, '000000')
    expect(await turnOn.isDisabled()).toBe(true)
    await page.getByRole('checkbox', { name: 'I\'ve saved my backup codes' }).click()
    await turnOn.click()
    await page.getByText(/That code isn't right/).waitFor()

    // The cells are emptied for the next try.
    await enterSetupCode(page, '123456')
    await turnOn.click()
    await toast(page, 'Two-step sign-in is on').waitFor()
    await page.waitForURL(address => address.pathname === '/platform/accounts')
    expect(sent).toEqual([
      { path: 'enable', body: { password: 'a long password', method: 'totp' } },
      { path: 'verify', body: { code: '000000' } },
      { path: 'verify', body: { code: '123456' } },
    ])
  })

  it('a wrong password says so and shows no codes', async () => {
    const { page } = await open('/platform/two-factor', {
      'GET /platform/me': () => ({ ...SUPER, twoFactorEnabled: false }),
      'POST /auth/two-factor/enable': () => {
        throw new MockFailure(400, 'INVALID_PASSWORD', 'Invalid password')
      },
    })
    await page.getByLabel('Your password').fill('wrong')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('alert').getByText('Your password is incorrect.').waitFor()
    expect(await page.getByTestId('backup-codes').count()).toBe(0)
  })
})

describe('signing in with two-step sign-in', () => {
  it('the platform console asks for the code after the password, and takes a backup code instead', async () => {
    let signedIn = false
    const verified: string[] = []
    const totpSent: string[] = []
    const { page } = await open('/platform/sign-in', {
      'GET /platform/me': () => {
        if (!signedIn) throw new MockFailure(401, 'UNAUTHENTICATED', 'Sign in to continue.')
        return SUPER
      },
      'POST /auth/sign-in/email': TWO_FACTOR_REDIRECT,
      'POST /auth/two-factor/verify-totp': ({ body }) => {
        totpSent.push((body as { code: string }).code)
        throw wrongCode()
      },
      'POST /auth/two-factor/verify-backup-code': ({ body }) => {
        verified.push((body as { code: string }).code)
        signedIn = true
        return { token: 't', user: { id: SUPER.userId } }
      },
      'GET /platform/tenants': () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
      'GET /platform/tenants/counts': () => ({ active: 0, suspended: 0 }),
      'GET /platform/overview': () => ({ cafes: { active: 0, suspended: 0 }, newCafesThisMonth: 0, quietCafes: 0, noActiveOwner: 0, bannedAccounts: 0, timeZone: 'Asia/Phnom_Penh' }),
    })
    await password(page)
    await page.getByText(/enter the 6-digit code for Angder/).waitFor()
    // Six digits, checked before asking.
    await enterAppCode(page, '12')
    await page.getByRole('button', { name: 'Verify' }).click()
    await page.getByText('Enter the 6 digits from your app').waitFor()
    // The sixth digit sends it: no button press.
    await enterAppCode(page, '654321')
    await page.getByRole('alert').getByText(/That code isn't right/).waitFor()
    // Sent once, though the pin input announces the full code more than once.
    await page.waitForTimeout(500)
    expect(totpSent).toEqual(['654321'])

    await page.getByRole('button', { name: 'Use a backup code instead' }).click()
    await page.getByLabel('Backup code', { exact: true }).fill('aaaa1-bbbb2')
    await page.getByRole('button', { name: 'Verify' }).click()
    await page.waitForURL(address => address.pathname === '/platform')
    expect(verified).toEqual(['aaaa1-bbbb2'])
  })

  it('a sign-in that timed out or had too many tries goes back to the password, saying why', async () => {
    const { page } = await open('/platform/sign-in', {
      'GET /platform/me': () => {
        throw new MockFailure(401, 'UNAUTHENTICATED', 'Sign in to continue.')
      },
      'POST /auth/sign-in/email': TWO_FACTOR_REDIRECT,
      'POST /auth/two-factor/verify-totp': () => {
        throw new MockFailure(401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie')
      },
    })
    await password(page)
    await enterAppCode(page, '123456')
    await page.getByRole('alert').getByText('This sign-in timed out or had too many tries. Sign in again.').waitFor()
    await page.getByLabel('Password', { exact: true }).waitFor()
  })

  it('a cafe\'s admin asks for the code too, then opens', async () => {
    let signedIn = false
    const { page } = await open('/c/nuk/admin/login', {
      ...SIGNED_OUT,
      'GET /admin/me': () => {
        if (!signedIn) throw new MockFailure(401, 'UNAUTHENTICATED', 'Sign in to continue.')
        return ADMIN
      },
      'POST /auth/sign-in/email': TWO_FACTOR_REDIRECT,
      'POST /auth/two-factor/verify-totp': () => {
        signedIn = true
        return { token: 't', user: { id: ADMIN.userId } }
      },
    })
    await password(page)
    await enterAppCode(page, '123456')
    await expect.poll(() => new URL(page.url()).pathname).not.toBe('/c/nuk/admin/login')
    expect(new URL(page.url()).pathname).toMatch(/^\/c\/nuk\/admin(\/|$)/)
  })

  it('a cafe\'s admin refuses a manager only after the code, then offers the counter, still signed in (E1)', async () => {
    let signedIn = false
    const { page, api } = await open('/c/nuk/admin/login', {
      ...SIGNED_OUT,
      'GET /admin/me': () => {
        if (!signedIn) throw new MockFailure(401, 'UNAUTHENTICATED', 'Sign in to continue.')
        throw failures.forbidden()
      },
      'POST /auth/sign-in/email': TWO_FACTOR_REDIRECT,
      'POST /auth/two-factor/verify-totp': () => {
        signedIn = true
        return { token: 't', user: { id: 'manager-1' } }
      },
      'GET /me/cafes': () => [{ ...NUK_PROFILE, workspaces: ['counter'] }],
    })
    await password(page)
    await enterAppCode(page, '123456')
    await page.getByRole('heading', { name: 'No access to the admin app' }).waitFor()
    expect(await page.getByRole('link', { name: 'Open the counter' }).getAttribute('href')).toBe('/c/nuk/counter')
    expect(api.calls.filter(c => c.startsWith('POST /auth/two-factor'))).toEqual(['POST /auth/two-factor/verify-totp'])
    expect(api.calls).not.toContain('POST /auth/sign-out')
  })

  it('a cafe\'s counter asks for the code too; Back returns to the password', async () => {
    const { page, api } = await open('/c/nuk/counter/sign-in', {
      'GET /counter/me': () => {
        throw new MockFailure(401, 'UNAUTHENTICATED', 'Sign in to continue.')
      },
      'POST /auth/sign-in/email': TWO_FACTOR_REDIRECT,
    })
    await password(page)
    await (page).locator(APP_CODE_CELL).first().waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByLabel('Password', { exact: true }).waitFor()
    expect(api.calls.filter(c => c.startsWith('POST /auth/two-factor'))).toEqual([])
  })
  it('the customer account asks for the code too, then comes back signed in', async () => {
    let signedIn = false
    const user = { id: 'cust-1', email: 'ops@example.com', name: 'Ops', emailVerified: true, mustChangePassword: false }
    const menu = deferred()
    // From a cafe's menu, as customers arrive (D221: the account pages name no cafe of their own).
    const { page } = await open('/sign-in?redirect=/c/nuk', {
      'GET /auth/get-session': () => (signedIn ? { user, session: { id: 's1' } } : null),
      'POST /auth/sign-in/email': TWO_FACTOR_REDIRECT,
      'POST /auth/two-factor/verify-totp': () => {
        signedIn = true
        return { token: 't', user }
      },
      'GET /shop/me': () => ({ guest: false, name: 'Ops', email: user.email, emailVerified: true, memberCode: 'ABCD-EFGH', phone: null, marketingOptIn: false, createdAt: '2026-10-01T00:00:00.000Z', workspaces: [] }),
      // The menu it returns to: held back, it isn't what this test checks.
      'GET /public/branches': menu.handler,
      'GET /public/menu': menu.handler,
      'GET /shop/orders': menu.handler,
    })
    await password(page)
    await enterAppCode(page, '123456')
    await expect.poll(() => new URL(page.url()).pathname).not.toBe('/sign-in')
    await menu.started()
  })
})

/** The authenticator app's code now for a setup key (base32, as the page shows it): RFC 6238, 6 digits, 30 s. */
function totpCode(key: string, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...key.replace(/[\s=]/g, '')].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  const secret = Buffer.from(bits.match(/.{8}/g)!.map(byte => Number.parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const hash = createHmac('sha1', secret).update(counter).digest()
  const offset = hash[hash.length - 1]! & 0xf
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/** Account security's setup, from Turn on to Turn on two-step sign-in, with this code. */
async function setUpOnAccountSecurity(page: Page, code: (page: Page) => Promise<string>) {
  await page.getByRole('button', { name: 'Turn on', exact: true }).click()
  await page.getByLabel('Your password').fill('a long password')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByTestId('backup-codes').waitFor()
  await page.getByRole('checkbox', { name: 'I\'ve saved my backup codes' }).click()
  await enterSetupCode(page, await code(page))
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click()
}

describe('account security for owners and staff (D242)', () => {
  it('an owner turns it on from the admin\'s user menu, and off with the password', async () => {
    let session: AdminSession = ADMIN
    const sent: { path: string, body: unknown }[] = []
    const { page } = await open('/c/nuk/admin', {
      'GET /admin/me': () => session,
      'POST /auth/two-factor/enable': ({ body }) => {
        sent.push({ path: 'enable', body })
        return { totpURI: TOTP_URI, backupCodes: BACKUP_CODES }
      },
      'POST /auth/two-factor/verify-totp': ({ body }) => {
        sent.push({ path: 'verify', body })
        session = { ...ADMIN, twoFactorEnabled: true }
        return { token: 't', user: { id: ADMIN.userId } }
      },
      'POST /auth/two-factor/disable': ({ body }) => {
        sent.push({ path: 'disable', body })
        if ((body as { password: string }).password !== 'a long password') throw new MockFailure(400, 'INVALID_PASSWORD', 'Invalid password')
        session = ADMIN
        return { status: true }
      },
    })
    await page.getByRole('button', { name: 'alice', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Account security' }).click()
    await page.getByRole('heading', { name: 'Account security' }).waitFor()
    expect(await page.getByTestId('two-factor-status').textContent()).toBe('Off')

    await setUpOnAccountSecurity(page, async () => '123456')
    await toast(page, 'Two-step sign-in is on').waitFor()
    await page.getByText('You were signed out on your other devices.', { exact: true }).waitFor()
    await expect.poll(() => page.getByTestId('two-factor-status').textContent()).toBe('On')

    await page.getByRole('button', { name: 'Turn off' }).click()
    const dialog = page.getByRole('dialog', { name: 'Turn off two-step sign-in?' })
    await dialog.getByLabel('Your password').fill('wrong')
    await dialog.getByRole('button', { name: 'Turn off' }).click()
    await dialog.getByText('Your password is incorrect.').first().waitFor()
    await dialog.getByLabel('Your password').fill('a long password')
    await dialog.getByRole('button', { name: 'Turn off' }).click()
    await toast(page, 'Two-step sign-in is off').waitFor()
    await dialog.waitFor({ state: 'hidden' })
    await expect.poll(() => page.getByTestId('two-factor-status').textContent()).toBe('Off')
    expect(sent).toEqual([
      { path: 'enable', body: { password: 'a long password', method: 'totp' } },
      { path: 'verify', body: { code: '123456' } },
      { path: 'disable', body: { password: 'wrong' } },
      { path: 'disable', body: { password: 'a long password' } },
    ])

    await page.getByRole('link', { name: 'Back' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin')
  })

  it('Cancel leaves the setup without turning it on', async () => {
    const { page, api } = await open('/c/nuk/admin/account-security', {
      'POST /auth/two-factor/enable': () => ({ totpURI: TOTP_URI, backupCodes: BACKUP_CODES }),
    })
    await page.getByRole('button', { name: 'Turn on', exact: true }).click()
    await page.getByLabel('Your password').fill('a long password')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByTestId('backup-codes').waitFor()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('heading', { name: 'Account security' }).waitFor()
    expect(await page.getByTestId('two-factor-status').textContent()).toBe('Off')
    expect(api.calls.filter(c => c.startsWith('POST /auth/two-factor'))).toEqual(['POST /auth/two-factor/enable'])
  })

  it('another person signing in elsewhere never sees this one\'s setup key or backup codes', async () => {
    const [aliceTab, bobTab] = await openTabs(2)
    let who: 'alice' | 'bob' = 'alice'
    const BOB: AdminSession = { ...ADMIN, userId: 'user-bob', email: 'bob@nukcafe.test', name: 'bob' }
    await mockApi(aliceTab!, {
      'GET /admin/me': () => (who === 'alice' ? ADMIN : BOB),
      'POST /auth/two-factor/enable': () => ({ totpURI: TOTP_URI, backupCodes: BACKUP_CODES }),
    })
    await mockApi(bobTab!, {
      'GET /admin/me': () => {
        if (who === 'alice') throw failures.unauthorized()
        return BOB
      },
      'POST /auth/sign-in/email': () => {
        who = 'bob'
        return { token: 't' }
      },
    })
    await gotoHydrated(aliceTab!, '/c/nuk/admin/account-security')
    await aliceTab!.getByRole('button', { name: 'Turn on', exact: true }).click()
    await aliceTab!.getByLabel('Your password').fill('a long password')
    await aliceTab!.getByRole('button', { name: 'Continue' }).click()
    await aliceTab!.getByTestId('backup-codes').waitFor()

    await gotoHydrated(bobTab!, '/c/nuk/admin/login')
    await bobTab!.getByLabel('Email').fill(BOB.email)
    await bobTab!.getByLabel('Password', { exact: true }).fill('secret')
    await bobTab!.getByRole('button', { name: 'Sign in' }).click()
    // Alice's tab follows the new identity: the page starts again, without her codes.
    await aliceTab!.getByRole('button', { name: 'Turn on', exact: true }).waitFor({ timeout: 10_000 })
    expect(await aliceTab!.getByTestId('backup-codes').count()).toBe(0)
    expect(await aliceTab!.getByText('aaaa1-bbbb2').count()).toBe(0)
  })

  it('a cashier turns it on and off at the counter', async () => {
    const cashier: CounterSession = { userId: 'cashier-1', email: 'cashier@example.com', name: 'Sophea', mustChangePassword: false, twoFactorEnabled: false, branches: [{ id: 'branch-1', name: 'Riverside', role: 'staff', permissions: [] }] }
    let session = cashier
    const { page } = await open('/c/nuk/counter/account-security', {
      'GET /counter/me': () => session,
      'POST /auth/two-factor/enable': () => ({ totpURI: TOTP_URI, backupCodes: BACKUP_CODES }),
      'POST /auth/two-factor/verify-totp': () => {
        session = { ...cashier, twoFactorEnabled: true }
        return { token: 't', user: { id: cashier.userId } }
      },
      'POST /auth/two-factor/disable': () => {
        session = cashier
        return { status: true }
      },
    })
    await page.getByRole('heading', { name: 'Account security' }).waitFor()
    await setUpOnAccountSecurity(page, async () => '123456')
    await toast(page, 'Two-step sign-in is on').waitFor()
    await expect.poll(() => page.getByTestId('two-factor-status').textContent()).toBe('On')
    await page.getByRole('button', { name: 'Turn off' }).click()
    const dialog = page.getByRole('dialog', { name: 'Turn off two-step sign-in?' })
    await dialog.getByLabel('Your password').fill('a long password')
    await dialog.getByRole('button', { name: 'Turn off' }).click()
    await toast(page, 'Two-step sign-in is off').waitFor()
    await expect.poll(() => page.getByTestId('two-factor-status').textContent()).toBe('Off')
    expect(await page.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/c/nuk/counter')
  })

  it('a super admin who owns a cafe is told the console needs it on', async () => {
    const { page } = await open('/c/nuk/admin/account-security', {
      'GET /admin/me': () => ({ ...ADMIN, twoFactorEnabled: true }),
      'POST /auth/two-factor/disable': () => {
        throw new MockFailure(403, 'TWO_FACTOR_REQUIRED', 'The platform team must keep two-step sign-in on.')
      },
    })
    await page.getByRole('button', { name: 'Turn off' }).click()
    const dialog = page.getByRole('dialog', { name: 'Turn off two-step sign-in?' })
    await dialog.getByLabel('Your password').fill('a long password')
    await dialog.getByRole('button', { name: 'Turn off' }).click()
    await dialog.getByRole('alert').getByText('The platform team must keep two-step sign-in on.').waitFor()
    expect(await page.getByTestId('two-factor-status').textContent()).toBe('On')
  })

  it('on the real server: a cashier turns it on at the counter, and the next sign-in asks for the code', async () => {
    const { email, password: ownPassword } = seed.customers.twoStepCashier
    const page = await createPage()
    page.setDefaultTimeout(10_000)
    await asNewVisitor(page)
    const signInAtCounter = async () => {
      await page.waitForURL(u => u.pathname === '/c/nuk/counter/sign-in')
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password', { exact: true }).fill(ownPassword)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    }
    await page.goto(url('/c/nuk/counter'), { waitUntil: 'hydration' })
    await signInAtCounter()
    await page.waitForURL(u => u.pathname === `/c/nuk/counter/${seed.openBranchId}`)
    await page.getByRole('button', { name: /, account:/ }).click()
    await page.getByRole('menuitem', { name: 'Account security' }).click()
    await page.getByRole('heading', { name: 'Account security' }).waitFor()

    await page.getByRole('button', { name: 'Turn on', exact: true }).click()
    await page.getByLabel('Your password').fill(ownPassword)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Can\'t scan? Use a setup key' }).click()
    const key = (await page.getByTestId('two-factor-key').textContent())!.trim()
    await page.getByRole('checkbox', { name: 'I\'ve saved my backup codes' }).click()
    await enterSetupCode(page, totpCode(key))
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click()
    await toast(page, 'Two-step sign-in is on').waitFor()
    await expect.poll(() => page.getByTestId('two-factor-status').textContent()).toBe('On')

    // Signed out, the password alone no longer opens the counter.
    await page.goto(url(`/c/nuk/counter/${seed.openBranchId}`), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: /, account:/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await signInAtCounter()
    await page.locator(APP_CODE_CELL).first().waitFor()
    expect(new URL(page.url()).pathname).toBe('/c/nuk/counter/sign-in')
    await enterAppCode(page, totpCode(key))
    await page.waitForURL(u => u.pathname === `/c/nuk/counter/${seed.openBranchId}`)

    // Off again with the password: the account is as seeded.
    await page.goto(url('/c/nuk/counter/account-security'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Turn off' }).click()
    const dialog = page.getByRole('dialog', { name: 'Turn off two-step sign-in?' })
    await dialog.getByLabel('Your password').fill(ownPassword)
    await dialog.getByRole('button', { name: 'Turn off' }).click()
    await expect.poll(() => page.getByTestId('two-factor-status').textContent()).toBe('Off')
  })
})

describe('accessibility', () => {
  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
  async function axeFindings(page: Page): Promise<string[]> {
    await page.evaluate(axeSource)
    return page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string, nodes: { target: string[] }[] }[] }> } }).axe
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).slice(0, 4).join(', ')}`)
    })
  }

  it('the setup and the code step meet the rules in light and dark, wide and narrow', async () => {
    for (const width of [1440, 390]) {
      const setup = await open('/platform/two-factor', {
        'GET /platform/me': () => ({ ...SUPER, twoFactorEnabled: false }),
        'POST /auth/two-factor/enable': () => ({ totpURI: TOTP_URI, backupCodes: BACKUP_CODES }),
      })
      await setup.page.setViewportSize({ width, height: 844 })
      await setup.page.getByLabel('Your password').fill('a long password')
      await setup.page.getByRole('button', { name: 'Continue' }).click()
      await setup.page.getByTestId('backup-codes').waitFor()
      // The pointer stays where Continue was clicked, over the next step's button: its hover colour isn't what's measured.
      await setup.page.mouse.move(0, 0)
      expect(await axeFindings(setup.page)).toEqual([])
      await setup.page.evaluate(() => document.documentElement.classList.add('dark'))
      await setup.page.waitForTimeout(500)
      expect(await axeFindings(setup.page)).toEqual([])
      expect(await setup.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      const code = await open('/platform/sign-in', {
        'GET /platform/me': () => {
          throw new MockFailure(401, 'UNAUTHENTICATED', 'Sign in to continue.')
        },
        'POST /auth/sign-in/email': TWO_FACTOR_REDIRECT,
      })
      await code.page.setViewportSize({ width, height: 844 })
      await password(code.page)
      await (code.page).locator(APP_CODE_CELL).first().waitFor()
      await code.page.mouse.move(0, 0)
      expect(await axeFindings(code.page)).toEqual([])
      await code.page.evaluate(() => document.documentElement.classList.add('dark'))
      await code.page.waitForTimeout(500)
      expect(await axeFindings(code.page)).toEqual([])
    }
  })

  it('account security meets the rules in light and dark, wide and narrow, on and off', async () => {
    for (const width of [1440, 390]) {
      for (const enabled of [false, true]) {
        const { page } = await open('/c/nuk/admin/account-security', { 'GET /admin/me': () => ({ ...ADMIN, twoFactorEnabled: enabled }) })
        await page.setViewportSize({ width, height: 844 })
        await page.getByTestId('two-factor-status').waitFor()
        expect(await axeFindings(page)).toEqual([])
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await page.waitForTimeout(500)
        expect(await axeFindings(page)).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      }
    }
  })
})
