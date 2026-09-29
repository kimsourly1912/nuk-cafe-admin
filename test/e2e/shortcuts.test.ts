import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { categoryItem, mockApi, setupE2e } from './support/mock-api'

// composables/useShortcuts.ts. Cases: docs/reference/app-behavior.md → "Keyboard shortcuts".
await setupE2e()

async function openCategories() {
  const page = await createPage()
  const api = await mockApi(page)
  await page.goto(url('/admin/categories'), { waitUntil: 'hydration' })
  await categoryItem(page, 'Tea').waitFor()
  return { page, api }
}

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search categories…' })
const form = (page: Page) => page.getByRole('dialog', { name: 'New category' })
const creates = (calls: string[]) => calls.filter(c => c === 'POST /admin/menu/categories').length

describe('keyboard shortcuts', () => {
  it('/ focuses the search without typing a slash', async () => {
    const { page } = await openCategories()
    await page.keyboard.press('/')
    await expect.poll(() => search(page).evaluate(el => el === document.activeElement)).toBe(true)
    await expect(search(page).inputValue()).resolves.toBe('')
  })

  it('n opens a new form', async () => {
    const { page } = await openCategories()
    await page.keyboard.press('n')
    await form(page).waitFor()
  })

  it('n does nothing behind an open dialog (an edit form stays an edit form)', async () => {
    const { page } = await openCategories()
    await page.getByRole('button', { name: 'Actions for Tea' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit category' })
    await edit.waitFor()
    // Focus a button in the form (not the input, where "n" is just typed).
    await edit.getByRole('button', { name: 'Cancel' }).focus()
    await page.keyboard.press('n')
    await page.waitForTimeout(300)
    expect(await edit.isVisible()).toBe(true)
    expect(await form(page).count()).toBe(0)
  })

  it('does not fire while typing in an input', async () => {
    const { page } = await openCategories()
    await search(page).fill('')
    await search(page).press('n')
    await page.waitForTimeout(300)
    expect(await form(page).count()).toBe(0)
    await expect(search(page).inputValue()).resolves.toBe('n')
  })

  it('Ctrl+Enter saves the open form, even while typing in it', async () => {
    const { page, api } = await openCategories()
    await page.keyboard.press('n')
    await form(page).locator('input').first().fill('Latte')
    await page.keyboard.press('Control+Enter')
    await form(page).waitFor({ state: 'hidden' })
    expect(creates(api.calls)).toBe(1)
  })

  it('Ctrl+Enter does nothing while "Discard unsaved changes?" is on top', async () => {
    const { page, api } = await openCategories()
    await page.keyboard.press('n')
    await form(page).locator('input').first().fill('Latte')
    await page.keyboard.press('Escape')
    await page.getByText('Discard unsaved changes?').waitFor()
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(300)
    expect(creates(api.calls)).toBe(0)
  })

  it('Ctrl+Enter runs the form validation (no request for an empty name)', async () => {
    const { page, api } = await openCategories()
    await page.keyboard.press('n')
    await form(page).waitFor()
    await page.keyboard.press('Control+Enter')
    await page.getByText('Name is required').waitFor()
    expect(creates(api.calls)).toBe(0)
  })

  it('? opens the shortcut list', async () => {
    const { page } = await openCategories()
    await page.keyboard.press('Shift+?')
    await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
    await page.getByText('Save the open form').waitFor()
  })
})
