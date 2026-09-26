import type { Page } from 'playwright-core'
import { createPage } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { beforeUnloadPrevented, categoryOf, deferred, failures, gotoViaSidebar, mockApi, setupE2e, toast } from './support/mock-api'

// The cases listed in docs/reference/forms.md → "Edge cases", on the Categories form modal.
await setupE2e()

const DISCARD_TITLE = 'Discard unsaved changes?'

async function openCategories() {
  const page = await createPage()
  const api = await mockApi(page)
  // In-app history: / → /categories → / → /categories, so back/forward stay inside the SPA.
  await gotoViaSidebar(page, [/Categories/, /Dashboard/, /Categories/])
  return { page, api }
}

const form = (page: Page) => page.getByRole('dialog', { name: /New category|Edit category/ })
const nameInput = (page: Page) => form(page).locator('input').first()
const discardDialog = (page: Page) => page.getByText(DISCARD_TITLE)

async function openNewForm(page: Page, name?: string) {
  await page.getByRole('button', { name: 'New category' }).click()
  await form(page).waitFor()
  if (name !== undefined) await nameInput(page).fill(name)
}

async function answer(page: Page, label: 'Keep editing' | 'Discard') {
  await page.getByRole('button', { name: label }).click()
  await discardDialog(page).waitFor({ state: 'hidden' })
}

