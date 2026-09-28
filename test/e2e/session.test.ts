import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { ADMIN, beforeUnloadPrevented, categoryItem, menuCategoryOf, deferred, failures, gotoHydrated, mockApi, openTabs, setupE2e, MENU_TEA, toast } from './support/mock-api'

// The session-transition contract (plugins/session-boundary.client.ts, useAuth generation,
// createApiFetch). Cases: docs/reference/app-behavior.md → "Session loss".
await setupE2e()

const ALICE = { ...ADMIN, userId: 'user-alice', email: 'alice@nukcafe.test', name: 'alice' }
const BOB = { ...ADMIN, userId: 'user-bob', email: 'bob@nukcafe.test', name: 'bob' }
const ALICE_ONLY = menuCategoryOf('cat-11', 'Alice-only draft')
const BOB_ONLY = menuCategoryOf('cat-12', 'Bob-only menu')
/** The Categories tree loads the whole list. */
const LIST = 'GET /admin/menu/categories'
const listOf = (...rows: object[]) => rows

const form = (page: Page) => page.getByRole('dialog', { name: /New category|Edit category/ })
const discardDialog = (page: Page) => page.getByText('Discard unsaved changes?')
const path = (page: Page) => new URL(page.url()).pathname

async function openNewForm(page: Page, name: string) {
  await page.getByRole('button', { name: 'New category' }).first().click()
  await form(page).locator('input').first().fill(name)
}

