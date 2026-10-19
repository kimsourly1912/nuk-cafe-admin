import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { OwnerChange, PlatformOwner, PlatformSession, TenantDetail, TenantOwner, TenantSummary } from '../../shared/contracts/tenants'
import type { MockHandler } from './support/mock-api'
import { failures, MockFailure, mockApi, paginatedHandler, setupE2e, toast } from './support/mock-api'

await setupE2e()

// A cafe's owners and internal notes in the platform console (step P2, D189), against a mocked
// API: Add owner (an existing account or a new one, with its password shown once), Remove owner,
// Transfer ownership, the "No active owner" state on the page and as a Cafes filter, and the notes.
// The server's own rules (versions, the last-owner guard, the batch) are covered by the server tests.

const SUPERADMIN: PlatformSession = { userId: 'super-1', email: 'ops@example.com', name: 'Ops', mustChangePassword: false, twoFactorEnabled: true }

const BEA_ID = '0a1b2c3d-0000-4000-8000-000000000011'
const SOKHA_ID = '0a1b2c3d-0000-4000-8000-000000000012'
const ZOE_ID = '0a1b2c3d-0000-4000-8000-000000000013'

const ownerOf = (id: string, name: string, overrides: Partial<TenantOwner> = {}): TenantOwner =>
  ({ id, name, email: `${name.split(' ')[0]!.toLowerCase()}@example.com`, banned: false, staffAccess: false, ...overrides })
const BEA = ownerOf(BEA_ID, 'Bea Brown')
const SOKHA = ownerOf(SOKHA_ID, 'Sokha Lead', { staffAccess: true })

function cafeOf(overrides: Partial<TenantDetail> = {}): TenantDetail {
  const owners = overrides.owners ?? [BEA, SOKHA]
  return {
    id: 'cafe-1',
    name: 'Brown Bean',
    slug: 'brown-bean',
    status: 'active',
    suspendedReason: null,
    createdAt: '2026-10-01T03:00:00.000Z',
    version: 4,
    usage: { branches: 1, staff: 3, ordersLast30Days: 12, lastOrderAt: null },
    formerSlugs: [],
    notes: { contactName: null, contactPhone: null, notes: null, version: 0, updatedAt: null },
    ...overrides,
    owners,
    activeOwners: owners.filter(owner => !owner.banned).length,
  }
}
const OWNERLESS = cafeOf({ id: 'cafe-2', name: 'Old Mill', slug: 'old-mill', owners: [ownerOf(BEA_ID, 'Bea Brown', { banned: true })] })
const summary = ({ owners: _o, formerSlugs: _f, notes: _n, ...cafe }: TenantDetail): TenantSummary => cafe

const ACCOUNTS: PlatformOwner[] = [
  { id: ZOE_ID, name: 'Zoe Tran', email: 'zoe@example.com', cafes: [{ id: 'cafe-8', name: 'Tea Kiosk', slug: 'tea-kiosk' }] },
]
const accountSearch: MockHandler = ({ url: request }) => {
  const term = (request.searchParams.get('search') ?? '').toLowerCase()
  return ACCOUNTS.filter(account => `${account.name} ${account.email}`.toLowerCase().includes(term))
}

/** Cafes filtered by `owner=none` like the server. */
function cafesHandler(cafes: () => TenantDetail[]): MockHandler {
  return (request) => {
    const ownerless = request.url.searchParams.get('owner') === 'none'
    return paginatedHandler(() => cafes().filter(cafe => !ownerless || cafe.activeOwners === 0).map(summary))(request)
  }
}

async function open(path: string, handlers: Record<string, MockHandler> = {}, width?: number) {
  const page = await createPage()
  page.setDefaultTimeout(8000)
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, {
    'GET /platform/me': () => SUPERADMIN,
    'GET /platform/tenants': cafesHandler(() => [cafeOf(), OWNERLESS]),
    'GET /platform/tenants/counts': () => ({ active: 2, suspended: 0 }),
    'GET /platform/tenants/{id}': () => cafeOf(),
    'GET /platform/owner-candidates': accountSearch,
    ...handlers,
  })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const dialog = (page: Page) => page.getByRole('dialog')
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))
const ownerRow = (page: Page, name: string) => page.getByRole('list', { name: 'Owners' }).getByRole('listitem').filter({ hasText: name })

async function ownerAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  return page.getByRole('menuitem', { name: new RegExp(action) })
}

async function chooseAccount(page: Page, search: string, option: RegExp) {
  await dialog(page).getByRole('combobox', { name: 'Account', exact: true }).click()
  await page.getByPlaceholder('Search by name or email…').fill(search)
  await page.getByRole('option', { name: option }).click()
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
}

