import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { ActivityEntry, PlatformOverview } from '../../shared/contracts/platform-activity'
import type { PlatformAccountSummary } from '../../shared/contracts/accounts'
import type { PlatformSession, TenantDetail } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { mockApi, paginatedHandler, setupE2e } from './support/mock-api'

await setupE2e()

// The platform console's Overview and Activity (step P3, D191), against a mocked API: the counts
// with what needs attention, the platform team's actions with their filters in the URL, and a
// cafe's page listing the platform's actions on it. That only the platform's own audit rows are
// listed is the server's rule (tenants.activity.test.ts).

const SUPERADMIN: PlatformSession = { userId: '0a1b2c3d-0000-4000-8000-0000000000a1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }
const SECOND_ID = '0a1b2c3d-0000-4000-8000-0000000000a2'

const OVERVIEW: PlatformOverview = { cafes: { active: 12, suspended: 1 }, newCafesThisMonth: 3, quietCafes: 4, noActiveOwner: 2, bannedAccounts: 5, timeZone: 'Asia/Phnom_Penh' }
const QUIET_OVERVIEW: PlatformOverview = { ...OVERVIEW, cafes: { active: 12, suspended: 0 }, noActiveOwner: 0, bannedAccounts: 0 }

const BROWN = { id: 'cafe-1', name: 'Brown Bean', slug: 'brown-bean' }
const person = (id: string, name: string) => ({ id, name, email: `${name.split(' ')[0]!.toLowerCase()}@example.com` })
const entry = (id: string, overrides: Partial<ActivityEntry>): ActivityEntry => ({
  id, at: '2026-10-18T03:00:00.000Z', action: 'tenant.suspend', actor: person(SUPERADMIN.userId, 'Ops'), cafe: BROWN, account: null, previousOwner: null, details: {}, ...overrides,
})
const ENTRIES: ActivityEntry[] = [
  entry('a-1', { action: 'tenant.owner.transfer', previousOwner: person('u-1', 'Bea Brown'), account: person('u-2', 'Zoe Tran'), details: { reason: 'Owner banned for fraud', newAccount: false, staysStaff: false } }),
  entry('a-2', { action: 'platform.account.ban', cafe: null, actor: person(SECOND_ID, 'Second Admin'), account: person('u-3', 'Dara Customer'), details: { reason: 'Chargebacks', until: null } }),
  entry('a-3', { action: 'tenant.notes.update', details: { fields: ['contactName', 'contactPhone'] } }),
  entry('a-4', { action: 'platform.superadmin.grant', cafe: null, actor: null, account: person(SUPERADMIN.userId, 'Ops') }),
]
const SUPERADMINS = [
  { id: SUPERADMIN.userId, name: 'Ops', email: 'ops@example.com', emailVerified: true, isSuperadmin: true, ownerOf: 0, staffOf: 0, ban: null, createdAt: '2026-10-01T00:00:00.000Z' },
  { id: SECOND_ID, name: 'Second Admin', email: 'second@example.com', emailVerified: true, isSuperadmin: true, ownerOf: 0, staffOf: 0, ban: null, createdAt: '2026-10-01T00:00:00.000Z' },
] satisfies PlatformAccountSummary[]

const CAFE: TenantDetail = {
  ...BROWN,
  status: 'active',
  suspendedReason: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  version: 3,
  usage: { branches: 1, staff: 2, ordersLast30Days: 4, lastOrderAt: null },
  activeOwners: 1,
  owners: [{ id: 'u-2', name: 'Zoe Tran', email: 'zoe@example.com', banned: false, staffAccess: false }],
  formerSlugs: [],
  notes: { contactName: null, contactPhone: null, notes: null, version: 0, updatedAt: null },
  support: null,
}

/** Activity like the server: filtered by actor, action and cafe; dates are only recorded. */
function activityHandler(entries: ActivityEntry[]): MockHandler {
  return (request) => {
    const params = request.url.searchParams
    const rows = entries.filter(row => (!params.get('actorId') || row.actor?.id === params.get('actorId'))
      && (!params.get('action') || row.action === params.get('action'))
      && (!params.get('tenantId') || row.cafe?.id === params.get('tenantId')))
    return paginatedHandler(rows.map(row => ({ ...row, name: row.action })))(request)
  }
}

async function open(path: string, handlers: Record<string, MockHandler> = {}, width?: number) {
  const page = await createPage()
  page.setDefaultTimeout(8000)
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, {
    'GET /platform/me': () => SUPERADMIN,
    'GET /platform/overview': () => OVERVIEW,
    'GET /platform/activity': activityHandler(ENTRIES),
    'GET /platform/accounts': () => ({ items: SUPERADMINS, page: 1, pageSize: 100, total: 2, totalPages: 1 }),
    'GET /platform/tenants/{id}': () => CAFE,
    'GET /platform/tenants': () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
    'GET /platform/tenants/counts': () => ({ active: 12, suspended: 1 }),
    ...handlers,
  })
  const requests: URL[] = []
  page.on('request', (request) => {
    const address = new URL(request.url())
    if (address.pathname === '/api/platform/activity') requests.push(address)
  })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api, requests }
}

/** A stat card's value, by its exact label. */
const statCard = (page: Page, label: string) => page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')

