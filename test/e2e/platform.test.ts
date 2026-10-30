import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { CreatedTenant, PlatformOwner, PlatformSession, SlugAvailability, TenantDetail, TenantSummary } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { deferred, failures, MockFailure, mockApi, paginatedHandler, setupE2e, toast } from './support/mock-api'

await setupE2e()

// The platform console (step T2a, D142) in the browser, against a mocked API: the platform team's
// sign-in, Cafes, Create a cafe (one page, D185) with the owner's password shown once, and a cafe's
// page (change the address, pause, resume).

const SUPERADMIN: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }

/** Account ids are UUIDs (the page's `?owner=` only takes one). */
const NUK_OWNER_ID = '0a1b2c3d-0000-4000-8000-000000000001'
const ZOE_ID = '0a1b2c3d-0000-4000-8000-000000000002'
const CARL_ID = '0a1b2c3d-0000-4000-8000-000000000003'

function cafeOf(id: string, name: string, slug: string, overrides: Partial<TenantDetail> = {}): TenantDetail {
  return {
    id,
    name,
    slug,
    status: 'active',
    suspendedReason: null,
    createdAt: '2026-10-01T03:00:00.000Z',
    version: 1,
    usage: { branches: 1, staff: 2, ordersLast30Days: 12, lastOrderAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    owners: [{ id: `${id}-owner`, name: `${name} Owner`, email: `owner@${slug}.example`, banned: false, staffAccess: false }],
    formerSlugs: [],
    activeOwners: 1,
    notes: { contactName: null, contactPhone: null, notes: null, version: 0, updatedAt: null },
    support: null,
    ...overrides,
  }
}

const NUK = cafeOf('cafe-1', 'NUK Cafe', 'nuk', { owners: [{ id: NUK_OWNER_ID, name: 'NUK Cafe Owner', email: 'owner@nuk.example', banned: false, staffAccess: false }] })
const PAUSED = cafeOf('cafe-2', 'Old Mill', 'old-mill', { status: 'suspended', suspendedReason: 'Unpaid invoice', usage: { branches: 2, staff: 5, ordersLast30Days: 0, lastOrderAt: null } })
/** Accounts a new cafe can be given to (D185): an owner of two cafes, one of NUK Cafe, and a customer with no cafe. */
const ACCOUNTS: PlatformOwner[] = [
  { id: NUK_OWNER_ID, name: 'NUK Cafe Owner', email: 'owner@nuk.example', cafes: [{ id: NUK.id, name: NUK.name, slug: NUK.slug }] },
  { id: ZOE_ID, name: 'Zoe Tran', email: 'zoe@example.com', cafes: [{ id: 'cafe-8', name: 'Tea Kiosk', slug: 'tea-kiosk' }, { id: PAUSED.id, name: PAUSED.name, slug: PAUSED.slug }] },
  { id: CARL_ID, name: 'Carl Customer', email: 'carl@example.com', cafes: [] },
]
const summary = ({ owners: _o, formerSlugs: _f, notes: _n, support: _s, ...cafe }: TenantDetail): TenantSummary => cafe

const signedIn = (session: PlatformSession = SUPERADMIN): Record<string, MockHandler> => ({ 'GET /platform/me': () => session })

/** Cafes filtered by `status` and `search` like the server. */
function cafesHandler(cafes: () => TenantDetail[]): MockHandler {
  const list = paginatedHandler(() => cafes().map(summary))
  return (request) => {
    const status = request.url.searchParams.get('status')
    if (!status) return list(request)
    const rows = cafes().filter(c => c.status === status).map(summary)
    return { items: rows, page: 1, pageSize: 20, total: rows.length, totalPages: 1 }
  }
}

/** Every address is free except these (the address history, D185). */
const TAKEN_ADDRESSES = new Set(['nuk', 'old-mill'])
const availability: MockHandler = ({ url: request }) => {
  const slug = request.searchParams.get('slug') ?? ''
  return { slug, available: !TAKEN_ADDRESSES.has(slug) } satisfies SlugAvailability
}

/** The account search like the server's: names and emails, at most eight. */
const accountSearch: MockHandler = ({ url: request }) => {
  const term = (request.searchParams.get('search') ?? '').toLowerCase()
  return ACCOUNTS.filter(account => `${account.name} ${account.email}`.toLowerCase().includes(term)).slice(0, 8)
}
const accountById: MockHandler = ({ url: request }) => {
  const account = ACCOUNTS.find(candidate => request.pathname.endsWith(`/${candidate.id}`))
  if (!account) throw failures.notFound('The account was not found.')
  return account
}

async function open(path: string, handlers: Record<string, MockHandler> = {}, width?: number) {
  const page = await createPage()
  page.setDefaultTimeout(8000)
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, {
    ...signedIn(),
    'GET /platform/tenants': cafesHandler(() => [NUK, PAUSED]),
    'GET /platform/tenants/counts': () => ({ active: 1, suspended: 1 }),
    'GET /platform/overview': () => ({ cafes: { active: 1, suspended: 1 }, newCafesThisMonth: 0, quietCafes: 0, noActiveOwner: 0, bannedAccounts: 0, timeZone: 'Asia/Phnom_Penh' }),
    'GET /platform/slug-availability': availability,
    'GET /platform/owner-candidates': accountSearch,
    'GET /platform/owner-candidates/{id}': accountById,
    'GET /platform/activity': () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
    ...handlers,
  })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const dialog = (page: Page) => page.getByRole('dialog')
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))