describe('a cafe\'s owners', () => {
  it('are listed with who is banned and who also works at a branch', async () => {
    const { page } = await open('/platform/cafes/cafe-1')
    await ownerRow(page, 'Bea Brown').getByText('bea@example.com').waitFor()
    await ownerRow(page, 'Sokha Lead').getByText('Also branch staff').waitFor()
    expect(await page.getByTestId('no-active-owner').count()).toBe(0)
  })

  it('adds an existing account with a reason, sending the cafe\'s version', async () => {
    let cafe = cafeOf()
    let sent: unknown
    const { page, api } = await open('/platform/cafes/cafe-1', {
      'GET /platform/tenants/{id}': () => cafe,
      'POST /platform/tenants/{id}/owners': ({ body }) => {
        sent = body
        cafe = cafeOf({ version: 5, owners: [BEA, SOKHA, ownerOf(ZOE_ID, 'Zoe Tran')] })
        return { tenant: cafe, temporaryPassword: null } satisfies OwnerChange
      },
    })
    await page.getByRole('button', { name: 'Add owner' }).click()
    const form = dialog(page)
    // An account and a reason are required.
    await form.getByRole('button', { name: 'Add owner' }).click()
    await form.getByText('Choose an account').waitFor()
    await form.getByText('Required').waitFor()
    await chooseAccount(page, 'zoe', /zoe@example\.com/)
    await form.getByTestId('chosen-owner').getByText('Owns Tea Kiosk').waitFor()
    await form.getByLabel('Reason').fill('The owner asked by phone')
    await form.getByRole('button', { name: 'Add owner' }).click()
    await toast(page, 'Owner added to Brown Bean').waitFor()
    await form.waitFor({ state: 'detached' })
    await ownerRow(page, 'Zoe Tran').waitFor()
    expect(sent).toEqual({ version: 4, reason: 'The owner asked by phone', owner: { kind: 'existing', userId: ZOE_ID } })
    expect(writes(api.calls)).toEqual(['POST /platform/tenants/cafe-1/owners'])
  })

  it('adds a new account and shows its temporary password once, until Done', async () => {
    let sent: unknown
    const { page } = await open('/platform/cafes/cafe-1', {
      'POST /platform/tenants/{id}/owners': ({ body }) => {
        sent = body
        return { tenant: cafeOf({ version: 5 }), temporaryPassword: 'Hq7x-3mPa-kR9t-Wz2c' } satisfies OwnerChange
      },
    })
    await page.getByRole('button', { name: 'Add owner' }).click()
    const form = dialog(page)
    await form.getByRole('radio', { name: /Create new account/ }).check()
    await form.getByLabel('Owner name').fill('Dara Chan')
    await form.getByLabel('Email').fill('Dara@Example.com')
    await form.getByLabel('Reason').fill('Owner unreachable')
    await form.getByRole('button', { name: 'Add owner' }).click()
    await form.getByTestId('temporary-password').getByText('Hq7x-3mPa-kR9t-Wz2c').waitFor()
    await form.getByText('dara@example.com').waitFor()
    expect(sent).toEqual({ version: 4, reason: 'Owner unreachable', owner: { kind: 'new', name: 'Dara Chan', email: 'dara@example.com' } })
    // Shown once: Escape doesn't close it, only Done does.
    await page.keyboard.press('Escape')
    await form.getByTestId('temporary-password').waitFor()
    await form.getByRole('button', { name: 'Done' }).click()
    await form.waitFor({ state: 'detached' })
  })

  it('a new person whose email has an account is offered as the existing account', async () => {
    const { page } = await open('/platform/cafes/cafe-1', {
      'POST /platform/tenants/{id}/owners': () => {
        throw new MockFailure(409, 'ACCOUNT_EXISTS', 'This email already has an account.', { 'owner.email': ['This email already has an account: choose Use existing account'] })
      },
    })
    await page.getByRole('button', { name: 'Add owner' }).click()
    const form = dialog(page)
    await form.getByRole('radio', { name: /Create new account/ }).check()
    await form.getByLabel('Owner name').fill('Zoe')
    await form.getByLabel('Email').fill('zoe@example.com')
    await form.getByLabel('Reason').fill('Asked')
    await form.getByRole('button', { name: 'Add owner' }).click()
    await form.getByText('This email already has an account', { exact: true }).waitFor()
    await form.getByRole('button', { name: 'Use existing account' }).click()
    await form.getByTestId('chosen-owner').getByText('zoe@example.com').waitFor()
  })

  it('removes an owner with a reason; the last one who can sign in can\'t be removed', async () => {
    let cafe = cafeOf()
    let sent: unknown
    const { page, api } = await open('/platform/cafes/cafe-1', {
      'GET /platform/tenants/{id}': () => cafe,
      'POST /platform/tenants/{id}/owners/{id}/remove': ({ body }) => {
        sent = body
        cafe = cafeOf({ version: 5, owners: [BEA] })
        return { tenant: cafe, temporaryPassword: null } satisfies OwnerChange
      },
    })
    await (await ownerAction(page, 'Sokha Lead', 'Remove owner')).click()
    const form = dialog(page)
    await form.getByText('Sokha Lead keeps their branch roles here').waitFor()
    await form.getByLabel('Reason').fill('Sold their share')
    await form.getByRole('button', { name: 'Remove owner' }).click()
    await toast(page, 'Sokha Lead no longer owns Brown Bean').waitFor()
    await ownerRow(page, 'Sokha Lead').waitFor({ state: 'detached' })
    expect(sent).toEqual({ version: 4, reason: 'Sold their share' })

    // Bea is now the only owner who can sign in.
    const remove = await ownerAction(page, 'Bea Brown', 'Remove owner')
    await expect.poll(() => remove.getAttribute('data-disabled')).not.toBeNull()
    await page.getByText('No other owner can sign in: transfer instead').waitFor()
    expect(writes(api.calls)).toEqual(['POST /platform/tenants/cafe-1/owners/' + SOKHA_ID + '/remove'])
  })

  it('a cafe with no active owner says so; transferring the banned owner\'s ownership fixes it', async () => {
    let cafe = OWNERLESS
    let sent: unknown
    const { page } = await open('/platform/cafes/cafe-2', {
      'GET /platform/tenants/{id}': () => cafe,
      'POST /platform/tenants/{id}/owners/{id}/transfer': ({ body }) => {
        sent = body
        cafe = cafeOf({ ...OWNERLESS, version: 5, owners: [ownerOf(ZOE_ID, 'Zoe Tran')] })
        return { tenant: cafe, temporaryPassword: null } satisfies OwnerChange
      },
    })
    await page.getByTestId('no-active-owner').getByText('No active owner').waitFor()
    await ownerRow(page, 'Bea Brown').getByText('Banned').waitFor()
    await (await ownerAction(page, 'Bea Brown', 'Transfer ownership')).click()
    const form = dialog(page)
    await form.getByText('Transfer Bea Brown\'s ownership').waitFor()
    await chooseAccount(page, 'zoe', /zoe@example\.com/)
    await form.getByLabel('Reason').fill('Owner banned for fraud; partner takes over')
    await form.getByRole('button', { name: 'Transfer ownership' }).click()
    await toast(page, 'Bea Brown\'s ownership of Old Mill transferred').waitFor()
    await page.getByTestId('no-active-owner').waitFor({ state: 'detached' })
    await ownerRow(page, 'Zoe Tran').waitFor()
    expect(sent).toEqual({ version: 4, reason: 'Owner banned for fraud; partner takes over', owner: { kind: 'existing', userId: ZOE_ID } })
  })

  it('one\'s own ownership offers neither Transfer nor Remove', async () => {
    const own = ownerOf(SUPERADMIN.userId, 'Ops Person')
    const { page } = await open('/platform/cafes/cafe-1', { 'GET /platform/tenants/{id}': () => cafeOf({ owners: [BEA, own] }) })
    for (const action of ['Transfer ownership', 'Remove owner']) {
      const item = await ownerAction(page, 'Ops Person', action)
      await expect.poll(() => item.getAttribute('data-disabled')).not.toBeNull()
      await page.keyboard.press('Escape')
    }
  })

  it('a refusal from the server is said, and the dialog keeps the input', async () => {
    const { page } = await open('/platform/cafes/cafe-1', {
      'POST /platform/tenants/{id}/owners/{id}/remove': () => {
        throw failures.conflict('LAST_OWNER', 'The cafe needs at least one owner who can sign in. Add another owner first, or transfer the ownership.')
      },
    })
    await (await ownerAction(page, 'Sokha Lead', 'Remove owner')).click()
    await dialog(page).getByLabel('Reason').fill('Sold their share')
    await dialog(page).getByRole('button', { name: 'Remove owner' }).click()
    await toast(page, 'Could not remove Sokha Lead').waitFor()
    expect(await dialog(page).getByLabel('Reason').inputValue()).toBe('Sold their share')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await ownerRow(page, 'Sokha Lead').waitFor()
  })
})