async function logout(page: Page, username: string) {
  await page.getByRole('button', { name: username, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
}

async function login(page: Page, username: string) {
  await page.getByLabel('Email').fill(`${username}@nukcafe.test`)
  await page.getByLabel('Password', { exact: true }).fill('secret')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

describe('session expiry', () => {
  it('expiring during a save goes to login: no discard dialog, no form left over, no error toast', async () => {
    const page = await createPage()
    await mockApi(page, {
      'POST /admin/menu/categories': () => {
        throw failures.unauthorized()
      },
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await categoryItem(page, 'Tea').waitFor()
    await openNewForm(page, 'Latte')
    await form(page).getByRole('button', { name: 'Create' }).click()

    await expect.poll(() => path(page)).toBe('/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/categories')
    await page.waitForTimeout(300)
    expect(await discardDialog(page).count()).toBe(0)
    expect(await form(page).count()).toBe(0)
    expect(await toast(page, /Could not create/).count()).toBe(0)
    expect(await beforeUnloadPrevented(page)).toBe(false)
  })

  it('a 401 ends the session once: no refresh, no retry loop', async () => {
    const page = await createPage()
    const api = await mockApi(page, {
      [LIST]: () => {
        throw failures.unauthorized()
      },
    })
    await page.goto(url('/categories'))
    await expect.poll(() => path(page)).toBe('/login')
    await page.waitForTimeout(500)
    expect(api.calls.filter(c => c === LIST)).toHaveLength(1)
  })

  it('admin access removed mid-session (403 NOT_ADMIN) also goes to login', async () => {
    const page = await createPage()
    const api = await mockApi(page)
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await categoryItem(page, 'Tea').waitFor()
    api.set({
      'POST /admin/menu/categories': () => {
        throw failures.notAdmin()
      },
    })
    await openNewForm(page, 'Latte')
    await form(page).getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => path(page)).toBe('/login')
  })
})

describe('logout in another tab', () => {
  it('sends a tab with unsaved input to login without trapping it behind a dialog', async () => {
    const [tab1, tab2] = await openTabs(2)
    await mockApi(tab1!)
    await mockApi(tab2!)
    await gotoHydrated(tab1!, '/categories')
    await gotoHydrated(tab2!, '/categories')
    await openNewForm(tab2!, 'Unsaved latte')

    await logout(tab1!, 'alice')

    await expect.poll(() => path(tab2!)).toBe('/login')
    await tab2!.waitForTimeout(300)
    expect(await discardDialog(tab2!).count()).toBe(0)
    expect(await form(tab2!).count()).toBe(0)
    expect(await beforeUnloadPrevented(tab2!)).toBe(false)
  })
})

describe('switching users in the same browser', () => {
  it('nothing from the previous user reaches the next one: data, late responses, toasts', async () => {
    const page = await createPage()
    const aliceSave = deferred()
    const api = await mockApi(page, {
      'GET /admin/me': () => ALICE,
      [LIST]: () => listOf(MENU_TEA, ALICE_ONLY),
      'PATCH /admin/menu/categories/{id}': aliceSave.handler,
      'POST /admin/menu/categories/{id}/archive': () => {
        throw failures.conflict('VERSION_CONFLICT', 'Alice cannot archive this')
      },
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await categoryItem(page, 'Alice-only draft').waitFor()

    // Alice leaves a batch result with "Retry failed" (it stays 10 s) and a save in flight.
    await page.getByRole('checkbox', { name: 'Select Alice-only draft' }).click()
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, '0 categories archived, 1 failed').waitFor()
    await page.getByRole('button', { name: 'Actions for Tea' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await form(page).locator('input').first().fill('Tea by Alice')
    await form(page).getByRole('button', { name: 'Save' }).click()
    await aliceSave.started()
    // The button, not Escape: Escape would also dismiss the toast this test is about.
    await form(page).getByRole('button', { name: 'Close' }).first().click()
    await form(page).waitFor({ state: 'hidden' })

    expect(await toast(page, '0 categories archived, 1 failed').count()).toBe(1)
    await logout(page, 'alice')
    await expect.poll(() => path(page)).toBe('/login')
    expect(await toast(page, '0 categories archived, 1 failed').count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Retry failed' }).count()).toBe(0)

    // Bob signs in; the backend now answers as Bob.
    api.set({
      'POST /auth/sign-in/email': () => ({ token: 't' }),
      'GET /admin/me': () => BOB,
      [LIST]: () => listOf(BOB_ONLY),
    })
    await login(page, 'bob')
    await expect.poll(() => path(page)).toBe('/')
    await page.getByRole('link', { name: /Categories/ }).first().click()
    await categoryItem(page, 'Bob-only menu').waitFor()

    // Alice's save finally answers: it must not toast or refresh anything in Bob's session.
    const loadsBefore = api.calls.filter(c => c === LIST).length
    aliceSave.release({ ...MENU_TEA, name: 'Tea by Alice', version: 2 })
    await page.waitForTimeout(500)
    expect(await toast(page, /updated/).count()).toBe(0)
    expect(api.calls.filter(c => c === LIST).length).toBe(loadsBefore)
    expect(await page.getByText('Alice-only draft').count()).toBe(0)
  })

  it('a list response for the previous user that arrives late never shows', async () => {
    const page = await createPage()
    const aliceList = deferred()
    let aliceSignedIn = true
    const api = await mockApi(page, {
      'GET /admin/me': () => (aliceSignedIn ? ALICE : BOB),
      [LIST]: request => (aliceSignedIn ? aliceList.handler(request) : listOf(BOB_ONLY)),
      'POST /auth/sign-in/email': () => ({ token: 't' }),
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await aliceList.started()

    await logout(page, 'alice')
    await expect.poll(() => path(page)).toBe('/login')
    aliceSignedIn = false
    await login(page, 'bob')
    await expect.poll(() => path(page)).toBe('/')
    await page.getByRole('link', { name: /Categories/ }).first().click()
    await categoryItem(page, 'Bob-only menu').waitFor()

    aliceList.release(listOf(ALICE_ONLY))
    await page.waitForTimeout(500)
    expect(await page.getByText('Alice-only draft').count()).toBe(0)
    await categoryItem(page, 'Bob-only menu').waitFor()
    expect(api.unhandled).toEqual([])
  })
})
