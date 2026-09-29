import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { mockApi, setupE2e } from './support/mock-api'
import { CLOSED_BRANCH, menuOf, shopHandlers, TABLE_TOKEN } from './support/shop-fixtures'

await setupE2e()

// The customer menu, the site's home page (step 5.3a, D93).

async function open(width = 1440, handlers: Record<string, MockHandler> = shopHandlers(), path = '/') {
  const page = await createPage()
  page.setDefaultTimeout(5000)
  await page.setViewportSize({ width, height: width < 640 ? 844 : 900 })
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  await heading(page, 'Coffee').waitFor()
  return { page, api }
}

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true })
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Categories' }).getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Your order' })
const dialog = (page: Page) => page.getByRole('dialog')

/** The heading is on screen, not under the sticky header. */
async function inViewBelowHeader(page: Page, name: string) {
  const header = (await page.locator('header').boundingBox())!
  const box = (await heading(page, name).boundingBox())!
  const below = header.y + header.height
  const viewport = page.viewportSize()!
  return box.y >= below - 1 && box.y + box.height <= viewport.height
}

describe('the customer menu', () => {
  it('is the home page: sections by category, sub-sections, and no admin session read', async () => {
    const { page, api } = await open()
    await expect.poll(() => page.title()).toBe('Menu · NUK Cafe')
    await heading(page, 'Hot · 4 items').waitFor()
    await heading(page, 'Tea').waitFor()
    expect(await card(page, 'Latte').getByText('from $4.50').isVisible()).toBe(true)
    expect(api.calls).not.toContain('GET /admin/me')
    expect(api.calls).toContain('GET /public/branches')
  })

  it('moves the tabs with the scroll, and scrolls to the category a tab names', async () => {
    const { page } = await open()
    expect(await tab(page, 'Coffee').getAttribute('aria-current')).toBe('true')
    await tab(page, 'Tea').click()
    await expect.poll(() => tab(page, 'Tea').getAttribute('aria-current')).toBe('true')
    // In view below the sticky header (a section near the end may not reach the top).
    await expect.poll(() => inViewBelowHeader(page, 'Tea')).toBe(true)
    // Scrolling by hand takes over again.
    await page.mouse.wheel(0, -5000)
    await expect.poll(() => tab(page, 'Coffee').getAttribute('aria-current')).toBe('true')
  })

  it('"All categories" shows the tree with the active category expanded, and goes to a sub-category', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'All categories' }).click()
    const tree = page.getByRole('list', { name: 'All categories' })
    await tree.getByRole('button', { name: /^Iced/ }).click()
    await expect.poll(() => tree.isVisible()).toBe(false)
    await expect.poll(() => inViewBelowHeader(page, 'Iced · 2 items')).toBe(true)
    await page.getByRole('button', { name: 'All categories' }).click()
    expect(await tree.getByRole('button', { name: /^Iced/ }).getAttribute('aria-current')).toBe('true')
    // Coffee's chevron hides its sub-categories.
    await tree.getByRole('button', { name: 'Hide Coffee sub-categories' }).click()
    await expect.poll(() => tree.getByRole('button', { name: /^Iced/ }).count()).toBe(0)
  })

  it('adds an item with nothing to choose in one tap; the slot becomes a stepper; the panel totals it', async () => {
    const { page } = await open()
    expect(await panel(page).getByText('Your order is empty').isVisible()).toBe(true)
    await card(page, 'Americano').getByRole('button', { name: 'Add Americano to order' }).click()
    const stepper = card(page, 'Americano').getByRole('spinbutton', { name: 'Quantity of Americano' })
    await expect.poll(() => stepper.inputValue()).toBe('1')
    await card(page, 'Americano').getByRole('button', { name: 'Increment' }).click()
    await expect.poll(() => panel(page).getByText('$7.00').count()).toBeGreaterThan(0)
    // Back to 0 removes it: the slot is a button again.
    await card(page, 'Americano').getByRole('button', { name: 'Decrement' }).click()
    await card(page, 'Americano').getByRole('button', { name: 'Decrement' }).click()
    await card(page, 'Americano').getByRole('button', { name: 'Add Americano to order' }).waitFor()
    expect(await panel(page).getByText('Your order is empty').isVisible()).toBe(true)
  })

  it('opens the detail for an item with choices: says what\'s missing, prices the choice, then "2 in order"', async () => {
    const { page } = await open()
    await card(page, 'Latte').getByRole('button', { name: 'Add Latte to order' }).click()
    await dialog(page).getByRole('radio', { name: /Medium/ }).click()
    // Large is sold out: not offered.
    expect(await dialog(page).getByRole('radio', { name: /Large/ }).isDisabled()).toBe(true)
    const add = dialog(page).getByRole('button', { name: 'Choose Milk' })
    await add.click()
    await dialog(page).getByText('Choose 1 more.').waitFor()
    await dialog(page).getByRole('radio', { name: /Oat/ }).click()
    await dialog(page).getByRole('checkbox', { name: /Extra shot/ }).click()
    await dialog(page).getByRole('button', { name: 'Increment' }).click()
    // Medium $5.00 + Oat $0.50 + Extra shot $0.50 = $6.00, two of them.
    await dialog(page).getByRole('button', { name: 'Add to order · $12.00' }).click()
    await expect.poll(() => dialog(page).count()).toBe(0)
    await card(page, 'Latte').getByText('2 in order').waitFor()
    expect(await panel(page).getByText('Medium · Oat, Extra shot').isVisible()).toBe(true)
    await card(page, 'Latte').getByRole('button', { name: 'Add another Latte' }).click()
    await dialog(page).getByRole('button', { name: 'Choose Milk' }).waitFor()
  })

  it('keeps add-on limits: a third extra can\'t be picked', async () => {
    const { page } = await open()
    await card(page, 'Latte').getByRole('button', { name: 'Latte', exact: true }).click()
    await dialog(page).getByRole('checkbox', { name: /Extra shot/ }).click()
    await dialog(page).getByRole('checkbox', { name: /Vanilla syrup/ }).click()
    expect(await dialog(page).getByRole('checkbox', { name: /Whipped cream/ }).isDisabled()).toBe(true)
  })

  it('shows a sold-out item as sold out, not orderable', async () => {
    const { page } = await open()
    expect(await card(page, 'Mocha').getByRole('button', { name: 'Sold out' }).isDisabled()).toBe(true)
  })

  it('keeps the order across a reload, per branch', async () => {
    const { page } = await open()
    await card(page, 'Croissant').getByRole('button', { name: 'Add Croissant to order' }).click()
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await expect.poll(() => card(page, 'Croissant').getByRole('spinbutton').inputValue()).toBe('1')
  })

  it('while closed: one warning with when it opens, browsing works, adding doesn\'t', async () => {
    const { page } = await open(1440, shopHandlers(menuOf(CLOSED_BRANCH)))
    await page.getByText('Opens today at 7:00 AM').first().waitFor()
    expect(await page.getByText('Closed now', { exact: true }).count()).toBe(1)
    expect(await card(page, 'Americano').getByRole('button', { name: 'Add Americano to order' }).isDisabled()).toBe(true)
    await card(page, 'Latte').getByRole('button', { name: 'Latte', exact: true }).click()
    expect(await dialog(page).getByRole('button', { name: 'Closed now' }).isDisabled()).toBe(true)
  })

  it('searches by name or description, grouped by place, with the same cards; nothing found says so', async () => {
    const { page } = await open()
    await page.getByRole('searchbox', { name: 'Search the menu' }).fill('latte')
    await page.getByText('3 results for "latte"').waitFor()
    expect(await page.getByRole('heading', { name: 'Coffee → Iced' }).isVisible()).toBe(true)
    expect(await tab(page, 'Coffee').count()).toBe(0)
    await card(page, 'Matcha latte').getByRole('button', { name: 'Add Matcha latte to order' }).click()
    await page.getByRole('searchbox', { name: 'Search the menu' }).fill('lattte')
    await page.getByText('No items match "lattte"').waitFor()
    await page.getByRole('button', { name: 'Clear search' }).last().click()
    await tab(page, 'Coffee').waitFor()
  })
})