describe('the overview', () => {
  it('is where the console opens: counts, and what needs attention links to its list', async () => {
    const { page } = await open('/platform')
    const nav = page.getByRole('navigation').first()
    for (const item of ['Overview', 'Cafes', 'Accounts', 'Activity']) await nav.getByRole('link', { name: item }).waitFor()
    await page.getByText('New this month').waitFor()
    expect(await statCard(page, 'Active').textContent()).toContain('12')
    expect(await statCard(page, 'No order in 7 days').textContent()).toContain('4')
    expect(await statCard(page, 'Banned').textContent()).toContain('5')
    await page.getByRole('link', { name: '2 cafes without an owner who can sign in' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes' && address.searchParams.get('owner') === 'none')
  })

  it('says when nothing needs attention', async () => {
    const { page } = await open('/platform', { 'GET /platform/overview': () => QUIET_OVERVIEW })
    await page.getByText('Nothing needs the platform team right now.').waitFor()
  })

  it('an old link to the Cafes list (before the Overview) opens the list with its filters', async () => {
    const { page } = await open('/platform?status=suspended')
    await page.waitForURL(address => address.pathname === '/platform/cafes' && address.searchParams.get('status') === 'suspended')
  })
})

describe('activity', () => {
  it('lists the platform\'s actions with who, what, which cafe and why', async () => {
    const { page } = await open('/platform/activity')
    const transfer = page.getByRole('row').filter({ hasText: 'Ownership transferred' })
    await transfer.getByText('Bea Brown → Zoe Tran').waitFor()
    await transfer.getByText('Reason: Owner banned for fraud').waitFor()
    await transfer.getByRole('link', { name: 'Brown Bean' }).waitFor()
    const ban = page.getByRole('row').filter({ hasText: 'Account banned' })
    await ban.getByRole('link', { name: 'Dara Customer, until unbanned' }).waitFor()
    await ban.getByText('Platform').waitFor()
    await ban.getByText('Second Admin').waitFor()
    await page.getByRole('row').filter({ hasText: 'Notes edited' }).getByText('Changed: contact person, phone').waitFor()
    await page.getByRole('row').filter({ hasText: 'Super admin granted' }).getByText('The system').waitFor()
  })

  it('filters by who, what and when through the URL and the API', async () => {
    const { page, requests } = await open('/platform/activity')
    await page.getByText('Ownership transferred').waitFor()
    await page.getByRole('combobox', { name: 'Who' }).click()
    await page.getByRole('option', { name: 'Second Admin' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('actorId')).toBe(SECOND_ID)
    await page.getByText('Ownership transferred').waitFor({ state: 'detached' })
    await page.getByText('Account banned').first().waitFor()

    await page.getByRole('combobox', { name: 'Action' }).click()
    await page.getByRole('option', { name: 'Account banned' }).click()
    await page.getByRole('combobox', { name: 'When' }).click()
    await page.getByRole('option', { name: 'Last 7 days' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('period')).toBe('7d')
    await expect.poll(() => requests.at(-1)?.searchParams.get('from') ?? null).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const last = requests.at(-1)!.searchParams
    expect([last.get('actorId'), last.get('action')]).toEqual([SECOND_ID, 'platform.account.ban'])
    const days = (Date.parse(last.get('to')!) - Date.parse(last.get('from')!)) / 86_400_000
    expect(days).toBe(6)
  })

  it('opened from a cafe\'s page: only that cafe, by name, until cleared', async () => {
    const { page, requests } = await open('/platform/cafes/cafe-1', {
      'GET /platform/activity': activityHandler(ENTRIES.filter(row => row.cafe?.id === 'cafe-1')),
    })
    const card = page.getByRole('list', { name: 'Platform activity' })
    await card.getByText('Ownership transferred').waitFor()
    await card.getByText('Reason: Owner banned for fraud').waitFor()
    expect(requests[0]!.searchParams.get('tenantId')).toBe('cafe-1')
    await page.getByRole('link', { name: 'See all the platform\'s activity on this cafe' }).click()
    await page.waitForURL(address => address.pathname === '/platform/activity' && address.searchParams.get('tenantId') === 'cafe-1')
    await page.getByText('Brown Bean', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Show every cafe, not only Brown Bean' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('tenantId')).toBeNull()
  })

  it('a cafe the platform hasn\'t acted on says so', async () => {
    const { page } = await open('/platform/cafes/cafe-1', { 'GET /platform/activity': activityHandler([]) })
    await page.getByText('The platform team hasn\'t acted on this cafe yet.').waitFor()
  })

  it('on a phone, each action is a row', async () => {
    const { page } = await open('/platform/activity', {}, 390)
    const list = page.getByRole('list', { name: 'Activity' })
    await list.getByText('Bea Brown → Zoe Tran').waitFor()
    expect(await page.getByRole('table').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
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
    // Colours ease between the modes: measure once they have settled.
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
  }

  it.each([1440, 390])('the overview, activity and a cafe\'s activity meet the rules in light and dark, at %ipx', async (width) => {
    const overview = await open('/platform', {}, width)
    await overview.page.getByText('Needs attention').waitFor()
    await bothModes(overview.page)

    const activity = await open('/platform/activity?tenantId=cafe-1', {}, width)
    await activity.page.getByText('Bea Brown → Zoe Tran').first().waitFor()
    await bothModes(activity.page)

    const cafe = await open('/platform/cafes/cafe-1', {}, width)
    await cafe.page.getByRole('list', { name: 'Platform activity' }).waitFor()
    await bothModes(cafe.page)
  })
})