describe('signing in', () => {
  it('sends a signed-out visitor to the sign-in, then back where they were going', async () => {
    let session: PlatformSession | null = null
    const { page, api } = await open('/platform/cafes/cafe-1', {
      'GET /platform/me': () => {
        if (!session) throw failures.unauthorized()
        return session
      },
      'POST /auth/sign-in/email': () => {
        session = SUPERADMIN
        return { redirect: false, token: 't', user: { id: SUPERADMIN.userId } }
      },
      'GET /platform/tenants/{id}': () => NUK,
    })
    await page.waitForURL(address => address.pathname === '/platform/sign-in')
    await page.getByRole('heading', { name: 'Angder' }).waitFor()
    await page.getByLabel('Email').fill('ops@example.com')
    await page.getByLabel('Password', { exact: true }).fill('a long password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-1')
    await page.getByText('/c/nuk', { exact: true }).waitFor()
    expect(api.calls).toContain('POST /auth/sign-in/email')
  })

  it('refuses a customer account (no cafe either), and signs it out again (Q1)', async () => {
    let signedInOnce = false
    const { page, api } = await open('/platform/sign-in', {
      'GET /platform/me': () => {
        if (!signedInOnce) throw failures.unauthorized()
        throw new MockFailure(403, 'NOT_PLATFORM_ADMIN', 'This account doesn\'t have access to the platform console.')
      },
      'POST /auth/sign-in/email': () => {
        signedInOnce = true
        return { redirect: false, token: 't', user: { id: 'owner-1' } }
      },
      // Works at no cafe: nothing to offer, so signed out (a cafe's staff stay signed in, your-cafes.test.ts).
      'GET /me/cafes': () => [],
    })
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password', { exact: true }).fill('a long password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('alert').getByText('This account doesn\'t have access to the platform console.').waitFor()
    await expect.poll(() => api.calls.includes('POST /auth/sign-out')).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/platform/sign-in')
  })

  it('logging out goes straight to sign-in: nothing of the console is read after the sign-out', async () => {
    const { page, api } = await open('/platform/cafes')
    await page.getByText('/c/nuk', { exact: true }).waitFor()
    const before = api.calls.length
    await page.getByRole('button', { name: 'Ops' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect.poll(() => page.url()).toBe(url('/platform/sign-in'))
    await page.waitForTimeout(500)
    const after = api.calls.slice(before)
    expect(after[0]).toBe('POST /auth/sign-out')
    expect(after.filter(call => call.includes('/platform/'))).toEqual([])
  })

  it('on a temporary password, asks for a new one before anything else', async () => {
    const { page } = await open('/platform/cafes', signedIn({ ...SUPERADMIN, mustChangePassword: true }))
    await page.waitForURL(address => address.pathname === '/platform/change-password')
    await page.getByRole('heading', { name: 'Choose your password' }).waitFor()
  })
})

describe('cafes', () => {
  it('lists each cafe with its status, address and usage; the name opens it', async () => {
    const { page } = await open('/platform/cafes', { 'GET /platform/tenants/{id}': () => NUK })
    const nuk = page.getByRole('row').filter({ hasText: 'NUK Cafe' })
    await nuk.getByText('/c/nuk').waitFor()
    await nuk.getByText('Active').waitFor()
    await nuk.getByText('1 branch · 2 staff · 12 orders in 30 days').waitFor()
    await nuk.getByText('2 hours ago').waitFor()
    const mill = page.getByRole('row').filter({ hasText: 'Old Mill' })
    await mill.getByText('Paused').waitFor()
    await mill.getByText('No orders yet').waitFor()
    // The status tabs count every cafe.
    await page.getByRole('tab', { name: /Paused\s*1/ }).waitFor()

    await page.getByRole('table').getByRole('link', { name: /^NUK Cafe\b/ }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-1')
  })

  it('searches and filters through the URL and the API', async () => {
    const { page, api } = await open('/platform/cafes')
    await page.getByRole('table').getByText('Old Mill').waitFor()
    await page.getByRole('tab', { name: /Paused/ }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('suspended')
    await page.getByRole('table').getByText('NUK Cafe').waitFor({ state: 'detached' })
    await page.getByPlaceholder('Search name or address…').fill('mill')
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('mill')
    expect(api.calls.filter(c => c === 'GET /platform/tenants').length).toBeGreaterThan(2)
    // The tab counts are one read that filters and search don't repeat.
    expect(api.calls.filter(c => c === 'GET /platform/tenants/counts')).toHaveLength(1)
  })

  it('on a phone, each cafe is a row', async () => {
    const { page } = await open('/platform/cafes', {}, 390)
    const list = page.getByRole('list', { name: 'Cafes' })
    await list.getByRole('link', { name: 'NUK Cafe' }).waitFor()
    await list.getByText('Last order 2 hours ago').waitFor()
    expect(await page.getByRole('table').count()).toBe(0)
  })
})

describe('creating a cafe (D185)', () => {
  const NEW_OWNER = { name: 'Bea Brown', email: 'bea@example.com' }
  const created = cafeOf('cafe-3', 'Brown Bean', 'brown-bean', { usage: { branches: 1, staff: 1, ordersLast30Days: 0, lastOrderAt: null }, owners: [{ id: 'u-3', name: NEW_OWNER.name, email: NEW_OWNER.email, banned: false, staffAccess: false }] })
  const newAccountResult = { tenant: created, temporaryPassword: 'tmp-Pass-1234', owner: { ...created.owners[0]!, cafes: [{ id: created.id, name: created.name, slug: created.slug }] } } satisfies CreatedTenant

  /** Saves like the server: the chosen account, now with the new cafe too. */
  function createsFor(sent: unknown[]): MockHandler {
    return ({ body }) => {
      sent.push(body)
      const input = body as { name: string, slug: string, owner: { kind: string, userId: string } }
      const owner = ACCOUNTS.find(account => account.id === input.owner.userId)!
      const tenant = cafeOf('cafe-9', input.name, input.slug, { owners: [{ id: owner.id, name: owner.name, email: owner.email, banned: false, staffAccess: false }] })
      return { tenant, temporaryPassword: null, owner: { ...owner, cafes: [...owner.cafes, { id: tenant.id, name: tenant.name, slug: tenant.slug }] } } satisfies CreatedTenant
    }
  }

  const cafeCard = (page: Page) => page.getByRole('region', { name: 'Cafe details' })
  const branchCard = (page: Page) => page.getByRole('region', { name: 'First branch' })
  const ownerCard = (page: Page) => page.getByRole('region', { name: 'First owner' })
  const summaryCard = (page: Page) => page.getByRole('complementary')
  const createButton = (page: Page) => page.getByRole('button', { name: 'Create cafe' })

  async function openNew(handlers: Record<string, MockHandler> = {}, width?: number, path = '/platform/cafes') {
    const opened = await open(path, handlers, width)
    await opened.page.getByRole('link', { name: 'New cafe' }).click()
    await opened.page.getByRole('heading', { name: 'Create a cafe' }).waitFor()
    return opened
  }

  async function fillNewAccount(page: Page, name = 'Brown Bean', address = 'brown-bean') {
    await cafeCard(page).getByLabel('Name', { exact: true }).fill(name)
    await page.getByLabel('Web address').fill(address)
    await ownerCard(page).getByLabel('Owner name').fill(NEW_OWNER.name)
    await ownerCard(page).getByLabel('Email').fill('Bea@Example.com')
  }

  async function chooseAccount(page: Page, search: string, option: RegExp) {
    await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).check()
    await ownerCard(page).getByRole('combobox', { name: 'Account', exact: true }).click()
    await page.getByPlaceholder('Search by name or email…').fill(search)
    await page.getByRole('option', { name: option }).click()
    await page.getByRole('listbox').waitFor({ state: 'hidden' })
  }

  it('is one page: the cafe, its branch and its owner, with Create cafe and no steps or review', async () => {
    const { page } = await openNew()
    expect(new URL(page.url()).pathname).toBe('/platform/cafes/new')
    await page.getByText('Create the cafe, its first branch and owner in one go.').waitFor()
    for (const name of ['Cafe details', 'First branch', 'First owner']) await page.getByRole('region', { name }).waitFor()
    await summaryCard(page).getByRole('heading', { name: 'Creation summary' }).waitFor()
    await createButton(page).waitFor()
    // No stepper, review tabs or intermediate confirmation.
    expect(await page.getByRole('button', { name: /review/i }).count()).toBe(0)
    expect(await page.getByRole('tab').count()).toBe(0)
    expect(await branchCard(page).getByLabel('Branch name').inputValue()).toBe('Main branch')
    await branchCard(page).getByText('Opening hours follow this time zone.').waitFor()
    expect(await ownerCard(page).getByRole('radio', { name: /Create new account/ }).isChecked()).toBe(true)
  })

  it('suggests the address from the name, then leaves it alone once typed by hand', async () => {
    const { page } = await openNew()
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('Brown Bean Café')
    await expect.poll(() => page.getByLabel('Web address').inputValue()).toBe('brown-bean-cafe')
    await page.getByLabel('Web address').fill('brown-bean')
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('Brown Bean')
    expect(await page.getByLabel('Web address').inputValue()).toBe('brown-bean')
    // The full address uses this app's own origin.
    await expect.poll(() => page.getByTestId('preview-url').textContent().then(text => text?.trim())).toBe(`${new URL(page.url()).origin}/c/brown-bean`)
  })

  it('saves the cafe, branch and a new account, shows the password once, and returns to the list', async () => {
    let sent: unknown
    const { page, api } = await openNew({
      'POST /platform/tenants': ({ body }) => {
        sent = body
        return newAccountResult
      },
      'GET /platform/tenants/{id}': () => created,
    })
    await fillNewAccount(page)
    await branchCard(page).getByLabel('Branch name').fill('Bean Street')
    // The summary follows what is typed, and says the account is new.
    await summaryCard(page).getByText('/c/brown-bean', { exact: true }).waitFor()
    await summaryCard(page).getByText('Bean Street').waitFor()
    await summaryCard(page).getByText('Bea Brown').waitFor()
    await summaryCard(page).getByText('New account').waitFor()
    await summaryCard(page).getByText('The owner changes the temporary password').waitFor()
    await ownerCard(page).getByText('Password shown after creation').waitFor()
    // Nothing is generated before the save.
    expect(await page.getByTestId('temporary-password').count()).toBe(0)
    await createButton(page).click()

    const result = page.getByRole('dialog', { name: 'Brown Bean is ready' })
    await result.getByTestId('temporary-password').getByText('tmp-Pass-1234').waitFor()
    await result.getByText(/\/c\/brown-bean\/admin\/login$/).waitFor()
    await result.getByTestId('owner-cafes').getByText('Bea Brown owns this cafe.').waitFor()
    expect(sent).toEqual({ name: 'Brown Bean', slug: 'brown-bean', branchName: 'Bean Street', timezone: 'Asia/Phnom_Penh', owner: { kind: 'new', name: 'Bea Brown', email: 'bea@example.com' } })
    await toast(page, 'Brown Bean created').waitFor()
    // The page is left behind the result, with no password in the address.
    await page.waitForURL(address => address.pathname === '/platform/cafes')
    expect(page.url()).not.toContain('tmp-Pass')

    await result.getByRole('button', { name: 'Open cafe' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-3')
    expect(writes(api.calls)).toEqual(['POST /platform/tenants'])
  })

  it('says whether the address is free, from the server, and ignores an older answer that arrives late', async () => {
    const slow = deferred()
    const { page, api } = await openNew({
      'GET /platform/slug-availability': (request) => {
        const slug = request.url.searchParams.get('slug')
        // The first address's answer is held back, and says it's taken: it must never show.
        return slug === 'slow-first' ? slow.handler(request) : availability(request)
      },
    })
    const status = page.getByRole('status')
    await page.getByLabel('Web address').fill('slow-first')
    await slow.started()
    await status.getByText('Checking address…').waitFor()
    // Not "available" on syntax alone.
    expect(await status.getByText('Address available').count()).toBe(0)

    await page.getByLabel('Web address').fill('second-one')
    await status.getByText('Address available').waitFor()
    slow.release({ slug: 'slow-first', available: false } satisfies SlugAvailability)
    await page.waitForTimeout(400)
    expect(await status.getByText('Address taken').count()).toBe(0)
    await status.getByText('Address available').waitFor()

    // An answer for the address before is not an answer for this one: while the next is asked, it says so.
    const next = deferred()
    api.set({ 'GET /platform/slug-availability': request => (request.url.searchParams.get('slug') === 'third-one' ? next.handler(request) : availability(request)) })
    await page.getByLabel('Web address').fill('third-one')
    await next.started()
    await status.getByText('Checking address…').waitFor()
    expect(await status.getByText('Address available').count()).toBe(0)
    next.release({ slug: 'third-one', available: true } satisfies SlugAvailability)
    await status.getByText('Address available').waitFor()

    // Not asked for an address that fails the rules (too short, reserved).
    await page.getByLabel('Web address').fill('ab')
    await status.getByText('Address available').waitFor({ state: 'detached' })
    await page.getByLabel('Web address').fill('admin')
    await page.waitForTimeout(500)
    expect(await status.textContent()).not.toMatch(/available|taken|Checking/)
  })

  it('an address a cafe has or had is called taken and stops the save; a free one another save took meanwhile is refused on its field', async () => {
    const { page, api } = await openNew({
      'POST /platform/tenants': () => {
        throw new MockFailure(409, 'SLUG_TAKEN', 'This web address is taken. Choose another one.', { slug: ['Already used by a cafe, now or before'] })
      },
    })
    await fillNewAccount(page, 'Old Mill Two', 'old-mill')
    await page.getByRole('status').getByText('Address taken').waitFor()
    await createButton(page).click()
    await page.getByText('Already used by a cafe, now or before').waitFor()
    expect(writes(api.calls)).toEqual([])

    // Free as far as the check knew; the save finds it taken: the field says so, and nothing is lost.
    await page.getByLabel('Web address').fill('brown-bean')
    await page.getByRole('status').getByText('Address available').waitFor()
    await createButton(page).click()
    await page.getByText('Already used by a cafe, now or before').waitFor()
    await toast(page, 'Could not create Old Mill Two').waitFor()
    expect(writes(api.calls)).toEqual(['POST /platform/tenants'])
    expect(await cafeCard(page).getByLabel('Name', { exact: true }).inputValue()).toBe('Old Mill Two')
    expect(await ownerCard(page).getByLabel('Email').inputValue()).toBe('Bea@Example.com')
  })

  it('names what is missing, on the fields, and sends nothing', async () => {
    const { page, api } = await openNew()
    await createButton(page).click()
    await cafeCard(page).getByText('Required').first().waitFor()
    await page.getByText('At least 3 characters').waitFor()
    await ownerCard(page).getByText('Required').first().waitFor()
    // The first invalid field takes focus.
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('name') ?? document.activeElement?.id)).toBeTruthy()
    // An existing account has to be chosen.
    await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).check()
    await createButton(page).click()
    await ownerCard(page).getByText('Choose an account').waitFor()
    expect(writes(api.calls)).toEqual([])
  })

  it('choosing a valid account shows no "Choose an account", before or after a failed submit', async () => {
    const { page } = await openNew()
    await chooseAccount(page, 'zoe', /zoe@example\.com/)
    await page.getByTestId('chosen-owner').getByText('Zoe Tran').waitFor()
    // Let blur validation of the picker run (focus leaves it).
    await cafeCard(page).getByLabel('Name', { exact: true }).focus()
    await page.waitForTimeout(300)
    expect(await ownerCard(page).getByText('Choose an account').count()).toBe(0)
    // And after the error has been shown once: choosing another clears it.
    await ownerCard(page).getByRole('radio', { name: /Create new account/ }).check()
    await createButton(page).click()
    await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).check()
    await chooseAccount(page, 'carl', /carl@example\.com/)
    await page.getByTestId('chosen-owner').getByText('Carl Customer').waitFor()
    await page.waitForTimeout(300)
    expect(await ownerCard(page).getByText('Choose an account').count()).toBe(0)
  })

  it('uses an existing account found by name: the summary and the result say it keeps its password', async () => {
    const sent: unknown[] = []
    const { page } = await openNew({ 'POST /platform/tenants': createsFor(sent) })
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('Zoe Corner')
    await chooseAccount(page, 'zoe', /zoe@example\.com/)
    const chosen = page.getByTestId('chosen-owner')
    await chosen.getByText('Zoe Tran').waitFor()
    await chosen.getByText('zoe@example.com').waitFor()
    await chosen.getByText('Owns Tea Kiosk and Old Mill').waitFor()
    await chosen.getByText(/password, profile and access to other cafes stay unchanged/).waitFor()
    await summaryCard(page).getByText('Existing account').waitFor()
    await summaryCard(page).getByText('The owner signs in with their current password').waitFor()
    expect(await summaryCard(page).getByText(/temporary password/).count()).toBe(0)
    await createButton(page).click()

    const result = page.getByRole('dialog', { name: 'Zoe Corner is ready' })
    await result.getByText('Zoe Tran now owns 3 cafes: Tea Kiosk, Old Mill and Zoe Corner.').waitFor()
    await result.getByTestId('existing-account').getByText(/Use your current password/).waitFor()
    expect(await result.getByTestId('temporary-password').count()).toBe(0)
    expect(sent).toEqual([{ name: 'Zoe Corner', slug: 'zoe-corner', branchName: 'Main branch', timezone: 'Asia/Phnom_Penh', owner: { kind: 'existing', userId: ZOE_ID } }])
  })

  it('finds registered customers too, not only owners', async () => {
    const sent: unknown[] = []
    const { page } = await openNew({ 'POST /platform/tenants': createsFor(sent) })
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('Carl Corner')
    await chooseAccount(page, 'carl', /carl@example\.com/)
    await page.getByTestId('chosen-owner').getByText('Owns no cafe yet').waitFor()
    await createButton(page).click()
    await page.getByRole('dialog', { name: 'Carl Corner is ready' }).getByText('Carl Customer owns this cafe.').waitFor()
    expect(sent).toMatchObject([{ owner: { kind: 'existing', userId: CARL_ID } }])
  })

  it('searches the server only for two or more characters, and shows only the answer to what is typed', async () => {
    const searches: string[] = []
    const { page, api } = await openNew({
      'GET /platform/owner-candidates': (request) => {
        searches.push(request.url.searchParams.get('search') ?? '')
        return accountSearch(request)
      },
    })
    await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).check()
    await ownerCard(page).getByRole('combobox', { name: 'Account', exact: true }).click()
    const box = page.getByPlaceholder('Search by name or email…')
    await box.fill('z')
    await page.getByText('Type at least 2 characters of a name or email').waitFor()
    expect(searches).toEqual([])
    await box.fill('zoe')
    await page.getByRole('option', { name: /zoe@example\.com/ }).waitFor()
    await box.fill('nobody-here')
    await page.getByText('No accounts match “nobody-here”').waitFor()
    // One request per settled search, not per key.
    expect(searches).toEqual(['zoe', 'nobody-here'])

    // Results of the search before are not shown for the next while it is asked.
    const slow = deferred()
    api.set({ 'GET /platform/owner-candidates': request => (request.url.searchParams.get('search') === 'carl' ? slow.handler(request) : accountSearch(request)) })
    await box.fill('zoe')
    await page.getByRole('option', { name: /zoe@example.com/ }).waitFor()
    await box.fill('carl')
    await slow.started()
    await page.getByText('Searching…').waitFor()
    expect(await page.getByRole('option', { name: /zoe@example.com/ }).count()).toBe(0)
    slow.release([ACCOUNTS[2]])
    await page.getByRole('option', { name: /carl@example.com/ }).waitFor()
  })

  it('a cafe\'s page opens New cafe with its owner chosen by id: nothing secret in the address', async () => {
    const sent: unknown[] = []
    const { page } = await open('/platform/cafes/cafe-1', { 'GET /platform/tenants/{id}': () => NUK, 'POST /platform/tenants': createsFor(sent) }, 390)
    await page.getByRole('link', { name: 'New cafe for this owner: NUK Cafe Owner' }).click()
    await page.getByRole('heading', { name: 'Create a cafe' }).waitFor()
    expect(new URL(page.url()).search).toBe(`?owner=${NUK_OWNER_ID}`)
    expect(await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).isChecked()).toBe(true)
    await page.getByTestId('chosen-owner').getByText('Owns NUK Cafe').waitFor()
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('NUK Riverside')
    // On a phone the bar steps aside while a field has the keyboard (BottomActionBar).
    await page.getByRole('heading', { name: 'Create a cafe' }).click()
    await createButton(page).click()
    await page.getByRole('dialog', { name: 'NUK Riverside is ready' }).getByText('NUK Cafe Owner now owns 2 cafes: NUK Cafe and NUK Riverside.').waitFor()
    expect(sent).toMatchObject([{ slug: 'nuk-riverside', owner: { kind: 'existing', userId: NUK_OWNER_ID } }])
  })

  it('an address that is not an account id, or an account that can\'t be chosen, opens as a new account without asking', async () => {
    const garbage = await open(`${'/platform/cafes/new'}?owner=not-an-id`)
    await garbage.page.getByRole('heading', { name: 'Create a cafe' }).waitFor()
    expect(await ownerCard(garbage.page).getByRole('radio', { name: /Create new account/ }).isChecked()).toBe(true)
    expect(garbage.api.calls.filter(call => call.startsWith('GET /platform/owner-candidates'))).toEqual([])

    const gone = await open('/platform/cafes/new?owner=0a1b2c3d-0000-4000-8000-0000000000ff')
    await gone.page.getByRole('heading', { name: 'Create a cafe' }).waitFor()
    await expect.poll(async () => ownerCard(gone.page).getByRole('radio', { name: /Create new account/ }).isChecked()).toBe(true)
    // Nothing was typed: leaving doesn't ask.
    await gone.page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Cafes').click()
    await gone.page.waitForURL(address => address.pathname === '/platform/cafes')
    expect(await gone.page.getByText('Discard unsaved changes?').count()).toBe(0)
  })

  it('a new account\'s email that already has an account: said on the field, with the details kept and a way to use that account', async () => {
    const sent: unknown[] = []
    let first = true
    const { page } = await openNew({
      'POST /platform/tenants': (request) => {
        if (first) {
          first = false
          sent.push(request.body)
          throw new MockFailure(409, 'ACCOUNT_EXISTS', 'This email already has an account. Choose Use existing account to make them the owner.', { 'owner.email': ['This email already has an account: choose Use existing account'] })
        }
        return createsFor(sent)(request)
      },
    })
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('Zoe Corner')
    await page.getByLabel('Web address').fill('zoe-corner')
    await branchCard(page).getByLabel('Branch name').fill('Corner Street')
    await ownerCard(page).getByLabel('Owner name').fill('Zoe')
    await ownerCard(page).getByLabel('Email').fill('zoe@example.com')
    // Submitted at once: the server's field error must outlive the form's own delayed check (forms.md traps).
    await ownerCard(page).getByLabel('Email').press('Enter')
    await ownerCard(page).getByText('This email already has an account: choose Use existing account').waitFor({ timeout: 3000 })
    await page.waitForTimeout(600)
    expect(await ownerCard(page).getByText('This email already has an account: choose Use existing account').count()).toBe(1)
    await toast(page, 'Could not create Zoe Corner').waitFor()
    const alert = ownerCard(page).getByRole('alert')
    await alert.waitFor()

    await alert.getByRole('button', { name: 'Use existing account' }).click()
    // The account with that email is found and chosen; the cafe's details stay.
    await page.getByTestId('chosen-owner').getByText('Zoe Tran').waitFor()
    expect(await cafeCard(page).getByLabel('Name', { exact: true }).inputValue()).toBe('Zoe Corner')
    expect(await page.getByLabel('Web address').inputValue()).toBe('zoe-corner')
    expect(await branchCard(page).getByLabel('Branch name').inputValue()).toBe('Corner Street')
    await createButton(page).click()
    await page.getByRole('dialog', { name: 'Zoe Corner is ready' }).getByText('Zoe Tran now owns 3 cafes: Tea Kiosk, Old Mill and Zoe Corner.').waitFor()
    expect(sent).toMatchObject([{ owner: { kind: 'new' } }, { slug: 'zoe-corner', branchName: 'Corner Street', owner: { kind: 'existing', userId: ZOE_ID } }])
  })

  it('an account the server won\'t accept (disabled, a guest) is refused on the account field, and nothing is lost', async () => {
    const { page } = await openNew({
      'POST /platform/tenants': () => {
        throw new MockFailure(422, 'VALIDATION_FAILED', 'Choose an account that can own a cafe.', { 'owner.userId': ['This account can\'t be chosen'] })
      },
    })
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('Zoe Corner')
    await chooseAccount(page, 'zoe', /zoe@example\.com/)
    await createButton(page).click()
    await ownerCard(page).getByText('This account can\'t be chosen').waitFor()
    expect(await cafeCard(page).getByLabel('Name', { exact: true }).inputValue()).toBe('Zoe Corner')
  })

  it('a server failure keeps every value and can be tried again', async () => {
    let fail = true
    const { page, api } = await openNew({
      'POST /platform/tenants': () => {
        if (fail) throw failures.server()
        return newAccountResult
      },
    })
    await fillNewAccount(page)
    await createButton(page).click()
    await toast(page, 'Could not create Brown Bean').waitFor()
    expect(await cafeCard(page).getByLabel('Name', { exact: true }).inputValue()).toBe('Brown Bean')
    expect(await ownerCard(page).getByLabel('Email').inputValue()).toBe('Bea@Example.com')
    expect(new URL(page.url()).pathname).toBe('/platform/cafes/new')

    fail = false
    await createButton(page).click()
    await page.getByRole('dialog', { name: 'Brown Bean is ready' }).getByTestId('temporary-password').waitFor()
    expect(writes(api.calls)).toEqual(['POST /platform/tenants', 'POST /platform/tenants'])
  })

  it('one save at a time: a second click or Ctrl+Enter while saving sends nothing more', async () => {
    const save = deferred()
    const { page, api } = await openNew({ 'POST /platform/tenants': save.handler, 'GET /platform/tenants/{id}': () => created })
    await fillNewAccount(page)
    await createButton(page).click()
    await save.started()
    await page.keyboard.press('Control+Enter')
    await page.keyboard.press('Control+Enter')
    await createButton(page).click({ force: true, timeout: 1000 }).catch(() => {})
    await page.waitForTimeout(300)
    expect(save.calls).toBe(1)
    // Inputs are locked while it saves.
    expect(await cafeCard(page).getByLabel('Name', { exact: true }).isDisabled()).toBe(true)
    save.release(newAccountResult)
    await page.getByRole('dialog', { name: 'Brown Bean is ready' }).waitFor()
    expect(writes(api.calls)).toEqual(['POST /platform/tenants'])
  })

  it('leaving while it saves needs no question, and the password still appears where the person went', async () => {
    const save = deferred()
    const { page } = await openNew({ 'POST /platform/tenants': save.handler, 'GET /platform/tenants/{id}': () => NUK })
    await fillNewAccount(page)
    await createButton(page).click()
    await save.started()
    await page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Cafes').click()
    await page.waitForURL(address => address.pathname === '/platform/cafes')
    expect(await page.getByText('Discard unsaved changes?').count()).toBe(0)
    await page.getByRole('table').getByRole('link', { name: /^NUK Cafe\b/ }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-1')
    save.release(newAccountResult)
    await page.getByRole('dialog', { name: 'Brown Bean is ready' }).getByTestId('temporary-password').getByText('tmp-Pass-1234').waitFor()
    // Left where they went: a finished save doesn't send them back to the list.
    await page.waitForTimeout(400)
    expect(new URL(page.url()).pathname).toBe('/platform/cafes/cafe-1')
  })

  it('a save that fails after the page was left offers Reopen, with the input back and no password anywhere', async () => {
    const save = deferred()
    const { page } = await openNew({ 'POST /platform/tenants': save.handler })
    await fillNewAccount(page)
    await createButton(page).click()
    await save.started()
    await page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Cafes').click()
    await page.waitForURL(address => address.pathname === '/platform/cafes')
    // The page has gone (the list is showing) before the save fails.
    await page.getByRole('table').waitFor()
    await expect.poll(() => page.getByRole('heading', { name: 'Create a cafe' }).count()).toBe(0)
    save.fail(failures.server())
    await toast(page, 'Could not create Brown Bean').waitFor()
    await page.getByRole('button', { name: 'Reopen' }).click()
    await page.getByRole('heading', { name: 'Create a cafe' }).waitFor()
    expect(await cafeCard(page).getByLabel('Name', { exact: true }).inputValue()).toBe('Brown Bean')
    expect(await page.getByLabel('Web address').inputValue()).toBe('brown-bean')
    expect(await ownerCard(page).getByLabel('Email').inputValue()).toBe('Bea@Example.com')
    expect(page.url()).not.toMatch(/Bea|bea@|password/i)
  })

  it('Leaving through the Cafes breadcrumb asks before throwing away input, and goes back to the list with its filters', async () => {
    const { page } = await openNew({}, undefined, '/platform/cafes?status=suspended')
    // Untouched: no question.
    await page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Cafes').click()
    await page.waitForURL(address => address.pathname === '/platform/cafes')
    expect(new URL(page.url()).searchParams.get('status')).toBe('suspended')

    await page.getByRole('link', { name: 'New cafe' }).click()
    await cafeCard(page).getByLabel('Name', { exact: true }).fill('Half done')
    await page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Cafes').click()
    await page.getByText('Discard unsaved changes?').waitFor()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await page.getByText('Discard unsaved changes?').waitFor({ state: 'hidden' })
    expect(await cafeCard(page).getByLabel('Name', { exact: true }).inputValue()).toBe('Half done')
    await page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Cafes').click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes')
    expect(new URL(page.url()).searchParams.get('status')).toBe('suspended')
  })

  it('works by keyboard: the account choices are radios, Ctrl+Enter saves', async () => {
    const sent: unknown[] = []
    const { page } = await openNew({ 'POST /platform/tenants': ({ body }) => {
      sent.push(body)
      return newAccountResult
    } })
    await ownerCard(page).getByRole('radio', { name: /Create new account/ }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')
    await expect.poll(() => ownerCard(page).getByRole('radio', { name: /Use existing account/ }).isChecked()).toBe(true)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Space')
    await expect.poll(() => ownerCard(page).getByRole('radio', { name: /Create new account/ }).isChecked()).toBe(true)
    await fillNewAccount(page)
    await ownerCard(page).getByLabel('Email').press('Control+Enter')
    await page.getByRole('dialog', { name: 'Brown Bean is ready' }).waitFor()
    expect(sent).toHaveLength(1)
  })

  it('switching the account choice keeps what was typed for the other', async () => {
    const { page } = await openNew()
    await ownerCard(page).getByLabel('Owner name').fill('Bea Brown')
    await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).check()
    await summaryCard(page).getByText('Existing account').waitFor()
    await ownerCard(page).getByRole('radio', { name: /Create new account/ }).check()
    expect(await ownerCard(page).getByLabel('Owner name').inputValue()).toBe('Bea Brown')
  })

  it('on a phone: one column, no sideways scroll, and Create cafe is always in reach', async () => {
    const { page } = await openNew({}, 390)
    const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('main, [id="cafe-new"], form')].map(el => el.scrollWidth)) - window.innerWidth)
    expect(await overflow()).toBeLessThanOrEqual(0)
    const form = (await cafeCard(page).boundingBox())!
    const summary = (await summaryCard(page).boundingBox())!
    expect(summary.y).toBeGreaterThan(form.y + form.height - 1)
    const button = createButton(page)
    await button.waitFor()
    // Visible without scrolling, at the top of the page.
    expect(await button.evaluate(el => el.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true)
    await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).check()
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.getByRole('combobox', { name: 'Account', exact: true }).click()
    expect(await overflow()).toBeLessThanOrEqual(0)
  })

  it('on a wide screen: the summary stands beside the form and stays in view, Create cafe is in the navbar', async () => {
    const { page } = await openNew({}, 1440)
    const form = (await cafeCard(page).boundingBox())!
    const summary = (await summaryCard(page).boundingBox())!
    expect(summary.x).toBeGreaterThan(form.x + form.width - 1)
    // From lg the action is in the navbar, not in a bottom bar.
    expect(await page.getByRole('toolbar', { name: 'Create cafe actions' }).count()).toBe(0)
    await createButton(page).waitFor()
    expect(await createButton(page).evaluate(el => el.getBoundingClientRect().top < 80)).toBe(true)
    // The summary follows the scroll while the owner is filled in.
    await page.getByRole('region', { name: 'First owner' }).scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 600)
    await expect.poll(async () => (await summaryCard(page).boundingBox())!.y).toBeLessThan(200)
  })

  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
  async function axeFindings(page: Page): Promise<string[]> {
    await page.evaluate(axeSource)
    return page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string, nodes: { target: string[] }[] }[] }> } }).axe
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).slice(0, 4).join(', ')}`)
    })
  }

  it('meets the accessibility rules in light and dark, wide and narrow, in both account choices', async () => {
    for (const width of [1440, 390]) {
      const { page } = await openNew({}, width)
      // The pointer stays where "New cafe" was clicked, over the navbar's Create cafe: its hover colour isn't what's measured.
      await page.mouse.move(0, 400)
      await page.getByLabel('Web address').fill('brown-bean')
      await page.getByRole('status').getByText('Address available').waitFor()
      expect(await axeFindings(page)).toEqual([])
      // Colours ease between the modes: measure once they have settled.
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      await page.waitForTimeout(500)
      expect(await axeFindings(page)).toEqual([])
      await ownerCard(page).getByRole('radio', { name: /Use existing account/ }).check()
      await page.getByRole('combobox', { name: 'Account', exact: true }).waitFor()
      expect(await axeFindings(page)).toEqual([])
      await page.evaluate(() => document.documentElement.classList.remove('dark'))
      await page.waitForTimeout(500)
      expect(await axeFindings(page)).toEqual([])
    }
  })
})

describe('a cafe\'s page', () => {
  it('shows its usage, address and owners; changes the address, sending the version', async () => {
    let cafe = NUK
    let sent: unknown
    const { page } = await open('/platform/cafes/cafe-1', {
      'GET /platform/tenants/{id}': () => cafe,
      'POST /platform/tenants/{id}/slug': ({ body }) => {
        sent = body
        cafe = { ...cafe, slug: 'nuk-coffee', version: 2, formerSlugs: ['nuk'] }
        return cafe
      },
    })
    await page.getByText('Orders, last 30 days').waitFor()
    await page.getByText('NUK Cafe Owner').waitFor()
    await page.getByRole('button', { name: 'Change' }).click()
    const form = dialog(page)
    await form.getByLabel('New address').fill('nuk-coffee')
    await form.getByRole('button', { name: 'Change address' }).click()
    await toast(page, 'NUK Cafe moved to /c/nuk-coffee').waitFor()
    expect(sent).toEqual({ version: 1, slug: 'nuk-coffee' })
    await page.getByRole('link', { name: '/c/nuk-coffee' }).waitFor()
    await page.getByText('/c/nuk', { exact: true }).waitFor()
  })

  it('pauses with a reason, then resumes after asking', async () => {
    let cafe = NUK
    const sent: unknown[] = []
    const { page, api } = await open('/platform/cafes/cafe-1', {
      'GET /platform/tenants/{id}': () => cafe,
      'POST /platform/tenants/{id}/suspend': ({ body }) => {
        sent.push(body)
        cafe = { ...cafe, status: 'suspended', suspendedReason: 'Unpaid invoice', version: 2 }
        return cafe
      },
      'POST /platform/tenants/{id}/resume': ({ body }) => {
        sent.push(body)
        cafe = { ...cafe, status: 'active', suspendedReason: null, version: 3 }
        return cafe
      },
    })
    await page.getByRole('button', { name: 'Pause cafe' }).click()
    const form = dialog(page)
    // A reason is required.
    await form.getByRole('button', { name: 'Pause cafe' }).click()
    await form.getByText('Required').waitFor()
    await form.getByLabel('Reason').fill('Unpaid invoice')
    await form.getByRole('button', { name: 'Pause cafe' }).click()
    await page.getByText('This cafe is paused').waitFor()
    await page.getByText(/Reason: Unpaid invoice/).waitFor()

    await page.getByRole('button', { name: 'Resume cafe' }).click()
    await dialog(page).getByRole('button', { name: 'Resume' }).click()
    await toast(page, 'NUK Cafe is open again').waitFor()
    await page.getByRole('button', { name: 'Pause cafe' }).waitFor()
    expect(sent).toEqual([{ version: 1, reason: 'Unpaid invoice' }, { version: 2 }])
    expect(writes(api.calls)).toEqual(['POST /platform/tenants/cafe-1/suspend', 'POST /platform/tenants/cafe-1/resume'])
  })

  it('an unknown cafe says so, with the way back', async () => {
    const { page } = await open('/platform/cafes/cafe-404', {
      'GET /platform/tenants/{id}': () => {
        throw failures.notFound('The cafe was not found.')
      },
    })
    await page.getByText('This cafe doesn\'t exist').waitFor()
    await page.getByRole('link', { name: 'Back to Cafes' }).first().waitFor()
  })
})