describe('the customer menu on a phone', () => {
  it('rows with "Add"; the order bar appears after the first add and opens the order', async () => {
    const { page } = await open(390)
    expect(await page.getByRole('toolbar', { name: 'Your order' }).count()).toBe(0)
    expect(await panel(page).count()).toBe(0)
    await card(page, 'Americano').getByRole('button', { name: 'Add Americano to order' }).click()
    const bar = page.getByRole('toolbar', { name: 'Your order' })
    await bar.getByText('1 item').waitFor()
    await bar.getByRole('button', { name: 'View order' }).click()
    await dialog(page).getByText('Americano').waitFor()
    expect(await dialog(page).getByText('$3.50').count()).toBeGreaterThan(0)
  })

  it('the icon button opens the categories sheet; choosing closes it and scrolls there', async () => {
    const { page } = await open(390)
    await page.getByRole('button', { name: 'All categories' }).click()
    await dialog(page).getByRole('button', { name: /^Bakery/ }).click()
    await expect.poll(() => dialog(page).count()).toBe(0)
    await expect.poll(() => tab(page, 'Bakery').getAttribute('aria-current')).toBe('true')
  })

  it('search takes over the header, Back leaves it', async () => {
    const { page } = await open(390)
    await page.getByRole('button', { name: 'Search the menu' }).click()
    await page.getByRole('searchbox', { name: 'Search the menu' }).fill('tea')
    await page.getByText(/results? for "tea"/).waitFor()
    await page.getByRole('button', { name: 'Close search' }).click()
    await tab(page, 'Coffee').waitFor()
  })
})

describe('table QR codes', () => {
  it('a scanned table orders for that table, until switched to pickup', async () => {
    const { page } = await open(1440, shopHandlers(), `/table/${TABLE_TOKEN}`)
    expect(new URL(page.url()).pathname).toBe('/')
    const orderType = page.getByRole('button', { name: 'Order type: Table 12' })
    await orderType.click()
    await page.getByRole('button', { name: 'Switch to pickup' }).click()
    await page.getByRole('button', { name: 'Order type: Pickup' }).waitFor()
  })

  it('a QR code that doesn\'t work says so and offers pickup', async () => {
    const page = await createPage()
    await mockApi(page, shopHandlers())
    await page.goto(url('/table/Zz9zZz9zZz9zZz9zZz9zZz'), { waitUntil: 'hydration' })
    await page.getByText('This table\'s QR code doesn\'t work').waitFor()
    await page.getByRole('link', { name: 'Order for pickup' }).click()
    await heading(page, 'Coffee').waitFor()
    expect(await page.getByRole('button', { name: 'Order type: Pickup' }).isVisible()).toBe(true)
  })
})
