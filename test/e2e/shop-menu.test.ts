import type { Page } from 'playwright-core'
import { createPage, getBrowser, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { setupE2e } from './support/mock-api'

await setupE2e()

// The customer menu, server-rendered (D93, D95), against the e2e server's seeded database
// (support/seed.ts): the Standard sample menu (D94) at "Riverside" (open around the clock) and
// "Zeta Kiosk" (no hours: closed). No API mocks here: the server renders what the database holds.
// Items with a time rule (the croissants, Affogato) come and go with the clock: tests avoid them.

const seed = inject('shopSeed')

/** Opens a page; collects errors, and Vue's "Hydration completed but contains mismatches". */
async function open(width = 1440, path = '/') {
  const page = await createPage()
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration/i.test(message.text())) problems.push(`${message.text()} ${message.location().url}`)
  })
  page.on('pageerror', error => problems.push(error.message))
  await page.setViewportSize({ width, height: width < 640 ? 844 : 900 })
  await page.goto(url(path), { waitUntil: 'hydration' })
  await heading(page, 'Coffee').waitFor()
  return { page, problems }
}

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true })
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const visible = (locator: ReturnType<Page['getByRole']>) => locator.filter({ visible: true })
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Categories' }).getByRole('button', { name, exact: true })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Your order' })
const dialog = (page: Page) => page.getByRole('dialog')

/** Opens the menu with 12 different lines already in the order (stored as the browser keeps it). */
async function openWithLongOrder(width: number, height = width < 640 ? 844 : 900) {
  const menu = await (await fetch(url(`/api/public/menu?branchId=${seed.openBranchId}`))).json() as PublicMenu
  const items = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(sub => sub.items)]).filter(item => !item.soldOut).slice(0, 12)
  expect(items).toHaveLength(12)
  const lines = items.map(item => ({ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, name: item.name }))
  const page = await createPage()
  await page.addInitScript(([branch, stored]) => localStorage.setItem('nuk-cafe:cart', JSON.stringify({ [branch]: stored })), [seed.openBranchId, lines] as const)
  await page.setViewportSize({ width, height })
  await page.goto(url('/'), { waitUntil: 'hydration' })
  await heading(page, 'Coffee').waitFor()
  return page
}

/** Fully inside the window, top to bottom. */
async function onScreen(page: Page, locator: ReturnType<Page['getByRole']>) {
  const box = (await locator.boundingBox())!
  return box.y >= 0 && box.y + box.height <= page.viewportSize()!.height
}

/** The page doesn't scroll sideways. */
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** The heading is on screen, not under the sticky header. */
async function inViewBelowHeader(page: Page, name: string) {
  const header = (await page.locator('header').boundingBox())!
  const box = (await heading(page, name).boundingBox())!
  return box.y >= header.y + header.height - 1 && box.y + box.height <= page.viewportSize()!.height
}

