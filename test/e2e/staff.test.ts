import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { StaffMember } from '../../shared/contracts/staff'
import { ADMIN, AIRPORT, mockApi, paginatedHandler, RIVERSIDE, setupE2e, staffOf, toast } from './support/mock-api'

await setupE2e()

const SELF = staffOf(ADMIN.userId, 'alice', { email: ADMIN.email, admin: true, memberships: [] })
const SOPHEA = staffOf('staff-2', 'Sophea')
const VANNA = staffOf('staff-3', 'Vanna', {
  memberships: [{ branchId: AIRPORT.id, branchName: AIRPORT.name, role: 'manager' }],
  mustChangePassword: true,
})

async function open(rows: StaffMember[] = [SELF, SOPHEA, VANNA], extra: Parameters<typeof mockApi>[1] = {}, width?: number) {
  const page = await createPage()
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, {
    'GET /admin/staff': paginatedHandler(rows),
    'GET /admin/branches/options': () => [AIRPORT, RIVERSIDE],
    ...extra,
  })
  await page.goto(url('/c/nuk/admin/staff'), { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Sophea', exact: true }).waitFor()
  return { page, api }
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name })
/** Opens a person from the table: their name is the record's button (not the whole row, D79). */
const openMember = (page: Page, name: string) => page.getByRole('table').getByRole('button', { name, exact: true }).click()
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))

async function rowAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  return page.getByRole('menuitem', { name: action })
}

describe('staff list', () => {
  it('shows who has which access, marks you and temporary passwords', async () => {
    const { page } = await open()
    await row(page, 'alice').getByText('(you)').waitFor()
    await row(page, 'alice').getByText('Admin', { exact: true }).waitFor()
    await row(page, 'Sophea').getByText('Staff at Riverside').waitFor()
    await row(page, 'Vanna').getByText('Manager at Airport').waitFor()
    await row(page, 'Vanna').getByText('Temporary password').waitFor()
    expect(await row(page, 'Sophea').getByText('Temporary password').count()).toBe(0)
  })

  it('filters by role and branch through the URL and the API', async () => {
    const { page, api } = await open()
    await page.getByRole('combobox', { name: 'Role' }).click()
    await page.getByRole('option', { name: 'Manager' }).click()
    await expect.poll(() => api.calls.filter(c => c === 'GET /admin/staff').length).toBeGreaterThan(1)
    await expect.poll(() => new URL(page.url()).searchParams.get('role')).toBe('manager')
  })

  it('won\'t let you disable yourself', async () => {
    const { page } = await open()
    const item = await rowAction(page, 'alice', 'Disable')
    await expect.poll(() => item.getAttribute('data-disabled')).not.toBeNull()
  })
})