describe('internal notes', () => {
  it('are saved with the phone in E.164 and the notes\' own version, then shown', async () => {
    let cafe = cafeOf()
    const sent: unknown[] = []
    const { page } = await open('/platform/cafes/cafe-1', {
      'GET /platform/tenants/{id}': () => cafe,
      'PUT /platform/tenants/{id}/notes': ({ body }) => {
        sent.push(body)
        const input = body as { contactName: string | null, contactPhone: string | null, notes: string | null }
        cafe = { ...cafe, notes: { ...input, version: cafe.notes.version + 1, updatedAt: new Date().toISOString() } }
        return cafe
      },
    })
    await page.getByText('No notes yet').waitFor()
    await page.getByRole('button', { name: 'Edit internal notes' }).click()
    const form = dialog(page)
    await form.getByLabel('Contact person').fill('Bea Brown')
    await form.getByLabel('Phone').fill('012 345 67')
    await form.getByRole('button', { name: 'Save notes' }).click()
    await form.getByText('Enter a valid Cambodian phone number').waitFor()
    await form.getByLabel('Phone').fill('012 345 678')
    await form.getByLabel('Notes').fill('Prefers Telegram.\nCall after 2 PM.')
    await form.getByRole('button', { name: 'Save notes' }).click()
    await toast(page, 'Notes about Brown Bean saved').waitFor()
    await page.getByRole('link', { name: '+855 12 345 678' }).waitFor()
    await page.getByText('Call after 2 PM.').waitFor()

    await page.getByRole('button', { name: 'Edit internal notes' }).click()
    await dialog(page).getByLabel('Contact person').fill('')
    await dialog(page).getByRole('button', { name: 'Save notes' }).click()
    await toast(page, 'Notes about Brown Bean saved').last().waitFor()
    expect(sent).toEqual([
      { version: 0, contactName: 'Bea Brown', contactPhone: '+85512345678', notes: 'Prefers Telegram.\nCall after 2 PM.' },
      { version: 1, contactName: null, contactPhone: '+85512345678', notes: 'Prefers Telegram.\nCall after 2 PM.' },
    ])
    await page.getByText('Not set').waitFor()
  })

  it('closing with changes asks first', async () => {
    const { page, api } = await open('/platform/cafes/cafe-1')
    await page.getByRole('button', { name: 'Edit internal notes' }).click()
    await dialog(page).getByLabel('Notes').fill('Half a thought')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Keep editing' }).click()
    expect(await dialog(page).getByLabel('Notes').inputValue()).toBe('Half a thought')
    expect(writes(api.calls)).toEqual([])
  })
})