describe('the customer menu, server-rendered', () => {
  it('sends the menu in the page itself: readable without JavaScript', async () => {
    const html = await (await fetch(url('/'))).text()
    expect(html).toContain('Khmer Iced Coffee')
    expect(html).toContain('<title>Menu · NUK Cafe</title>')
    expect(html).toMatch(/<meta name="description" content="Browse the NUK Cafe menu/)
    const context = await (await getBrowser()).newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(url('/'))
    await heading(page, 'Espresso Bar · 7 items').or(heading(page, 'Espresso Bar · 6 items')).first().waitFor()
    expect(await page.getByText('Salted Caramel Latte').first().isVisible()).toBe(true)
    await context.close()
  })

  it('loads none of the admin\'s calendar, date or time fields, even after opening a popover (D123)', async () => {
    const page = await createPage()
    const scripts: Promise<string>[] = []
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') scripts.push(response.text())
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(url('/'), { waitUntil: 'hydration' })
    // "All categories" is a popover: Reka UI's namespaced barrel used to bring the calendar with it.
    await visible(page.getByRole('button', { name: 'All categories' })).click()
    await page.getByRole('list', { name: 'All categories' }).waitFor()
    const code = (await Promise.all(scripts)).join('\n')
    expect(code.length).toBeGreaterThan(100_000)
    expect(['CalendarRoot', 'DateFieldRoot', 'TimeFieldRoot'].filter(part => code.includes(part))).toEqual([])
  })

  it('keeps the admin a browser-only app: its page carries no content', async () => {
    const html = await (await fetch(url('/admin/login'))).text()
    expect(html).not.toContain('Sign in')
    expect(html).not.toContain('Khmer Iced Coffee')
  })

  it('hydrates without mismatches, at desktop and phone width', async () => {
    for (const width of [1440, 390]) {
      const { page, problems } = await open(width)
      await card(page, 'Banana Bread').waitFor()
      expect(problems).toEqual([])
      await page.close()
    }
  })
})

describe('the customer menu', () => {
  it('moves the tabs with the scroll, and scrolls to the category a tab names', async () => {
    const { page } = await open()
    expect(await tab(page, 'Coffee').getAttribute('aria-current')).toBe('true')
    await tab(page, 'Tea').click()
    await expect.poll(() => tab(page, 'Tea').getAttribute('aria-current')).toBe('true')
    await expect.poll(() => inViewBelowHeader(page, 'Tea')).toBe(true)
    await page.mouse.wheel(0, -20_000)
    await expect.poll(() => tab(page, 'Coffee').getAttribute('aria-current')).toBe('true')
  })

  it('"All categories" goes to a sub-category and marks it', async () => {
    const { page } = await open()
    await visible(page.getByRole('button', { name: 'All categories' })).click()
    const tree = page.getByRole('list', { name: 'All categories' })
    await tree.getByRole('button', { name: 'Show Tea sub-categories' }).click()
    await tree.getByRole('button', { name: /^Milk Tea/ }).click()
    await expect.poll(() => tree.isVisible()).toBe(false)
    await expect.poll(() => tab(page, 'Tea').getAttribute('aria-current')).toBe('true')
    await visible(page.getByRole('button', { name: 'All categories' })).click()
    // The Tea tab is marked as soon as the scroll reaches Tea; Milk Tea only once its own section
    // does (the smooth scroll can still be moving under load): wait for it.
    await expect.poll(() => tree.getByRole('button', { name: /^Milk Tea/ }).getAttribute('aria-current')).toBe('true')
  })

  it('adds an item with nothing to choose in one tap; the slot becomes a stepper; the panel totals it', async () => {
    const { page } = await open()
    const bread = card(page, 'Banana Bread')
    await visible(bread.getByRole('button', { name: 'Add Banana Bread to order' })).click()
    await visible(bread.getByRole('button', { name: 'Increase quantity of Banana Bread' })).click()
    await panel(page).getByText('$4.50').first().waitFor()
    await visible(bread.getByRole('button', { name: 'Decrease quantity of Banana Bread' })).click()
    await visible(bread.getByRole('button', { name: 'Decrease quantity of Banana Bread' })).click()
    await visible(bread.getByRole('button', { name: 'Add Banana Bread to order' })).waitFor()
    await panel(page).getByText('Your order is empty').waitFor()
  })

  it('opens the detail for an item with choices: says what\'s missing, prices the choice, then "2 in order"', async () => {
    const { page } = await open()
    const latte = card(page, 'Latte')
    await visible(latte.getByRole('button', { name: 'Customize Latte' })).click()
    await dialog(page).getByRole('radio', { name: 'Large' }).click()
    await dialog(page).getByRole('radio', { name: 'Iced' }).click()
    await dialog(page).getByRole('button', { name: 'Choose Milk' }).click()
    await dialog(page).getByText('Choose 1 more.').waitFor()
    await dialog(page).getByRole('radio', { name: /Oat milk/ }).click()
    await dialog(page).getByRole('checkbox', { name: /Extra shot/ }).click()
    await dialog(page).getByRole('button', { name: 'Increase quantity of Latte' }).click()
    // Latte $2.50 + Large $0.50 + Iced $0.25 + Oat milk $0.50 + Extra shot $0.50 = $4.25, two of them.
    await dialog(page).getByRole('button', { name: 'Add to order · $8.50' }).click()
    await expect.poll(() => dialog(page).count()).toBe(0)
    await visible(latte.getByText('2 in order')).waitFor()
    await panel(page).getByText('Large, Iced · Oat milk, Extra shot').waitFor()
  })

  it('keeps add-on limits: a third syrup can\'t be picked', async () => {
    const { page } = await open()
    await card(page, 'Latte').getByRole('button', { name: 'Latte', exact: true }).click()
    await dialog(page).getByRole('checkbox', { name: 'Vanilla' }).click()
    await dialog(page).getByRole('checkbox', { name: 'Caramel' }).click()
    expect(await dialog(page).getByRole('checkbox', { name: 'Hazelnut' }).isDisabled()).toBe(true)
  })

  it('shows a sold-out item as sold out, not orderable', async () => {
    const { page } = await open()
    expect(await visible(card(page, 'Cheese Foam Cold Brew').getByRole('button', { name: 'Sold out' })).isDisabled()).toBe(true)
  })

  it('keeps the order across a reload, after the page has hydrated', async () => {
    const { page, problems } = await open()
    await visible(card(page, 'Banana Bread').getByRole('button', { name: 'Add Banana Bread to order' })).click()
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await expect.poll(() => visible(card(page, 'Banana Bread').getByRole('textbox', { name: 'Quantity of Banana Bread' })).inputValue()).toBe('1')
    expect(problems).toEqual([])
  })

  it('searches by name or description, grouped by place, with the same cards; nothing found says so', async () => {
    const { page } = await open()
    const search = page.getByRole('searchbox', { name: 'Search the menu' })
    await search.fill('latte')
    await page.getByText(/results for "latte"/).waitFor()
    await page.getByRole('heading', { name: 'Tea → Milk Tea' }).waitFor()
    expect(await tab(page, 'Coffee').count()).toBe(0)
    await search.fill('lattte')
    await page.getByText('No items match "lattte"').waitFor()
    await page.getByRole('button', { name: 'Clear search' }).last().click()
    await tab(page, 'Coffee').waitFor()
  })
})

describe('the order beside the menu and in its drawer (D124)', () => {
  it('a long order keeps its title and "Review order" on screen: only the lines scroll', async () => {
    const page = await openWithLongOrder(1440)
    await panel(page).getByText('12 items').waitFor()
    const review = panel(page).getByRole('link', { name: 'Review order' })
    expect(await onScreen(page, review)).toBe(true)
    const lines = panel(page).getByRole('list', { name: 'Items in your order' })
    expect(await lines.evaluate(list => list.parentElement!.scrollHeight > list.parentElement!.clientHeight)).toBe(true)
    await lines.evaluate(list => list.parentElement!.scrollTo({ top: list.parentElement!.scrollHeight }))
    expect(await onScreen(page, panel(page).getByRole('heading', { name: 'Your order' }))).toBe(true)
    expect(await onScreen(page, review)).toBe(true)
  })

  it('removes a line with its trash; the stepper stops at 1 (only the trash removes)', async () => {
    const { page } = await open()
    await visible(card(page, 'Banana Bread').getByRole('button', { name: 'Add Banana Bread to order' })).click()
    const lines = panel(page).getByRole('list', { name: 'Items in your order' })
    expect(await lines.getByRole('button', { name: 'Decrease quantity of Banana Bread' }).isDisabled()).toBe(true)
    await lines.getByRole('button', { name: 'Remove Banana Bread' }).click()
    await panel(page).getByText('Your order is empty').waitFor()
  })

  it('a line\'s card: the quantity without a keyboard on touch screens, typed on a computer, at most 20; a note carried to Review order (D128)', async () => {
    const { page } = await open()
    await visible(card(page, 'Banana Bread').getByRole('button', { name: 'Add Banana Bread to order' })).click()
    const line = panel(page).getByRole('listitem', { name: 'Banana Bread' })
    const field = line.getByRole('textbox', { name: 'Quantity of Banana Bread' })
    expect(await field.getAttribute('inputmode')).toBe('none')

    await line.getByRole('button', { name: 'Increase quantity of Banana Bread' }).click()
    await expect.poll(() => field.inputValue()).toBe('2')
    await line.getByText('$4.50').waitFor()
    await field.fill('35')
    await field.press('Enter')
    await expect.poll(() => field.inputValue()).toBe('20')
    expect(await line.getByRole('button', { name: 'Increase quantity of Banana Bread' }).isDisabled()).toBe(true)
    await field.fill('abc')
    await field.blur()
    await expect.poll(() => field.inputValue()).toBe('20')

    await line.getByRole('button', { name: 'Add a note' }).click()
    await line.getByRole('textbox', { name: 'Note for Banana Bread' }).fill('Warm please')
    await expect.poll(() => line.getByRole('button', { name: 'Add a note' }).count()).toBe(0)
    await page.goto(url('/checkout'), { waitUntil: 'hydration' })
    await expect.poll(() => page.getByRole('textbox', { name: 'Note for Banana Bread' }).inputValue()).toBe('Warm please')
  })

  it('"Clear order" asks first; Cancel keeps the order, "Remove all" empties it', async () => {
    const page = await openWithLongOrder(1440)
    await panel(page).getByRole('button', { name: 'Clear order' }).click()
    await dialog(page).getByText('All 12 items will be removed from your order.').waitFor()
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => dialog(page).count()).toBe(0)
    expect(await panel(page).getByText('12 items').isVisible()).toBe(true)
    await panel(page).getByRole('button', { name: 'Clear order' }).click()
    await dialog(page).getByRole('button', { name: 'Remove all' }).click()
    await panel(page).getByText('Your order is empty').waitFor()
    expect(await panel(page).getByRole('button', { name: 'Clear order' }).count()).toBe(0)
  })

  it('on a phone, the sheet keeps its title and "Review order" while the lines scroll', async () => {
    const page = await openWithLongOrder(390)
    await page.getByRole('toolbar', { name: 'Your order' }).getByRole('button', { name: 'View order' }).click()
    const sheet = dialog(page)
    await sheet.getByText('12 items').waitFor()
    const body = sheet.locator('[data-slot="body"]').first()
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await body.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
    // Polled: the sheet slides up when it opens.
    await expect.poll(() => onScreen(page, sheet.getByRole('link', { name: 'Review order' }))).toBe(true)
    expect(await onScreen(page, sheet.getByRole('heading', { name: 'Your order' }))).toBe(true)
  })

  it('on a tablet, the order opens from the right, the full height', async () => {
    const page = await openWithLongOrder(768, 1024)
    await page.getByRole('toolbar', { name: 'Your order' }).getByRole('button', { name: 'View order' }).click()
    await dialog(page).getByText('12 items').waitFor()
    // Wait for the slide-in to end before measuring.
    await expect.poll(async () => Math.round((await dialog(page).boundingBox())!.x + (await dialog(page).boundingBox())!.width)).toBe(768)
    const box = (await dialog(page).boundingBox())!
    expect(box.height).toBeGreaterThan(1000)
    expect(await onScreen(page, dialog(page).getByRole('link', { name: 'Review order' }))).toBe(true)
  })
})

