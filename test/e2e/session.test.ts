import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { beforeUnloadPrevented, deferred, failures, gotoHydrated, mockApi, openTabs, setupE2e, TEA, toast } from './support/mock-api'

// The session-transition contract (plugins/session-boundary.client.ts, useAuth generation,
// createApiFetch). Cases: docs/reference/app-behavior.md → "Session loss".
await setupE2e()

const ALICE = { staffId: 1, username: 'alice', groups: ['ADMIN'] }
const BOB = { staffId: 2, username: 'bob', groups: ['ADMIN'] }
const ALICE_ONLY = { id: 11, categoryName: 'Alice-only draft', status: 'ACTIVE', type: 'MAIN' }
const BOB_ONLY = { id: 12, categoryName: 'Bob-only menu', status: 'ACTIVE', type: 'MAIN' }
const listOf = (...rows: object[]) => ({ content: rows, totalElements: rows.length, totalPages: 1, currentPage: 0, pageSize: 20, hasNext: false, hasPrevious: false })

const form = (page: Page) => page.getByRole('dialog', { name: /New category|Edit category/ })
const discardDialog = (page: Page) => page.getByText('Discard unsaved changes?')
const path = (page: Page) => new URL(page.url()).pathname

async function openNewForm(page: Page, name: string) {
  await page.getByRole('button', { name: 'New category' }).first().click()
  await form(page).locator('input').first().fill(name)
}

async function logout(page: Page, username: string) {
  await page.getByRole('button', { name: username }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
}

async function login(page: Page, username: string) {
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('secret')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

describe('session expiry', () => {
  it('expiring during a save goes to login: no discard dialog, no form left over, no error toast', async () => {
    const page = await createPage()
    await mockApi(page, {
      'POST /staff/categories': () => {
        throw failures.unauthorized()
      },
      'POST /staff/auth/refresh': () => {
        throw failures.unauthorized()
      },
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByRole('cell', { name: 'Tea' }).waitFor()
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

  it('a request that is still unauthorized after a successful refresh expires the session once', async () => {
    const page = await createPage()
    const api = await mockApi(page, {
      'GET /staff/categories': () => {
        throw failures.unauthorized()
      },
      'POST /staff/auth/refresh': () => null,
    })
    await page.goto(url('/categories'))
    await expect.poll(() => path(page)).toBe('/login')
    await page.waitForTimeout(500)
    expect(api.calls.filter(c => c === 'POST /staff/auth/refresh')).toHaveLength(1)
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

    await logout(tab1!, 'admin')

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
      'GET /staff/auth/session': () => ALICE,
      'GET /staff/categories': () => listOf(TEA, ALICE_ONLY),
      'PUT /staff/categories/{id}': aliceSave.handler,
      'DELETE /staff/categories/{id}': () => {
        throw failures.validation('Alice cannot delete this')
      },
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByRole('cell', { name: 'Alice-only draft' }).waitFor()

    // Alice leaves a batch result with "Retry failed" (it stays 10 s) and a save in flight.
    await page.getByRole('checkbox', { name: 'Select row' }).nth(1).click()
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, '0 categories deleted, 1 failed').waitFor()
    await page.getByRole('button', { name: 'Actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await form(page).locator('input').first().fill('Tea by Alice')
    await form(page).getByRole('button', { name: 'Save' }).click()
    await aliceSave.started()
    // The button, not Escape: Escape would also dismiss the toast this test is about.
    await form(page).getByRole('button', { name: 'Close' }).first().click()
    await form(page).waitFor({ state: 'hidden' })

    expect(await toast(page, '0 categories deleted, 1 failed').count()).toBe(1)
    await logout(page, 'alice')
    await expect.poll(() => path(page)).toBe('/login')
    expect(await toast(page, '0 categories deleted, 1 failed').count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Retry failed' }).count()).toBe(0)

    // Bob signs in; the backend now answers as Bob.
    api.set({
      'POST /staff/auth/login': () => BOB,
      'GET /staff/auth/session': () => BOB,
      'GET /staff/categories': () => listOf(BOB_ONLY),
    })
    await login(page, 'bob')
    await expect.poll(() => path(page)).toBe('/')
    await page.getByRole('link', { name: /Categories/ }).first().click()
    await page.getByRole('cell', { name: 'Bob-only menu' }).waitFor()

    // Alice's save finally answers: it must not toast or refresh anything in Bob's session.
    const loadsBefore = api.calls.filter(c => c === 'GET /staff/categories').length
    aliceSave.release({ ...TEA, categoryName: 'Tea by Alice' })
    await page.waitForTimeout(500)
    expect(await toast(page, /updated/).count()).toBe(0)
    expect(api.calls.filter(c => c === 'GET /staff/categories').length).toBe(loadsBefore)
    expect(await page.getByText('Alice-only draft').count()).toBe(0)
  })

  it('a list response for the previous user that arrives late never shows', async () => {
    const page = await createPage()
    const aliceList = deferred()
    let aliceSignedIn = true
    const api = await mockApi(page, {
      'GET /staff/auth/session': () => (aliceSignedIn ? ALICE : BOB),
      'GET /staff/categories': request => (aliceSignedIn ? aliceList.handler(request) : listOf(BOB_ONLY)),
      'POST /staff/auth/login': () => BOB,
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await aliceList.started()

    await logout(page, 'alice')
    await expect.poll(() => path(page)).toBe('/login')
    aliceSignedIn = false
    await login(page, 'bob')
    await expect.poll(() => path(page)).toBe('/')
    await page.getByRole('link', { name: /Categories/ }).first().click()
    await page.getByRole('cell', { name: 'Bob-only menu' }).waitFor()

    aliceList.release(listOf(ALICE_ONLY))
    await page.waitForTimeout(500)
    expect(await page.getByText('Alice-only draft').count()).toBe(0)
    await page.getByRole('cell', { name: 'Bob-only menu' }).waitFor()
    expect(api.unhandled).toEqual([])
  })
})
