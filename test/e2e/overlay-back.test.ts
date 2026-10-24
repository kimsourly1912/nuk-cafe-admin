import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { gotoViaSidebar, mockApi, setupE2e } from './support/mock-api'

// Back closes the overlay on top and stays on the page (D201, ui.md → Overlays): a phone's Back
// button or edge swipe is a history back, which `page.goBack()` is too.
await setupE2e()

const CATEGORIES = '/c/nuk/admin/categories'
const OVERVIEW = '/c/nuk/admin'

async function openCategories() {
  const page = await createPage()
  await mockApi(page)
  // In-app history: /admin → /admin/categories, so Back from the page stays inside the app.
  await gotoViaSidebar(page, [/Categories/])
  return page
}

const path = (page: Page) => new URL(page.url()).pathname
const form = (page: Page) => page.getByRole('dialog', { name: 'New category' })
const nameInput = (page: Page) => form(page).locator('input').first()
const discardDialog = (page: Page) => page.getByRole('dialog', { name: 'Discard unsaved changes?' })

async function openNewForm(page: Page, name?: string) {
  await page.getByRole('button', { name: 'New category' }).click()
  await form(page).waitFor()
  if (name !== undefined) await nameInput(page).fill(name)
}

describe('Back closes the overlay on top (D201)', () => {
  it('closes a modal and stays on the page; the next Back leaves it', async () => {
    const page = await openCategories()
    await openNewForm(page)
    await page.goBack()
    await form(page).waitFor({ state: 'hidden' })
    expect(path(page)).toBe(CATEGORIES)

    await page.goBack()
    await expect.poll(() => path(page)).toBe(OVERVIEW)
  })

  it('a modal closed another way leaves no entry behind: one Back leaves the page', async () => {
    const page = await openCategories()
    for (let opened = 0; opened < 3; opened++) {
      await openNewForm(page)
      await page.keyboard.press('Escape')
      await form(page).waitFor({ state: 'hidden' })
    }
    await page.goBack()
    await expect.poll(() => path(page)).toBe(OVERVIEW)
  })

  it('unsaved input asks first: Keep editing keeps the form, and Back still asks', async () => {
    const page = await openCategories()
    await openNewForm(page, 'Latte')
    await page.goBack()
    await discardDialog(page).waitFor()
    await discardDialog(page).getByRole('button', { name: 'Keep editing' }).click()
    await discardDialog(page).waitFor({ state: 'hidden' })
    await expect(nameInput(page).inputValue()).resolves.toBe('Latte')
    expect(path(page)).toBe(CATEGORIES)

    await page.goBack()
    await discardDialog(page).getByRole('button', { name: 'Discard' }).click()
    await form(page).waitFor({ state: 'hidden' })
    expect(path(page)).toBe(CATEGORIES)
  })

  it('Back on the question is Keep editing', async () => {
    const page = await openCategories()
    await openNewForm(page, 'Latte')
    await page.goBack()
    await discardDialog(page).waitFor()
    await page.goBack()
    await discardDialog(page).waitFor({ state: 'hidden' })
    await expect(nameInput(page).inputValue()).resolves.toBe('Latte')
    expect(path(page)).toBe(CATEGORIES)
  })

  it('leaving the page from an overlay keeps the history in order', async () => {
    const page = await openCategories()
    // The search palette (Nuxt UI's own modal) opens a page: its entry goes before the new page's.
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Search' })
    await palette.getByRole('textbox').fill('overv')
    await palette.getByRole('group', { name: 'Go to' }).getByRole('option', { name: 'Overview' }).click()
    await expect.poll(() => path(page)).toBe(OVERVIEW)
    await palette.waitFor({ state: 'hidden' })

    await page.goBack()
    await expect.poll(() => path(page)).toBe(CATEGORIES)
    await page.goBack()
    await expect.poll(() => path(page)).toBe(OVERVIEW)
  })

  it('on a phone, Back closes the sidebar\'s menu (Nuxt UI\'s own slide-over)', async () => {
    const page = await openCategories()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    const menu = page.getByRole('dialog')
    await menu.waitFor()
    await page.goBack()
    await menu.waitFor({ state: 'hidden' })
    expect(path(page)).toBe(CATEGORIES)
  })

  it('on a phone, Back closes the customer menu\'s item sheet (a drawer)', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    const latte = page.getByRole('article', { name: 'Latte', exact: true })
    await latte.getByRole('button', { name: 'Customize Latte' }).filter({ visible: true }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('radio', { name: 'Large' }).waitFor()
    await page.goBack()
    await sheet.waitFor({ state: 'hidden' })
    expect(path(page)).toBe('/c/nuk')
  })

  it('a reload on an open overlay\'s entry: Back leaves the page at once', async () => {
    const page = await openCategories()
    await openNewForm(page)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'New category' }).waitFor()
    await expect.poll(() => page.evaluate(() => Boolean(window.history.state?.overlayEntry))).toBe(false)
    await page.goBack()
    await expect.poll(() => path(page)).toBe(OVERVIEW)
  })
})