describe('the header at every width (D124)', () => {
  it('fits without scrolling sideways, from 320 px to desktop', async () => {
    for (const width of [320, 390, 768, 1024, 1440]) {
      const { page } = await open(width)
      expect(await noSidewaysScroll(page), `at ${width} px`).toBe(true)
      await page.close()
    }
  })

  it('below lg, Appearance is in the account menu, also signed out', async () => {
    const { page } = await open(390)
    expect(await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).filter({ visible: true }).count()).toBe(0)
    await visible(page.getByRole('button', { name: 'Account' })).click()
    await page.getByRole('link', { name: 'Create account' }).waitFor()
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await page.getByRole('button', { name: 'Light' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
  })
})

describe('the customer menu on a phone', () => {
  it('rows with "Add"; the order bar appears after the first add and opens the order', async () => {
    const { page } = await open(390)
    expect(await page.getByRole('toolbar', { name: 'Your order' }).count()).toBe(0)
    await visible(card(page, 'Banana Bread').getByRole('button', { name: 'Add Banana Bread to order' })).click()
    const bar = page.getByRole('toolbar', { name: 'Your order' })
    await bar.getByText('1 item').waitFor()
    await bar.getByRole('button', { name: 'View order' }).click()
    await dialog(page).getByText('$2.25').first().waitFor()
  })

  it('the icon button opens the categories sheet; choosing closes it and scrolls there', async () => {
    const { page } = await open(390)
    await visible(page.getByRole('button', { name: 'All categories' })).click()
    await dialog(page).getByRole('button', { name: /^Frappé/ }).click()
    await expect.poll(() => dialog(page).count()).toBe(0)
    await expect.poll(() => tab(page, 'Frappé').getAttribute('aria-current')).toBe('true')
  })

  it('search takes over the header, Back leaves it', async () => {
    const { page } = await open(390)
    await visible(page.getByRole('button', { name: 'Search the menu' })).click()
    await page.getByRole('searchbox', { name: 'Search the menu' }).filter({ visible: true }).fill('tea')
    await page.getByText(/results? for "tea"/).waitFor()
    await page.getByRole('button', { name: 'Close search' }).click()
    await tab(page, 'Coffee').waitFor()
  })
})

describe('branches and table QR codes', () => {
  it('a scanned table orders for that table, until switched to pickup', async () => {
    const { page } = await open(1440, `/table/${seed.openTableToken}`)
    expect(new URL(page.url()).pathname).toBe('/')
    await page.getByRole('button', { name: 'Order type: Table T01' }).click()
    await page.getByRole('button', { name: 'Switch to pickup' }).click()
    await page.getByRole('button', { name: 'Order type: Pickup' }).waitFor()
  })

  it('a table at a closed branch shows its menu, closed: one warning, adding disabled', async () => {
    const { page } = await open(1440, `/table/${seed.closedTableToken}`)
    await page.getByText('Zeta Kiosk', { exact: false }).first().waitFor()
    await page.getByText('Closed now', { exact: true }).waitFor()
    await page.getByText('Online ordering isn\'t available right now.').waitFor()
    expect(await visible(card(page, 'Banana Bread').getByRole('button', { name: 'Add Banana Bread to order' })).isDisabled()).toBe(true)
  })

  it('a QR code that doesn\'t work says so and offers pickup', async () => {
    const page = await createPage()
    await page.goto(url('/table/Zz9zZz9zZz9zZz9zZz9zZz'), { waitUntil: 'hydration' })
    await page.getByText('This table\'s QR code doesn\'t work').waitFor()
    await page.getByRole('link', { name: 'Order for pickup' }).click()
    await heading(page, 'Coffee').waitFor()
    expect(await page.getByRole('button', { name: 'Order type: Pickup' }).isVisible()).toBe(true)
  })
})
