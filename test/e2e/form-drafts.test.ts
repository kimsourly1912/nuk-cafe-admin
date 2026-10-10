import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { BranchSettings } from '../../shared/contracts/branches'
import type { MenuItem } from '../../shared/contracts/menu-items'
import type { MockApi, MockHandler } from './support/mock-api'
import { ADMIN, failures, menuItemOf, mockApi, RIVERSIDE, setupE2e, toast } from './support/mock-api'

// Unsaved input kept in the browser (D151): the menu item editor and the branch settings keep what
// was typed, so a crash, a dropped tab or an expired session doesn't lose it. Cases:
// docs/reference/forms.md → "Drafts kept in the browser".
await setupE2e()

const LATTE: MenuItem = menuItemOf('item-1', 'Latte', { version: 3 })
const ITEM_PAGE = '/c/nuk/admin/products/item-1'
const LATTE_DRAFT = 'nuk:draft:nuk:user-1:menu-item:item-1'

function itemBackend(item: () => MenuItem = () => LATTE): Record<string, MockHandler> {
  return {
    'GET /admin/menu/items': () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
    'GET /admin/menu/items/{id}': () => item(),
  }
}

async function open(handlers: Record<string, MockHandler>, path = ITEM_PAGE): Promise<{ page: Page, api: MockApi }> {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const nameField = (page: Page) => page.getByLabel('Name', { exact: true })
const banner = (page: Page) => page.getByRole('status').filter({ hasText: 'Unsaved changes from' })
const stored = (page: Page, key: string) => page.evaluate(k => localStorage.getItem(k), key)
const draftKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('nuk:draft:')))

/** Types into the name, and waits until the draft has been written. */
async function typeName(page: Page, name: string, key = LATTE_DRAFT) {
  await expect.poll(() => nameField(page).inputValue()).not.toBe('')
  await nameField(page).fill(name)
  await expect.poll(async () => (await stored(page, key)) ?? '').toContain(name)
}

/** A reload, as after a crash or a phone dropping the tab (the unsaved-changes prompt never shows headless). */
async function reload(page: Page) {
  await page.goto(page.url(), { waitUntil: 'hydration' })
}

