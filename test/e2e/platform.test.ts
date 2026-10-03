import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { CreatedTenant, PlatformSession, TenantDetail, TenantSummary } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { failures, MockFailure, mockApi, paginatedHandler, setupE2e, toast } from './support/mock-api'

await setupE2e()

// The platform console (step T2a, D142) in the browser, against a mocked API: the platform team's
// sign-in, Cafes, New cafe with the owner's password shown once, and a cafe's page (change the
// address, pause, resume).

const SUPERADMIN: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false }

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
    owners: [{ id: `${id}-owner`, name: `${name} Owner`, email: `owner@${slug}.example` }],
    formerSlugs: [],
    ...overrides,
  }
}

const NUK = cafeOf('cafe-1', 'NUK Cafe', 'nuk')
const PAUSED = cafeOf('cafe-2', 'Old Mill', 'old-mill', { status: 'suspended', suspendedReason: 'Unpaid invoice', usage: { branches: 2, staff: 5, ordersLast30Days: 0, lastOrderAt: null } })
const summary = ({ owners: _o, formerSlugs: _f, ...cafe }: TenantDetail): TenantSummary => cafe

const signedIn = (session: PlatformSession = SUPERADMIN): Record<string, MockHandler> => ({ 'GET /platform/me': () => session })

/** Cafes filtered by `status` and `search` like the server, with the counts' `pageSize=1` calls. */
function cafesHandler(cafes: () => TenantDetail[]): MockHandler {
  const list = paginatedHandler(() => cafes().map(summary))
  return (request) => {
    const status = request.url.searchParams.get('status')
    if (!status) return list(request)
    const rows = cafes().filter(c => c.status === status).map(summary)
    return { items: rows, page: 1, pageSize: 20, total: rows.length, totalPages: 1 }
  }
}

async function open(path: string, handlers: Record<string, MockHandler> = {}, width?: number) {
  const page = await createPage()
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, {
    ...signedIn(),
    'GET /platform/tenants': cafesHandler(() => [NUK, PAUSED]),
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
    await page.getByRole('heading', { name: 'NUK Platform' }).waitFor()
    await page.getByLabel('Email').fill('ops@example.com')
    await page.getByLabel('Password', { exact: true }).fill('a long password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-1')
    await page.getByText('/c/nuk', { exact: true }).waitFor()
    expect(api.calls).toContain('POST /auth/sign-in/email')
  })

  it('refuses an account that isn\'t on the platform team, and signs it out again', async () => {
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
    })
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password', { exact: true }).fill('a long password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('alert').getByText('This account doesn\'t have access to the platform console.').waitFor()
    await expect.poll(() => api.calls.includes('POST /auth/sign-out')).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/platform/sign-in')
  })

  it('on a temporary password, asks for a new one before anything else', async () => {
    const { page } = await open('/platform', signedIn({ ...SUPERADMIN, mustChangePassword: true }))
    await page.waitForURL(address => address.pathname === '/platform/change-password')
    await page.getByRole('heading', { name: 'Choose your password' }).waitFor()
  })
})

describe('cafes', () => {
  it('lists each cafe with its status, address and usage; the name opens it', async () => {
    const { page } = await open('/platform', { 'GET /platform/tenants/{id}': () => NUK })
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

    await page.getByRole('table').getByRole('link', { name: 'NUK Cafe', exact: true }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-1')
  })

  it('searches and filters through the URL and the API', async () => {
    const { page, api } = await open('/platform')
    await page.getByRole('table').getByText('Old Mill').waitFor()
    await page.getByRole('tab', { name: /Paused/ }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('suspended')
    await page.getByRole('table').getByText('NUK Cafe').waitFor({ state: 'detached' })
    await page.getByPlaceholder('Search name or address…').fill('mill')
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('mill')
    expect(api.calls.filter(c => c === 'GET /platform/tenants').length).toBeGreaterThan(2)
  })

  it('on a phone, each cafe is a row', async () => {
    const { page } = await open('/platform', {}, 390)
    const list = page.getByRole('list', { name: 'Cafes' })
    await list.getByRole('link', { name: 'NUK Cafe' }).waitFor()
    await list.getByText('Last order 2 hours ago').waitFor()
    expect(await page.getByRole('table').count()).toBe(0)
  })
})

describe('a new cafe', () => {
  it('suggests the address from the name, saves the cafe, branch and owner, and shows the password once', async () => {
    let sent: unknown
    const created = cafeOf('cafe-3', 'Brown Bean', 'brown-bean', { usage: { branches: 1, staff: 1, ordersLast30Days: 0, lastOrderAt: null }, owners: [{ id: 'u-3', name: 'Bea Brown', email: 'bea@example.com' }] })
    const { page, api } = await open('/platform', {
      'POST /platform/tenants': ({ body }) => {
        sent = body
        return { tenant: created, temporaryPassword: 'tmp-Pass-1234' } satisfies CreatedTenant
      },
      'GET /platform/tenants/{id}': () => created,
    })
    await page.getByRole('button', { name: 'New cafe' }).click()
    const form = dialog(page)
    await form.getByRole('region', { name: 'Cafe', exact: true }).getByLabel('Name').fill('Brown Bean Café')
    await expect.poll(() => form.getByLabel('Web address').inputValue()).toBe('brown-bean-cafe')
    // Typed by hand: the name no longer changes it.
    await form.getByLabel('Web address').fill('brown-bean')
    await form.getByRole('region', { name: 'Cafe', exact: true }).getByLabel('Name').fill('Brown Bean')
    expect(await form.getByLabel('Web address').inputValue()).toBe('brown-bean')
    await form.getByLabel('Branch name').fill('Bean Street')
    await form.getByRole('region', { name: 'First owner' }).getByLabel('Name').fill('Bea Brown')
    await form.getByLabel('Email').fill('Bea@Example.com')
    await form.getByRole('button', { name: 'Create cafe' }).click()

    const result = page.getByRole('dialog', { name: 'Brown Bean is ready' })
    await result.getByTestId('temporary-password').getByText('tmp-Pass-1234').waitFor()
    await result.getByText(/\/c\/brown-bean\/admin\/login$/).waitFor()
    expect(sent).toEqual({ name: 'Brown Bean', slug: 'brown-bean', branchName: 'Bean Street', timezone: 'Asia/Phnom_Penh', ownerName: 'Bea Brown', ownerEmail: 'bea@example.com' })
    await toast(page, 'Brown Bean created').waitFor()

    await result.getByRole('button', { name: 'Open cafe' }).click()
    await page.waitForURL(address => address.pathname === '/platform/cafes/cafe-3')
    expect(writes(api.calls)).toEqual(['POST /platform/tenants'])
  })

  it('an address that\'s taken is said on its field, and the form stays open', async () => {
    const { page } = await open('/platform', {
      'POST /platform/tenants': () => {
        throw new MockFailure(409, 'SLUG_TAKEN', 'This web address is taken. Choose another one.', { slug: ['Already used by a cafe, now or before'] })
      },
    })
    await page.getByRole('button', { name: 'New cafe' }).click()
    const form = dialog(page)
    await form.getByRole('region', { name: 'Cafe', exact: true }).getByLabel('Name').fill('NUK')
    await form.getByRole('region', { name: 'First owner' }).getByLabel('Name').fill('Someone')
    await form.getByLabel('Email').fill('someone@example.com')
    await form.getByRole('button', { name: 'Create cafe' }).click()
    await form.getByText('Already used by a cafe, now or before').waitFor()
    await toast(page, 'Could not create NUK').waitFor()
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