describe('adding staff', () => {
  it('creates an account with a branch role and shows the temporary password once', async () => {
    let sent: unknown
    const { page, api } = await open(undefined, {
      'POST /admin/staff': ({ body }) => {
        sent = body
        return { staff: staffOf('staff-9', 'Dara', { email: 'dara@example.com', mustChangePassword: true }), temporaryPassword: 'Hq7x-3mPa-kR9t-Wz2c' }
      },
    })
    await page.getByRole('button', { name: 'Add staff member' }).first().click()
    const form = page.getByRole('dialog', { name: 'Add staff member' })
    await form.getByLabel('Name', { exact: true }).fill('Dara')
    await form.getByLabel(/^Email/).fill(' Dara@Example.com ')
    await form.getByRole('button', { name: 'Add branch' }).click()
    await form.getByRole('combobox', { name: 'Role at branch 1' }).click()
    await page.getByRole('option', { name: 'Manager' }).click()
    await form.getByRole('button', { name: 'Add', exact: true }).click()

    const passwordModal = page.getByRole('dialog', { name: 'Temporary password' })
    await passwordModal.getByTestId('temporary-password').filter({ hasText: 'Hq7x-3mPa-kR9t-Wz2c' }).waitFor()
    await toast(page, 'Account for Dara created').waitFor()
    // The first unused branch, by name: Airport.
    expect(sent).toEqual({ name: 'Dara', email: 'dara@example.com', admin: false, memberships: [{ branchId: AIRPORT.id, role: 'manager' }] })
    await passwordModal.getByRole('button', { name: 'Done' }).click()
    await passwordModal.waitFor({ state: 'hidden' })
    expect(writes(api.calls)).toEqual(['POST /admin/staff'])
  })

  it('needs some access before sending anything', async () => {
    const { page, api } = await open()
    await page.getByRole('button', { name: 'Add staff member' }).first().click()
    const form = page.getByRole('dialog', { name: 'Add staff member' })
    await form.getByLabel('Name', { exact: true }).fill('Dara')
    await form.getByLabel(/^Email/).fill('dara@example.com')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await form.getByText('Make them an admin or give them a role in at least one branch').waitFor()
    expect(writes(api.calls)).toEqual([])
  })

  it('says when an existing account got the access (no temporary password)', async () => {
    const { page } = await open(undefined, {
      'POST /admin/staff': () => ({ staff: staffOf('staff-9', 'Dara', { admin: true, memberships: [] }), temporaryPassword: null }),
    })
    await page.getByRole('button', { name: 'Add staff member' }).first().click()
    const form = page.getByRole('dialog', { name: 'Add staff member' })
    await form.getByLabel('Name', { exact: true }).fill('Dara')
    await form.getByLabel(/^Email/).fill('dara@example.com')
    await form.getByRole('switch', { name: 'Admin' }).click()
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await toast(page, 'Dara already had an account and now has staff access').waitFor()
    expect(await page.getByRole('dialog', { name: 'Temporary password' }).count()).toBe(0)
  })
})

describe('changing access', () => {
  it('replaces the roles, with the version the form opened', async () => {
    let sent: unknown
    const { page } = await open(undefined, {
      'PATCH /admin/staff/{id}': ({ body }) => {
        sent = body
        return { ...SOPHEA, admin: true }
      },
    })
    await openMember(page, 'Sophea')
    const form = page.getByRole('dialog', { name: 'Access of Sophea' })
    await form.getByRole('switch', { name: 'Admin' }).click()
    await form.getByRole('button', { name: 'Remove branch 1' }).click()
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Access of Sophea updated').waitFor()
    expect(sent).toEqual({ version: SOPHEA.version, admin: true, memberships: [] })
  })

  it('won\'t let you remove your own admin role', async () => {
    const { page } = await open()
    await openMember(page, 'alice')
    const form = page.getByRole('dialog', { name: 'Access of alice' })
    await expect.poll(() => form.getByRole('switch', { name: 'Admin' }).isDisabled()).toBe(true)
    await form.getByText('You can\'t remove your own admin role.').waitFor()
  })
})

describe('disabling', () => {
  it('asks first, then takes the person off the list', async () => {
    // Like the server: a disabled person has no access, so the list no longer includes them.
    const disabled = new Set<string>()
    const { page, api } = await open(undefined, {
      'GET /admin/staff': paginatedHandler(() => [SELF, SOPHEA, VANNA].filter(m => !disabled.has(m.id))),
      'POST /admin/staff/{id}/disable': ({ url }) => {
        disabled.add(url.pathname.split('/').at(-2)!)
        return null
      },
    })
    await (await rowAction(page, 'Sophea', 'Disable')).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await dialog.getByText('Their account keeps working as a customer', { exact: false }).waitFor()
    await dialog.getByRole('button', { name: 'Disable' }).click()

    await toast(page, 'Sophea no longer has staff access').waitFor()
    expect(writes(api.calls)).toEqual(['POST /admin/staff/staff-2/disable'])
    await row(page, 'Sophea').waitFor({ state: 'detached' })
  })
})