describe('unsaved changes: form modal', () => {
  it('closes a clean form without asking', async () => {
    const { page } = await openCategories()
    await openNewForm(page)
    await page.keyboard.press('Escape')
    await form(page).waitFor({ state: 'hidden' })
    expect(await discardDialog(page).count()).toBe(0)
  })

  it('asks on Esc, X, outside click and Cancel; Keep editing keeps the input', async () => {
    const { page } = await openCategories()
    await openNewForm(page, 'Latte')

    const closers: [string, () => Promise<void>][] = [
      ['Esc', () => page.keyboard.press('Escape')],
      ['X', () => form(page).getByRole('button', { name: /close/i }).first().click()],
      ['outside click', () => page.mouse.click(5, 5)],
      ['Cancel', () => page.getByRole('button', { name: 'Cancel' }).click()],
    ]
    for (const [, close] of closers) {
      await close()
      await discardDialog(page).waitFor()
      await answer(page, 'Keep editing')
      await expect(form(page).isVisible()).resolves.toBe(true)
      await expect(nameInput(page).inputValue()).resolves.toBe('Latte')
    }

    await page.getByRole('button', { name: 'Cancel' }).click()
    await answer(page, 'Discard')
    await form(page).waitFor({ state: 'hidden' })
  })

  it('does not count typing that was undone', async () => {
    const { page } = await openCategories()
    await openNewForm(page, 'Latte')
    await nameInput(page).fill('')
    expect(await beforeUnloadPrevented(page)).toBe(false)
    await page.keyboard.press('Escape')
    await form(page).waitFor({ state: 'hidden' })
    expect(await discardDialog(page).count()).toBe(0)
  })

  it('opens an edit form clean', async () => {
    const { page } = await openCategories()
    await page.getByRole('button', { name: 'Actions for Tea' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await form(page).waitFor()
    await expect(nameInput(page).inputValue()).resolves.toBe('Tea')
    expect(await beforeUnloadPrevented(page)).toBe(false)
    await page.keyboard.press('Escape')
    await form(page).waitFor({ state: 'hidden' })
  })

  it('closes after a successful save without asking', async () => {
    const { page } = await openCategories()
    await openNewForm(page, 'Latte')
    await page.getByRole('button', { name: 'Create' }).click()
    await form(page).waitFor({ state: 'hidden' })
    expect(await discardDialog(page).count()).toBe(0)
    expect(await beforeUnloadPrevented(page)).toBe(false)
  })

  it('closes mid-save without asking; the tab-close guard stays on until the save ends', async () => {
    const { page, api } = await openCategories()
    const save = deferred()
    api.set({ 'POST /admin/categories': save.handler })

    await openNewForm(page, 'Latte')
    await page.getByRole('button', { name: 'Create' }).click()
    await page.getByText('saving continues in the background').waitFor()
    await page.keyboard.press('Escape')
    await form(page).waitFor({ state: 'hidden' })
    expect(await discardDialog(page).count()).toBe(0)
    expect(await beforeUnloadPrevented(page)).toBe(true)

    save.release(categoryOf('cat-3', 'Latte'))
    await expect.poll(() => beforeUnloadPrevented(page)).toBe(false)
  })
})

describe('unsaved changes: leaving the page', () => {
  it('warns on tab close/reload only while something is unsaved', async () => {
    const { page } = await openCategories()
    expect(await beforeUnloadPrevented(page)).toBe(false)
    await openNewForm(page, 'Latte')
    expect(await beforeUnloadPrevented(page)).toBe(true)
  })

  it('asks on back; Keep editing stays with the form open', async () => {
    const { page } = await openCategories()
    await openNewForm(page, 'Latte')
    await page.goBack()
    await discardDialog(page).waitFor()
    await answer(page, 'Keep editing')
    await expect.poll(() => page.url()).toMatch(/\/categories$/)
    await expect(nameInput(page).inputValue()).resolves.toBe('Latte')
  })

  it('back + Discard leaves the page and closes the modal', async () => {
    const { page } = await openCategories()
    await openNewForm(page, 'Latte')
    await page.goBack()
    await answer(page, 'Discard')
    await expect.poll(() => page.url()).not.toMatch(/\/categories$/)
    await form(page).waitFor({ state: 'hidden' })
    expect(await beforeUnloadPrevented(page)).toBe(false)
  })

  it('shows one dialog when back is pressed twice', async () => {
    const { page } = await openCategories()
    await openNewForm(page, 'Latte')
    await page.goBack()
    await discardDialog(page).waitFor()
    await page.goBack()
    await page.waitForTimeout(300)
    expect(await discardDialog(page).count()).toBe(1)
    await answer(page, 'Discard')
    await form(page).waitFor({ state: 'hidden' })
  })

  it('does not block navigation when nothing is unsaved', async () => {
    const { page } = await openCategories()
    await page.getByRole('link', { name: /Dashboard/ }).first().click()
    await expect.poll(() => page.url()).not.toMatch(/\/categories$/)
    expect(await discardDialog(page).count()).toBe(0)
  })
})

describe('unsaved changes: failed saves and forward', () => {
  it('a failed save keeps the form open with the input and the reason, and still guards it', async () => {
    const { page, api } = await openCategories()
    api.set({
      'POST /admin/categories': () => {
        throw failures.validation('A category named "Latte" already exists')
      },
    })
    await openNewForm(page, 'Latte')
    await form(page).getByRole('button', { name: 'Create' }).click()

    await toast(page, 'Could not create "Latte"').waitFor()
    await page.getByText('A category named "Latte" already exists').first().waitFor()
    expect(await form(page).isVisible()).toBe(true)
    await expect(nameInput(page).inputValue()).resolves.toBe('Latte')
    expect(await beforeUnloadPrevented(page)).toBe(true)

    // Retrying is allowed after the failure (no stuck "in flight" state).
    await form(page).getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => api.calls.filter(c => c === 'POST /admin/categories').length).toBe(2)
  })

  it('asks on browser forward; Keep editing stays on the page', async () => {
    const { page } = await openCategories()
    // History: / → /categories → / → /categories. Go back twice, then forward is available.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/categories')
    await page.goBack()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/')
    await page.goBack()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/categories')
    await openNewForm(page, 'Latte')

    await page.goForward()
    await discardDialog(page).waitFor()
    await answer(page, 'Keep editing')
    await expect.poll(() => new URL(page.url()).pathname).toBe('/categories')
    await expect(nameInput(page).inputValue()).resolves.toBe('Latte')
  })
})
