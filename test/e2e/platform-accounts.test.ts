import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { PlatformAccountDetail, PlatformAccountSummary } from '../../shared/contracts/accounts'
import type { PlatformSession } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { failures, lastSegment, mockApi, paginatedHandler, setupE2e, toast } from './support/mock-api'

await setupE2e()

// The platform console's Accounts (step P1, D187) in the browser, against a mocked API: the list
// with its kinds and search, an account's page with its cafes, and the actions (ban with a reason
// and an end, unban, sign out everywhere, a temporary password shown once). The server's own rules
// (versions, refusals, the batch) are covered by the server tests.

const SUPERADMIN: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }

function accountOf(id: string, name: string, overrides: Partial<PlatformAccountDetail> = {}): PlatformAccountDetail {
  return {
    id,
    name,
    email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
    emailVerified: true,
    isSuperadmin: false,
    ownerOf: 0,
    staffOf: 0,
    ban: null,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    cafes: [],
    mustChangePassword: false,
    activeSessions: 2,
    lastActiveAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    version: 10,
    ...overrides,
  }
}

const OWNER = accountOf('acc-1', 'Bea Brown', {
  ownerOf: 1,
  cafes: [{ id: 'cafe-1', name: 'Brown Bean', slug: 'brown-bean', role: 'owner', onlyActiveOwner: true }],
})
const STAFF = accountOf('acc-2', 'Sokha Lead', { staffOf: 1, cafes: [{ id: 'cafe-1', name: 'Brown Bean', slug: 'brown-bean', role: 'staff', onlyActiveOwner: false }] })
const CUSTOMER = accountOf('acc-3', 'Dara Customer', { emailVerified: false })
const BANNED = accountOf('acc-4', 'Gone Person', { ban: { reason: 'Fraudulent orders', until: null }, activeSessions: 0, lastActiveAt: null })
const OTHER_SUPER = accountOf('acc-5', 'Second Admin', { isSuperadmin: true })
const SELF = accountOf(SUPERADMIN.userId, 'Ops', { isSuperadmin: true })
const ALL = [OWNER, STAFF, CUSTOMER, BANNED, OTHER_SUPER]
const summary = ({ cafes: _c, mustChangePassword: _m, activeSessions: _a, lastActiveAt: _l, version: _v, ...account }: PlatformAccountDetail): PlatformAccountSummary => account

/** Accounts filtered by `kind` like the server, then searched and paged. */
function accountsHandler(accounts: () => PlatformAccountDetail[]): MockHandler {
  return (request) => {
    const kind = request.url.searchParams.get('kind')
    const match = (a: PlatformAccountDetail) => !kind
      || (kind === 'owner' && a.ownerOf > 0)
      || (kind === 'staff' && a.staffOf > 0)
      || (kind === 'customer' && !a.ownerOf && !a.staffOf && !a.isSuperadmin)
      || (kind === 'superadmin' && a.isSuperadmin)
      || (kind === 'banned' && !!a.ban)
    return paginatedHandler(() => accounts().filter(match).map(summary))(request)
  }
}

async function open(path: string, handlers: Record<string, MockHandler> = {}, width?: number) {
  const page = await createPage()
  page.setDefaultTimeout(8000)
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, {
    'GET /platform/me': () => SUPERADMIN,
    'GET /platform/accounts': accountsHandler(() => ALL),
    'GET /platform/accounts/{id}': ({ url: address }) => {
      const found = [...ALL, SELF].find(a => a.id === lastSegment(address))
      if (!found) throw failures.notFound('The account was not found.')
      return found
    },
    ...handlers,
  })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const dialog = (page: Page) => page.getByRole('dialog')
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))

