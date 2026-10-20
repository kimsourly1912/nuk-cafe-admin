import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { AdminSession } from '../../shared/contracts/identity'
import type { CafeSupport, SupportGrant } from '../../shared/contracts/support'
import type { PlatformSession, TenantDetail } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { ADMIN, MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// Support access (step P5, D193) in the browser, against a mocked API: the owner allows and ends it
// on Platform support, sees it while it's on, and who looked; a super admin opens the cafe from the
// console with a fresh code and sees the admin as read-only, with Leave. That support can only read
// (GET, the support permissions, its own session, audited) is the server's rule
// (support.service.test.ts, support-access.test.ts).

const UNTIL = '2026-10-20T05:00:00.000Z'
const GRANT: SupportGrant = {
  id: 'grant-1',
  grantedBy: { id: 'user-1', name: 'alice' },
  grantedAt: '2026-10-19T05:00:00.000Z',
  expiresAt: UNTIL,
  endedAt: null,
  endedBy: null,
  active: true,
  visits: [{ id: 'visit-1', by: { id: 'super-1', name: 'Ops' }, openedAt: '2026-10-19T05:10:00.000Z', expiresAt: '2026-10-19T06:10:00.000Z', closedAt: null, active: true }],
}
const OLD: SupportGrant = { ...GRANT, id: 'grant-0', active: false, grantedAt: '2026-10-01T05:00:00.000Z', expiresAt: '2026-10-02T05:00:00.000Z', endedAt: '2026-10-01T08:00:00.000Z', endedBy: { id: 'user-1', name: 'alice' }, visits: [] }
const SUPPORT_SESSION: AdminSession = {
  userId: 'super-1',
  email: 'ops@example.com',
  name: 'Ops',
  role: 'support',
  permissions: ['menu:read', 'report:read'],
  mustChangePassword: false,
  support: { tenantId: 'cafe-1', visitExpiresAt: '2026-10-19T06:10:00.000Z', grantExpiresAt: UNTIL },
  supportAllowedUntil: UNTIL,
}
const SUPERADMIN: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }
const CAFE: TenantDetail = {
  id: 'cafe-1',
  name: 'NUK Cafe',
  slug: 'nuk',
  status: 'active',
  suspendedReason: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  version: 3,
  usage: { branches: 1, staff: 2, ordersLast30Days: 4, lastOrderAt: null },
  activeOwners: 1,
  owners: [{ id: 'user-1', name: 'alice', email: 'admin@nukcafe.test', banned: false, staffAccess: false }],
  formerSlugs: [],
  notes: { contactName: null, contactPhone: null, notes: null, version: 0, updatedAt: null },
  support: { grantedAt: GRANT.grantedAt, expiresAt: UNTIL },
}