describe('resetting a password (step 10.1, D115)', () => {
  it('asks first, sends the version, then shows the new temporary password once', async () => {
    let sent: unknown
    const { page, api } = await open(undefined, {
      'POST /admin/staff/{id}/reset-password': ({ body }) => {
        sent = body
        return { staff: { ...SOPHEA, mustChangePassword: true, version: SOPHEA.version + 1 }, temporaryPassword: 'Rt4k-9pQx-M2wz-7hNc' }
      },
    })
    await (await rowAction(page, 'Sophea', 'Reset password')).click()
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await confirm.getByText('Their current password stops working', { exact: false }).waitFor()
    await confirm.getByRole('button', { name: 'Reset password' }).click()

    const shown = page.getByRole('dialog', { name: 'Temporary password' })
    await shown.getByTestId('temporary-password').filter({ hasText: 'Rt4k-9pQx-M2wz-7hNc' }).waitFor()
    await shown.getByText('Their old password no longer works', { exact: false }).waitFor()
    expect(sent).toEqual({ version: SOPHEA.version })
    expect(writes(api.calls)).toEqual(['POST /admin/staff/staff-2/reset-password'])
    await shown.getByRole('button', { name: 'Done' }).click()
    await shown.waitFor({ state: 'detached' })
  })

  it('cancelling the question sends nothing', async () => {
    const { page, api } = await open()
    await (await rowAction(page, 'Sophea', 'Reset password')).click()
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await confirm.waitFor({ state: 'detached' })
    expect(writes(api.calls)).toEqual([])
  })

  it('won\'t reset your own (Change password is in your account menu)', async () => {
    const { page } = await open()
    const item = await rowAction(page, 'alice', 'Reset password')
    await expect.poll(() => item.getAttribute('data-disabled')).not.toBeNull()
    await item.getByText('Use Change password in your account menu').waitFor()
  })
})

describe('staff on a phone', () => {
  const MANY = Array.from({ length: 45 }, (_, i) => staffOf(`staff-${i + 10}`, `Person ${i + 1}`))

  for (const width of [320, 390]) {
    it(`shows rows instead of a table, and nothing scrolls sideways at ${width}px`, async () => {
      const { page } = await open([SELF, SOPHEA, VANNA, ...MANY], {}, width)
      expect(await page.getByRole('table').count()).toBe(0)
      const list = page.getByRole('list', { name: 'Staff' })
      await list.getByRole('button', { name: 'Vanna', exact: true }).waitFor()
      await list.getByText('Manager at Airport').waitFor()
      await list.getByText('Temporary password').waitFor()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      // The toolbar wraps instead of scrolling: search on its own row, the filters below
      const toolbar = page.getByPlaceholder('Search name or email…').locator('xpath=ancestor::*[contains(@class, "border-b")][1]')
      expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const search = (await page.getByPlaceholder('Search name or email…').boundingBox())!
      const role = (await page.getByRole('combobox', { name: 'Role' }).boundingBox())!
      expect(role.y).toBeGreaterThan(search.y)
      // Pagination fits too
      await page.getByRole('navigation').last().scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  it('opens a person from their row (a large target), full screen, with the actions beside the row (not inside it)', async () => {
    const { page } = await open(undefined, {}, 390)
    const target = page.getByRole('button', { name: 'Sophea', exact: true })
    const actions = page.getByRole('button', { name: 'Actions for Sophea', exact: true })
    expect(await actions.evaluate(el => el.parentElement?.closest('button, a') === null)).toBe(true)
    const [targetBox, actionsBox] = [(await target.boundingBox())!, (await actions.boundingBox())!]
    expect(targetBox.height).toBeGreaterThanOrEqual(44)
    expect(actionsBox.width).toBeGreaterThanOrEqual(24)
    expect(actionsBox.x).toBeGreaterThanOrEqual(targetBox.x + targetBox.width)

    await target.click()
    const form = page.getByRole('dialog', { name: 'Access of Sophea' })
    await form.getByRole('switch', { name: 'Admin' }).waitFor()
    await expect.poll(async () => Math.round((await form.boundingBox())!.width)).toBe(390)
  })

  it('offers the same actions from the row menu as on a desktop', async () => {
    const { page } = await open(undefined, {}, 390)
    const item = await rowAction(page, 'alice', 'Disable')
    await expect.poll(() => item.getAttribute('data-disabled')).not.toBeNull()
    await page.getByRole('menuitem', { name: 'Edit access' }).click()
    await page.getByRole('dialog', { name: 'Access of alice' }).waitFor()
  })
})
