import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { failures, menuItemOf, menuItemSummaryOf, mockApi, pageOf, setupE2e } from './support/mock-api'

// The admin's search (Ctrl/⌘+K, D152): menu items from the server's search, the small libraries,
// the pages and a few actions. Cases: docs/reference/app-behavior.md → "Keyboard shortcuts".
await setupE2e()

const LATTE = menuItemSummaryOf('item-1', 'Latte', { categoryName: 'Coffee', status: 'active' })

async function open(handlers: Record<string, MockHandler> = {}) {
  const page = await createPage()
  const searches: string[] = []
  await mockApi(page, {
    'GET /admin/menu/items': ({ url: address }) => {
      const term = address.searchParams.get('search') ?? ''
      searches.push(term)
      return pageOf('latte'.includes(term.toLowerCase()) ? [LATTE] : [])
    },
    'GET /admin/menu/items/{id}': () => menuItemOf('item-1', 'Latte'),
    ...handlers,
  })
  await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
  return { page, searches }
}

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' })

async function search(page: Page, text: string) {
  await page.keyboard.press('ControlOrMeta+k')
  await palette(page).getByRole('textbox').fill(text)
}

describe('the admin search', () => {
  it('Ctrl/⌘+K finds a menu item with the server\'s search and opens its editor', async () => {
    const { page, searches } = await open()
    await search(page, 'lat')
    const option = palette(page).getByRole('option', { name: /Latte/ })
    await option.waitFor()
    await option.getByText('Coffee · Published').waitFor()
    // Typing settles before one search is sent.
    expect(searches).toEqual(['lat'])
    await option.click()
    await page.waitForURL(address => address.pathname === '/c/nuk/admin/products/item-1')
    await palette(page).waitFor({ state: 'hidden' })
  })

  it('finds categories and pages too; a page opens inside the cafe', async () => {
    const { page } = await open()
    await search(page, 'tea')
    await palette(page).getByRole('group', { name: 'Categories' }).getByRole('option', { name: /Tea/ }).waitFor()
    await palette(page).getByRole('textbox').fill('categ')
    await palette(page).getByRole('group', { name: 'Go to' }).getByRole('option', { name: 'Categories' }).click()
    await page.waitForURL(address => address.pathname === '/c/nuk/admin/categories')
  })

  it('one source failing says so; the others still answer', async () => {
    const { page } = await open({
      'GET /admin/menu/categories': () => {
        throw failures.server()
      },
    })
    await search(page, 'latte')
    await palette(page).getByRole('option', { name: /Latte/ }).waitFor()
    await palette(page).getByText('Couldn\'t search categories. Try again.').waitFor()
  })

  it('opens from the sidebar\'s Search button, with the actions first when nothing is typed', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: /Search/ }).first().click()
    await palette(page).getByRole('option', { name: 'New menu item' }).click()
    await page.waitForURL(address => address.pathname === '/c/nuk/admin/products/new')
  })
})