describe('accounts', () => {
  it('are in the sidebar, listed with what each does and whether it is banned; the name opens it', async () => {
    const { page } = await open('/platform', {
      'GET /platform/tenants': () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
      'GET /platform/tenants/counts': () => ({ active: 0, suspended: 0 }),
    })
    await page.getByRole('link', { name: 'Accounts' }).click()
    await page.waitForURL(address => address.pathname === '/platform/accounts')
    const bea = page.getByRole('row').filter({ hasText: 'Bea Brown' })
    await bea.getByText('bea@example.com').waitFor()
    await bea.getByText('Owner of 1 cafe').waitFor()
    await bea.getByText('Active').waitFor()
    await page.getByRole('row').filter({ hasText: 'Dara Customer' }).getByText('Customer', { exact: true }).waitFor()
    await page.getByRole('row').filter({ hasText: 'Gone Person' }).getByText('Banned').waitFor()
    await page.getByRole('row').filter({ hasText: 'Second Admin' }).getByText('Super admin').waitFor()

    await page.getByRole('table').getByRole('link', { name: /Bea Brown/ }).click()
    await page.waitForURL(address => address.pathname === '/platform/accounts/acc-1')
  })

  it('filter by kind and search through the URL and the API', async () => {
    const { page, api } = await open('/platform/accounts')
    await page.getByRole('table').getByText('Bea Brown').waitFor()
    await page.getByRole('tab', { name: 'Banned' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('kind')).toBe('banned')
    await page.getByRole('table').getByText('Bea Brown').waitFor({ state: 'detached' })
    await page.getByRole('table').getByText('Gone Person').waitFor()
    await page.getByPlaceholder('Search name or email…').fill('gone')
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('gone')
    expect(api.calls.filter(c => c === 'GET /platform/accounts').length).toBeGreaterThan(2)
  })

  it('on a phone, each account is a row', async () => {
    const { page } = await open('/platform/accounts', {}, 390)
    const list = page.getByRole('list', { name: 'Accounts' })
    await list.getByRole('link', { name: /Bea Brown/ }).waitFor()
    await list.getByText('Owner of 1 cafe').waitFor()
    expect(await page.getByRole('table').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

describe('an account\'s page', () => {
  it('shows who it is, its sessions and the cafes it works in, linking each', async () => {
    const { page } = await open('/platform/accounts/acc-1', {
      'GET /platform/tenants/{id}': () => {
        throw failures.notFound('The cafe was not found.')
      },
    })
    await page.getByText('bea@example.com').waitFor()
    await page.getByText('Verified', { exact: true }).waitFor()
    await page.getByText('2 devices').waitFor()
    await page.getByText('1 hour ago').waitFor()
    await page.getByText('Only owner').waitFor()
    await page.getByRole('link', { name: 'Brown Bean' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-1')
  })

  it('bans with a reason and an end, sending the version, after naming the cafe left without an owner', async () => {
    let account = OWNER
    let sent: { version: number, reason: string, until: string | null } | undefined
    const { page, api } = await open('/platform/accounts/acc-1', {
      'GET /platform/accounts/{id}': () => account,
      'POST /platform/accounts/{id}/ban': ({ body }) => {
        sent = body as typeof sent
        account = { ...account, ban: { reason: sent!.reason, until: sent!.until }, activeSessions: 0, version: 11, cafes: account.cafes.map(c => ({ ...c, onlyActiveOwner: false })) }
        return account
      },
    })
    await page.getByRole('button', { name: 'Ban account' }).click()
    const form = dialog(page)
    await form.getByTestId('ownerless-warning').getByText(/Brown Bean keeps taking orders/).waitFor()
    // A reason is required.
    await form.getByRole('button', { name: 'Ban account' }).click()
    await form.getByText('Required').waitFor()
    await form.getByLabel('Reason').fill('Chargebacks')
    await form.getByRole('radio', { name: '7 days' }).check()
    const before = Date.now()
    await form.getByRole('button', { name: 'Ban account' }).click()
    await toast(page, 'Bea Brown is banned').waitFor()
    await page.getByText(/^Banned until \d/).waitFor()
    await page.getByText('Reason: Chargebacks').waitFor()
    expect(sent).toMatchObject({ version: 10, reason: 'Chargebacks' })
    const days = (new Date(sent!.until!).getTime() - before) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(6.99)
    expect(days).toBeLessThan(7.01)
    expect(writes(api.calls)).toEqual(['POST /platform/accounts/acc-1/ban'])
    // Banned: no ban button, and no temporary password until unbanned.
    await expect.poll(() => page.getByRole('button', { name: 'Ban account' }).count()).toBe(0)
    await expect.poll(() => page.getByRole('button', { name: 'Set temporary password' }).isDisabled()).toBe(true)
  })

  it('unbans after asking, sending the version', async () => {
    let account = BANNED
    const sent: unknown[] = []
    const { page } = await open('/platform/accounts/acc-4', {
      'GET /platform/accounts/{id}': () => account,
      'POST /platform/accounts/{id}/unban': ({ body }) => {
        sent.push(body)
        account = { ...account, ban: null, version: 11 }
        return account
      },
    })
    await page.getByText('Banned until unbanned').waitFor()
    await page.getByText('Reason: Fraudulent orders').waitFor()
    await page.getByRole('button', { name: 'Unban' }).click()
    await dialog(page).getByRole('button', { name: 'Unban' }).click()
    await toast(page, 'Gone Person can sign in again').waitFor()
    await page.getByRole('button', { name: 'Ban account' }).waitFor()
    expect(sent).toEqual([{ version: 10 }])
  })

  it('signs out everywhere after asking', async () => {
    let account = CUSTOMER
    const { page, api } = await open('/platform/accounts/acc-3', {
      'GET /platform/accounts/{id}': () => account,
      'POST /platform/accounts/{id}/sign-out': () => {
        account = { ...account, activeSessions: 0 }
        return account
      },
    })
    await page.getByText('Not verified').waitFor()
    await page.getByRole('button', { name: 'Sign out everywhere' }).click()
    await dialog(page).getByRole('button', { name: 'Sign out everywhere' }).click()
    await toast(page, 'Dara Customer is signed out everywhere').waitFor()
    await page.getByText('No device').waitFor()
    await expect.poll(() => page.getByRole('button', { name: 'Sign out everywhere' }).isDisabled()).toBe(true)
    expect(writes(api.calls)).toEqual(['POST /platform/accounts/acc-3/sign-out'])
  })

  it('sets a temporary password with a reason and shows it once, until Done', async () => {
    let sent: unknown
    let account = STAFF
    const { page } = await open('/platform/accounts/acc-2', {
      'GET /platform/accounts/{id}': () => account,
      'POST /platform/accounts/{id}/temporary-password': ({ body }) => {
        sent = body
        account = { ...STAFF, mustChangePassword: true, activeSessions: 0, version: 11 }
        return { account, temporaryPassword: 'Hq7x-3mPa-kR9t-Wz2c' }
      },
    })
    await page.getByRole('button', { name: 'Set temporary password' }).click()
    const form = dialog(page)
    await form.getByLabel('Reason').fill('Checked by phone')
    await form.getByRole('button', { name: 'Set temporary password' }).click()
    await form.getByTestId('temporary-password').getByText('Hq7x-3mPa-kR9t-Wz2c').waitFor()
    expect(sent).toEqual({ version: 10, reason: 'Checked by phone' })
    // Shown once: Escape doesn't close it, only Done does.
    await page.keyboard.press('Escape')
    await form.getByTestId('temporary-password').waitFor()
    await form.getByRole('button', { name: 'Done' }).click()
    await form.waitFor({ state: 'detached' })
    await page.getByText('Has a temporary password').waitFor()
  })

  it('a change someone else made meanwhile is said, and nothing is shown as banned', async () => {
    const { page } = await open('/platform/accounts/acc-3', {
      'POST /platform/accounts/{id}/ban': () => {
        throw failures.conflict('VERSION_CONFLICT', 'This account was changed by someone else. Reload it and try again.')
      },
    })
    await page.getByRole('button', { name: 'Ban account' }).click()
    await dialog(page).getByLabel('Reason').fill('Spam')
    await dialog(page).getByRole('button', { name: 'Ban account' }).click()
    await toast(page, 'Could not ban Dara Customer').waitFor()
    await dialog(page).getByLabel('Reason').waitFor()
    expect(await page.getByText(/^Banned until/).count()).toBe(0)
  })

  it('a super admin\'s account and one\'s own offer no actions', async () => {
    for (const id of ['acc-5', SUPERADMIN.userId]) {
      const { page } = await open(`/platform/accounts/${id}`)
      await page.getByText('A super admin of the platform').waitFor()
      for (const action of ['Ban account', 'Sign out everywhere', 'Set temporary password']) {
        expect(await page.getByRole('button', { name: action }).count(), `${id}: ${action}`).toBe(0)
      }
    }
  })

  it('an unknown account says so, with the way back', async () => {
    const { page } = await open('/platform/accounts/acc-404x')
    await page.getByText('This account doesn\'t exist').waitFor()
    await page.getByRole('link', { name: 'Back to Accounts' }).first().waitFor()
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

  async function bothModes(page: Page) {
    expect(await axeFindings(page)).toEqual([])
    // Colours ease between the modes: measure once they have settled.
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
  }

  it('the list, an account and the ban dialog meet the rules in light and dark, wide and narrow', async () => {
    for (const width of [1440, 390]) {
      const list = await open('/platform/accounts', {}, width)
      await list.page.getByText('Bea Brown').first().waitFor()
      await bothModes(list.page)

      const detail = await open('/platform/accounts/acc-4', {}, width)
      await detail.page.getByText('Reason: Fraudulent orders').waitFor()
      await bothModes(detail.page)

      const ban = await open('/platform/accounts/acc-1', {}, width)
      await ban.page.getByRole('button', { name: 'Ban account' }).click()
      await dialog(ban.page).getByTestId('ownerless-warning').waitFor()
      await bothModes(ban.page)
    }
  })
})
