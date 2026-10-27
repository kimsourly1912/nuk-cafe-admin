import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { PlatformSession } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { ADMIN, deferred, MockFailure, mockApi, setupE2e, SIGNED_OUT, toast } from './support/mock-api'

await setupE2e()

// Two-step sign-in (P1b, D188) in the browser, against a mocked API: the platform console sends a
// super admin without it to its setup, and every sign-in (the console, a cafe's admin, its counter
// and the customer account) asks for the code after the password when the account has it.

const SUPER: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }
const TOTP_URI = 'otpauth://totp/NUK%20Platform:ops%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=NUK%20Platform'
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
    await page.getByText(/enter the 6-digit code for NUK Platform/).waitFor()
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
})