describe('the Cafes list', () => {
  it('filters cafes with no active owner through the URL and the API, and marks them', async () => {
    const { page, api } = await open('/platform')
    await page.getByRole('row').filter({ hasText: 'Old Mill' }).getByText('No active owner').waitFor()
    expect(await page.getByRole('row').filter({ hasText: 'Brown Bean' }).getByText('No active owner').count()).toBe(0)
    await page.getByRole('combobox', { name: 'Owner' }).click()
    await page.getByRole('option', { name: 'No active owner' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('owner')).toBe('none')
    await page.getByRole('table').getByText('Brown Bean').waitFor({ state: 'detached' })
    await page.getByRole('table').getByText('Old Mill').waitFor()
    expect(api.calls).toContain('GET /platform/tenants')
  })

  it('on a phone, the row says it too', async () => {
    const { page } = await open('/platform?owner=none', {}, 390)
    const list = page.getByRole('list', { name: 'Cafes' })
    await list.getByRole('link', { name: 'Old Mill' }).getByText('No active owner').waitFor()
    expect(await list.getByRole('link').count()).toBe(1)
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
    // The pointer rests where the last click was: a hovered primary button is the theme-wide open contrast item.
    await page.mouse.move(0, 0)
    expect(await axeFindings(page)).toEqual([])
    // Colours ease between the modes: measure once they have settled.
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
  }

  it('the page without an active owner, with notes, the owner and notes dialogs and the list meet the rules in light and dark, wide and narrow', async () => {
    const noted = { ...OWNERLESS, notes: { contactName: 'Bea Brown', contactPhone: '+85512345678', notes: 'Prefers Telegram.', version: 1, updatedAt: new Date().toISOString() } }
    for (const width of [1440, 390]) {
      const detail = await open('/platform/cafes/cafe-2', { 'GET /platform/tenants/{id}': () => noted }, width)
      await detail.page.getByTestId('no-active-owner').waitFor()
      await detail.page.getByText('Prefers Telegram.').waitFor()
      await bothModes(detail.page)

      const add = await open('/platform/cafes/cafe-1', {}, width)
      await add.page.getByRole('button', { name: 'Add owner' }).click()
      await dialog(add.page).getByRole('combobox', { name: 'Account', exact: true }).waitFor()
      await bothModes(add.page)

      const notes = await open('/platform/cafes/cafe-1', {}, width)
      await notes.page.getByRole('button', { name: 'Edit internal notes' }).click()
      await dialog(notes.page).getByLabel('Contact person').waitFor()
      await bothModes(notes.page)

      const list = await open('/platform?owner=none', {}, width)
      await list.page.getByText('No active owner').first().waitFor()
      await bothModes(list.page)
    }
  })
})