describe('the menu item editor keeps its unsaved input', () => {
  it('offers it back after a reload; Restore fills the form, Save sends it and drops the draft', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...itemBackend(),
      'PATCH /admin/menu/items/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return { ...LATTE, name: 'Latte draft', version: 4 }
      },
    })
    await typeName(page, 'Latte draft')
    expect(JSON.parse((await stored(page, LATTE_DRAFT))!)).toMatchObject({ version: 3, value: { name: 'Latte draft' } })

    await reload(page)
    await banner(page).waitFor()
    await banner(page).getByText('This browser kept what you typed').waitFor()
    expect(await nameField(page).inputValue()).toBe('Latte')
    await banner(page).getByRole('button', { name: 'Restore' }).click()
    await banner(page).waitFor({ state: 'detached' })
    expect(await nameField(page).inputValue()).toBe('Latte draft')

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await toast(page, 'Menu item "Latte draft" updated').waitFor()
    expect(body).toMatchObject({ version: 3, name: 'Latte draft' })
    expect(await draftKeys(page)).toEqual([])
  })

  it('Discard drops it: the next visit offers nothing', async () => {
    const { page } = await open(itemBackend())
    await typeName(page, 'Latte draft')
    await reload(page)
    await banner(page).getByRole('button', { name: 'Discard' }).click()
    await banner(page).waitFor({ state: 'detached' })
    expect(await draftKeys(page)).toEqual([])
    await reload(page)
    await expect.poll(() => nameField(page).inputValue()).toBe('Latte')
    await page.waitForTimeout(300)
    expect(await banner(page).count()).toBe(0)
  })

  it('says when someone saved the item after the draft', async () => {
    let item = LATTE
    const { page } = await open(itemBackend(() => item))
    await typeName(page, 'Latte draft')
    item = { ...LATTE, name: 'Latte (theirs)', version: 4 }
    await reload(page)
    await banner(page).getByText('Someone saved this menu item after that').waitFor()
  })

  it('is never offered to another person on this browser', async () => {
    const { page, api } = await open(itemBackend())
    await typeName(page, 'Latte draft')
    api.set({ 'GET /admin/me': () => ({ ...ADMIN, userId: 'user-2', name: 'bob', email: 'bob@nukcafe.test' }) })
    await reload(page)
    await expect.poll(() => nameField(page).inputValue()).toBe('Latte')
    await page.waitForTimeout(800)
    expect(await banner(page).count()).toBe(0)
    // Still there for the person who typed it.
    expect(await draftKeys(page)).toEqual([LATTE_DRAFT])
  })

  it('leaving with Discard drops it', async () => {
    const { page } = await open(itemBackend())
    await typeName(page, 'Latte draft')
    await page.getByRole('link', { name: 'Categories' }).first().click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/categories')
    expect(await draftKeys(page)).toEqual([])
  })

  it('signing out removes every draft on this browser', async () => {
    const { page } = await open(itemBackend())
    await typeName(page, 'Latte draft')
    // A draft of another form, not open now.
    await page.evaluate(() => localStorage.setItem('nuk:draft:nuk:user-1:branch-settings:b-1', JSON.stringify({ value: { name: 'x' }, savedAt: Date.now() })))
    await page.getByRole('button', { name: 'alice', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/login')
    await expect.poll(() => draftKeys(page)).toEqual([])
  })

  it('a session that ends while editing keeps it, offered back after signing in again', async () => {
    const { page, api } = await open({
      ...itemBackend(),
      'PATCH /admin/menu/items/{id}': () => {
        throw failures.unauthorized()
      },
    })
    await expect.poll(() => nameField(page).inputValue()).toBe('Latte')
    await nameField(page).fill('Typed before expiry')
    // Saved at once: the expiry discards the form before the draft's own timer.
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/login')
    expect(await stored(page, LATTE_DRAFT)).toContain('Typed before expiry')

    api.set({ 'POST /auth/sign-in/email': () => ({ token: 't', user: { id: ADMIN.userId } }) })
    await page.getByLabel('Email').fill(ADMIN.email)
    await page.getByLabel('Password', { exact: true }).fill('secret')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(ITEM_PAGE)
    await banner(page).getByRole('button', { name: 'Restore' }).click()
    expect(await nameField(page).inputValue()).toBe('Typed before expiry')
  })

  it('a new item\'s draft is offered when New menu item opens again', async () => {
    const { page } = await open(itemBackend(), '/c/nuk/admin/products/new')
    await nameField(page).waitFor()
    await nameField(page).fill('Brand new')
    const key = 'nuk:draft:nuk:user-1:menu-item:new'
    await expect.poll(async () => (await stored(page, key)) ?? '').toContain('Brand new')
    await reload(page)
    await banner(page).getByRole('button', { name: 'Restore' }).click()
    expect(await nameField(page).inputValue()).toBe('Brand new')
  })
})

describe('branch settings keep their unsaved input', () => {
  const SETTINGS: BranchSettings = {
    id: RIVERSIDE.id,
    name: 'Riverside',
    timezone: 'Asia/Phnom_Penh',
    address: '#123 St. 63',
    phone: null,
    status: 'active',
    hours: [1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 480, endMinute: 1140 })),
    openNow: true,
    today: 1,
    version: 3,
  }

  it('offers the typed settings back after a reload', async () => {
    const { page } = await open({
      'GET /admin/branches/options': () => [RIVERSIDE],
      'GET /admin/branches/{id}': () => SETTINGS,
      'GET /admin/branches/{id}/tables': () => [],
    }, `/c/nuk/admin/branches/${RIVERSIDE.id}`)
    const field = page.getByLabel('Branch name')
    await expect.poll(() => field.inputValue()).toBe('Riverside')
    await field.fill('Riverside (new sign)')
    const key = `nuk:draft:nuk:user-1:branch-settings:${RIVERSIDE.id}`
    await expect.poll(async () => (await stored(page, key)) ?? '').toContain('Riverside (new sign)')
    await reload(page)
    await banner(page).getByRole('button', { name: 'Restore' }).click()
    expect(await field.inputValue()).toBe('Riverside (new sign)')
    expect(await page.getByRole('button', { name: 'Save changes' }).first().isVisible()).toBe(true)
  })
})