async function open(path: string, handlers: Record<string, MockHandler> = {}, width?: number) {
  const page = await createPage()
  page.setDefaultTimeout(8000)
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const dialog = (page: Page) => page.getByRole('dialog')

describe('the owner', () => {
  it('allows platform support for 24 hours after asking, then sees it on every page until they end it', async () => {
    let support: CafeSupport = { active: null, history: [OLD] }
    let session: AdminSession = ADMIN
    const writes: string[] = []
    const { page } = await open('/c/nuk/admin/support', {
      'GET /admin/me': () => session,
      'GET /admin/support': () => support,
      'POST /admin/support': () => {
        writes.push('allow')
        support = { active: { ...GRANT, visits: [] }, history: [{ ...GRANT, visits: [] }, OLD] }
        session = { ...ADMIN, supportAllowedUntil: UNTIL }
        return support
      },
      'POST /admin/support/{id}/end': () => {
        writes.push('end')
        support = { active: null, history: [{ ...GRANT, active: false, endedAt: '2026-10-19T07:00:00.000Z', endedBy: GRANT.grantedBy }, OLD] }
        session = ADMIN
        return support
      },
    })
    await page.getByRole('navigation').first().getByRole('link', { name: 'Platform support' }).waitFor()
    await page.getByText('Platform support has never been allowed.').waitFor({ state: 'detached' })
    await page.getByRole('list', { name: 'Support history' }).getByText('Ended', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Allow for 24 hours' }).click()
    await dialog(page).getByText('They can\'t change anything').waitFor()
    await dialog(page).getByRole('button', { name: 'Allow for 24 hours' }).click()
    await toast(page, 'Platform support is allowed for 24 hours').waitFor()
    await page.getByTestId('support-active').waitFor()
    await page.getByTestId('support-allowed-banner').getByText(/Platform support can look at this cafe until/).waitFor()

    await page.getByRole('button', { name: 'End now' }).click()
    await dialog(page).getByRole('button', { name: 'End now' }).click()
    await toast(page, 'Platform support has ended').waitFor()
    await page.getByTestId('support-allowed-banner').waitFor({ state: 'detached' })
    expect(writes).toEqual(['allow', 'end'])
  })

  it('shuts out one visit after asking; the grant stays allowed', async () => {
    let support: CafeSupport = { active: GRANT, history: [GRANT, OLD] }
    const writes: string[] = []
    const { page } = await open('/c/nuk/admin/support', {
      'GET /admin/me': () => ({ ...ADMIN, supportAllowedUntil: UNTIL }),
      'GET /admin/support': () => support,
      'POST /admin/support/visits/{id}/end': () => {
        writes.push('end-visit')
        const visit = { ...GRANT.visits[0]!, active: false, closedAt: '2026-10-19T05:30:00.000Z' }
        support = { active: { ...GRANT, visits: [visit] }, history: [{ ...GRANT, visits: [visit] }, OLD] }
        return support
      },
    })
    const history = page.getByRole('list', { name: 'Support history' })
    await history.getByText('Looking now').waitFor()
    await history.getByRole('button', { name: 'End visit' }).click()
    await dialog(page).getByText('Platform support stays allowed').waitFor()
    await dialog(page).getByRole('button', { name: 'End visit' }).click()
    await toast(page, 'The visit has ended').waitFor()
    await history.getByText('Looking now').waitFor({ state: 'detached' })
    await history.getByText(/closed/).first().waitFor()
    await page.getByTestId('support-active').waitFor()
    expect(writes).toEqual(['end-visit'])
  })

  it('sees who looked under each grant', async () => {
    const { page } = await open('/c/nuk/admin/support', {
      'GET /admin/me': () => ({ ...ADMIN, supportAllowedUntil: UNTIL }),
      'GET /admin/support': () => ({ active: GRANT, history: [GRANT, OLD] }),
    })
    await page.getByRole('list', { name: /Who looked/ }).getByText(/Ops opened it/).first().waitFor()
    await page.getByText('Nobody from the platform team looked.').waitFor()
  })
})

describe('a super admin on a support visit', () => {
  it('sees the admin with a read-only strip, and Leave goes back to the console', async () => {
    const { page, api } = await open('/c/nuk/admin', {
      'GET /admin/me': () => SUPPORT_SESSION,
      'POST /platform/tenants/{id}/support/close': () => ({ closed: true }),
      'GET /platform/me': () => SUPERADMIN,
      'GET /platform/tenants/{id}': () => CAFE,
      'GET /platform/activity': () => ({ items: [], page: 1, pageSize: 5, total: 0, totalPages: 1 }),
    })
    const strip = page.getByTestId('support-banner')
    await strip.getByText(/Platform support view: read-only until/).waitFor()
    await strip.getByRole('button', { name: 'Leave' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-1')
    expect(api.calls).toContain('POST /platform/tenants/cafe-1/support/close')
  })

  it('a change is stopped by the app with a clear message, before any request', async () => {
    const posts: string[] = []
    const { page } = await open('/c/nuk/admin/categories', {
      'GET /admin/me': () => SUPPORT_SESSION,
      'POST /admin/menu/categories': () => {
        posts.push('create')
        throw new MockFailure(403, 'SUPPORT_READ_ONLY', 'Support access is read-only: nothing can be changed.')
      },
    })
    await page.getByTestId('support-banner').waitFor()
    await page.getByRole('button', { name: /New category/ }).first().click()
    await dialog(page).getByLabel('Name').fill('Cakes')
    await dialog(page).getByRole('button', { name: /Create|Save/ }).first().click()
    await toast(page, 'Nothing was changed').waitFor()
    await page.getByText('Platform support can only look at this cafe. Nothing can be changed.').first().waitFor()
    expect(posts).toEqual([])
  })
})

describe('the console', () => {
  it('opens a cafe that allows support after a fresh code; a wrong code says so', async () => {
    let tries = 0
    const { page } = await open('/platform/cafes/cafe-1', {
      'GET /platform/me': () => SUPERADMIN,
      'GET /platform/tenants/{id}': () => CAFE,
      'GET /platform/activity': () => ({ items: [], page: 1, pageSize: 5, total: 0, totalPages: 1 }),
      'POST /platform/tenants/{id}/support/open': ({ body }) => {
        tries++
        if ((body as { code: string }).code !== '123456') throw new MockFailure(422, 'INVALID_CODE', 'That code isn\'t right.', { code: ['That code isn\'t right'] })
        return { path: '/c/nuk/admin', expiresAt: '2026-10-19T06:10:00.000Z' }
      },
      'GET /admin/me': () => SUPPORT_SESSION,
    })
    await page.getByText(/The owner allows platform support until/).waitFor()
    await page.getByRole('button', { name: 'Open read-only' }).click()
    const form = dialog(page)
    await form.getByLabel('Code from your authenticator app').fill('12')
    await form.getByRole('button', { name: 'Open read-only' }).click()
    await form.getByText('Enter the 6-digit code from your app').waitFor()
    expect(tries).toBe(0)
    await form.getByLabel('Code from your authenticator app').fill('654321')
    await form.getByRole('button', { name: 'Open read-only' }).click()
    await form.getByText('That code isn\'t right', { exact: true }).waitFor()
    await form.getByLabel('Code from your authenticator app').fill('123456')
    await form.getByRole('button', { name: 'Open read-only' }).click()
    await page.waitForURL(address => address.pathname === '/c/nuk/admin')
    await page.getByTestId('support-banner').waitFor()
  })

  it('a cafe that doesn\'t allow support offers no way in', async () => {
    const { page } = await open('/platform/cafes/cafe-1', {
      'GET /platform/me': () => SUPERADMIN,
      'GET /platform/tenants/{id}': () => ({ ...CAFE, support: null }),
      'GET /platform/activity': () => ({ items: [], page: 1, pageSize: 5, total: 0, totalPages: 1 }),
    })
    await page.getByText(/The owner hasn't allowed platform support/).waitFor()
    expect(await page.getByRole('button', { name: 'Open read-only' }).count()).toBe(0)
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
    await page.mouse.move(0, 0)
    expect(await axeFindings(page)).toEqual([])
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
  }

  it.each([1440, 390])('the owner\'s page, the support strip and the code dialog meet the rules in light and dark, at %ipx', async (width) => {
    const owner = await open('/c/nuk/admin/support', {
      'GET /admin/me': () => ({ ...ADMIN, supportAllowedUntil: UNTIL }),
      'GET /admin/support': () => ({ active: GRANT, history: [GRANT, OLD] }),
    }, width)
    await owner.page.getByTestId('support-active').waitFor()
    await bothModes(owner.page)

    const visit = await open('/c/nuk/admin', { 'GET /admin/me': () => SUPPORT_SESSION }, width)
    await visit.page.getByTestId('support-banner').waitFor()
    await bothModes(visit.page)

    const console = await open('/platform/cafes/cafe-1', {
      'GET /platform/me': () => SUPERADMIN,
      'GET /platform/tenants/{id}': () => CAFE,
      'GET /platform/activity': () => ({ items: [], page: 1, pageSize: 5, total: 0, totalPages: 1 }),
    }, width)
    await console.page.getByRole('button', { name: 'Open read-only' }).click()
    await dialog(console.page).getByLabel('Code from your authenticator app').waitFor()
    await bothModes(console.page)
  })
})
