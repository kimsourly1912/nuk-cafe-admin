import type { Locator, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MenuItem, MenuItemSummary } from '../../shared/contracts/menu-items'
import type { ModifierGroup } from '../../shared/contracts/menu-modifiers'
import type { OptionSet } from '../../shared/contracts/menu-options'
import type { MockHandler } from './support/mock-api'
import { deferred, failures, MENU_TEA, menuCategoryOf, menuItemOf, menuItemSummaryOf, mockApi, paginatedHandler, setupE2e, toast } from './support/mock-api'

// Menu items on the new API (D70): list, filters, state actions, and the form with an image, a
// leaf category, the option sets' price grid, add-ons with the item's own rules and prices, and
// availability rules. Prices are cents in the API and dollars on screen.
await setupE2e()

const STAMP = '2026-09-28T00:00:00.000Z'

// Categories: Tea is a leaf; Drinks has a sub-category (Espresso), so only Espresso takes items.
const DRINKS = menuCategoryOf('cat-10', 'Drinks', { sortOrder: 2, childCount: 1 })
const ESPRESSO = menuCategoryOf('cat-11', 'Espresso', { parentId: 'cat-10' })

const SIZE: OptionSet = {
  id: 'set-size',
  name: 'Size',
  status: 'active',
  values: [{ id: 'val-s', name: 'Small', sortOrder: 1, status: 'active' }, { id: 'val-l', name: 'Large', sortOrder: 2, status: 'active' }],
  itemCount: 0,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
}
const TEMP: OptionSet = {
  ...SIZE,
  id: 'set-temp',
  name: 'Temperature',
  values: [{ id: 'val-hot', name: 'Hot', sortOrder: 1, status: 'active' }, { id: 'val-iced', name: 'Iced', sortOrder: 2, status: 'active' }],
}
const MILK: ModifierGroup = {
  id: 'grp-milk',
  name: 'Milk',
  minSelect: 0,
  maxSelect: 1,
  status: 'active',
  modifiers: [
    { id: 'mod-oat', name: 'Oat', priceDeltaMinor: 50, isDefault: false, sortOrder: 1, status: 'active' },
    { id: 'mod-soy', name: 'Soy', priceDeltaMinor: 40, isDefault: false, sortOrder: 2, status: 'active' },
  ],
  itemCount: 0,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
}

/** Latte: Size × Temperature, Large/Iced switched off, Milk with a Soy price of its own. */
const LATTE: MenuItem = menuItemOf('item-1', 'Latte', {
  categoryId: ESPRESSO.id,
  description: 'Espresso and milk',
  image: { id: 'asset-latte', url: '/media/menu/latte.png' },
  status: 'active',
  optionSets: [
    { id: SIZE.id, name: 'Size', status: 'active', values: SIZE.values.map(({ id, name, status }) => ({ id, name, status })) },
    { id: TEMP.id, name: 'Temperature', status: 'active', values: TEMP.values.map(({ id, name, status }) => ({ id, name, status })) },
  ],
  variations: [
    { id: 'var-1', valueIds: ['val-s', 'val-hot'], label: 'Small, Hot', priceMinor: 350, status: 'active', sellable: true },
    { id: 'var-2', valueIds: ['val-s', 'val-iced'], label: 'Small, Iced', priceMinor: 375, status: 'active', sellable: true },
    { id: 'var-3', valueIds: ['val-l', 'val-hot'], label: 'Large, Hot', priceMinor: 425, status: 'active', sellable: true },
    { id: 'var-4', valueIds: ['val-l', 'val-iced'], label: 'Large, Iced', priceMinor: 450, status: 'disabled', sellable: false },
  ],
  modifierGroups: [{
    id: MILK.id,
    name: 'Milk',
    status: 'active',
    minSelect: 0,
    maxSelect: 1,
    rulesOverridden: false,
    modifiers: [
      { id: 'mod-oat', name: 'Oat', priceDeltaMinor: 50, defaultPriceDeltaMinor: 50, priceOverridden: false, isDefault: false, status: 'active' },
      { id: 'mod-soy', name: 'Soy', priceDeltaMinor: 60, defaultPriceDeltaMinor: 40, priceOverridden: true, isDefault: false, status: 'active' },
    ],
  }],
  version: 3,
})

const summaryOf = (item: MenuItem, overrides: Partial<MenuItemSummary> = {}) => menuItemSummaryOf(item.id, item.name, {
  categoryId: item.categoryId,
  categoryName: item.categoryId === ESPRESSO.id ? 'Espresso' : 'Tea',
  status: item.status,
  imageUrl: item.image?.url ?? null,
  version: item.version,
  ...overrides,
})
const LATTE_ROW = summaryOf(LATTE, { priceMinMinor: 350, priceMaxMinor: 425 })
const MATCHA = menuItemOf('item-2', 'Matcha', { variations: [{ id: 'var-9', valueIds: [], label: '', priceMinor: null, status: 'disabled', sellable: false }] })
const MATCHA_ROW = summaryOf(MATCHA, { priceMinMinor: null, priceMaxMinor: null })

const UPLOADED = { id: 'asset-new', url: '/media/menu/new.png', mimeType: 'image/png', byteSize: 8 }

function backend(rows: MenuItemSummary[] = [LATTE_ROW, MATCHA_ROW], items: MenuItem[] = [LATTE, MATCHA]) {
  const handlers: Record<string, MockHandler> = {
    'GET /admin/menu/items': paginatedHandler(rows),
    'GET /admin/menu/items/{id}': ({ url }) => items.find(i => i.id === url.pathname.split('/').pop()),
    'GET /admin/menu/categories': () => [MENU_TEA, DRINKS, ESPRESSO],
    'GET /admin/menu/option-sets': () => [SIZE, TEMP],
    'GET /admin/menu/modifier-groups': () => [MILK],
  }
  return handlers
}

/** `first: ''` doesn't wait for any card (empty list). */
async function open(handlers: Record<string, MockHandler> = backend(), first = 'Latte', path = '/admin/products') {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  if (first) await cardOf(page, first).waitFor()
  return { page, api }
}

const cardOf = (page: Page, name: string) => page.getByRole('article', { name, exact: true })

async function openEdit(page: Page, name: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit menu item' })
  await form.getByLabel('Name', { exact: true }).waitFor()
  return form
}

async function openNew(page: Page) {
  await page.getByRole('button', { name: 'New menu item' }).click()
  const form = page.getByRole('dialog', { name: 'New menu item' })
  await form.waitFor()
  return form
}

/** Picks a file through the Upload/Replace button (the file dialog VueUse opens). */
async function chooseImage(form: Locator, file: { name: string, mimeType: string, buffer: Buffer }) {
  const [chooser] = await Promise.all([
    form.page().waitForEvent('filechooser'),
    form.getByRole('button', { name: /Upload image|Replace image/ }).click(),
  ])
  await chooser.setFiles(file)
}

const PNG = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') }

/** `UInputNumber` updates its model on blur. */
async function typePrice(field: Locator, value: string) {
  await field.fill(value)
  await field.blur()
}

async function addFromMenu(form: Locator, button: string, entry: string) {
  await form.getByRole('button', { name: button }).click()
  await form.page().getByRole('menuitem', { name: entry }).click()
}

describe('menu items list', () => {
  it('shows cards with image, name, category, price range and state', async () => {
    const { page } = await open()
    const latte = cardOf(page, 'Latte')
    await latte.getByText('$3.50–$4.25').waitFor()
    await latte.getByText('Espresso').waitFor()
    expect(await latte.locator('img').getAttribute('src')).toBe('/media/menu/latte.png')
    // A draft is marked; nothing sellable reads "No price".
    await cardOf(page, 'Matcha').getByText('No price').waitFor()
    await cardOf(page, 'Matcha').getByText('Draft').waitFor()
  })

  it('opens a menu item by clicking anywhere on its card (loading the whole item)', async () => {
    const { page, api } = await open()
    // The card's centre, not the name: the name's button covers the whole card (D89).
    await cardOf(page, 'Latte').click()
    const form = page.getByRole('dialog', { name: 'Edit menu item' })
    await expect.poll(() => form.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte')
    expect(api.calls).toContain('GET /admin/menu/items/item-1')
  })

  it('selects only in Select mode: a click on a card then selects it, archived items can\'t be, Escape leaves (D89)', async () => {
    const { page } = await open()
    // No checkboxes until Select mode.
    expect(await page.getByRole('checkbox').count()).toBe(0)
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await bar.getByText('0 selected').waitFor()
    expect(await bar.getByRole('button', { name: 'Archive selected' }).isDisabled()).toBe(true)
    await cardOf(page, 'Matcha').click()
    await bar.getByText('1 selected').waitFor()
    expect(await page.getByRole('dialog').count()).toBe(0)
    await cardOf(page, 'Matcha').getByRole('checkbox', { name: 'Select Matcha' }).click()
    await bar.getByText('0 selected').waitFor()
    // Menus are hidden while selecting.
    expect(await page.getByRole('button', { name: 'Actions for Latte' }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await bar.waitFor({ state: 'detached' })
    expect(await page.getByRole('checkbox').count()).toBe(0)
  })

  it('switches to the list (table), opens a row by its name, and remembers the view', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'List view' }).click()
    await page.getByRole('cell', { name: 'Espresso', exact: true }).waitFor()
    // The name is the row's target; the rest of the row isn't (D89).
    await page.getByRole('cell', { name: 'No price' }).click()
    expect(await page.getByRole('dialog').count()).toBe(0)
    await page.getByRole('button', { name: 'Matcha', exact: true }).click()
    await page.getByRole('dialog', { name: 'Edit menu item' }).waitFor()
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.goto(page.url(), { waitUntil: 'hydration' })
    await page.getByRole('cell', { name: 'Espresso', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('filters by state with tabs that show counts; All includes archived items', async () => {
    const seen: URLSearchParams[] = []
    const list = paginatedHandler([LATTE_ROW, MATCHA_ROW, menuItemSummaryOf('item-3', 'Old chai', { status: 'archived' })])
    const { page } = await open({
      ...backend(),
      'GET /admin/menu/items': (request) => {
        if (request.url.searchParams.get('pageSize') !== '1') seen.push(request.url.searchParams)
        return list(request)
      },
    })
    expect(seen[0]?.get('status')).toBe('all')
    await cardOf(page, 'Old chai').getByText('Archived').waitFor()
    const tabs = page.getByRole('group', { name: 'Status' })
    await expect.poll(() => tabs.innerText()).toMatch(/All\s*3\s*Draft\s*1\s*Published\s*1\s*Archived\s*1/)
    await tabs.getByRole('tab', { name: /Published/ }).click()
    await expect.poll(() => seen.at(-1)?.get('status')).toBe('active')
    await expect.poll(() => page.getByRole('article').count()).toBe(1)
    expect(new URL(page.url()).searchParams.get('status')).toBe('active')
  })

  it('searches and filters by any category, both in the URL', async () => {
    const seen: URLSearchParams[] = []
    const list = paginatedHandler([LATTE_ROW, MATCHA_ROW])
    const { page } = await open({
      ...backend(),
      'GET /admin/menu/items': (request) => {
        seen.push(request.url.searchParams)
        return list(request)
      },
    })
    await page.getByPlaceholder('Search menu items…').fill('lat')
    await expect.poll(() => seen.at(-1)?.get('search')).toBe('lat')

    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.getByRole('option', { name: 'Drinks › Espresso' }).click()
    await expect.poll(() => seen.at(-1)?.get('categoryId')).toBe(ESPRESSO.id)
    await expect.poll(() => new URL(page.url()).searchParams.get('categoryId')).toBe(ESPRESSO.id)
  })

  it('on phones: the List view is rows (no table), the page fits, and a row\'s name opens it (D89, D90)', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, backend())
    await page.goto(url('/admin/products'), { waitUntil: 'hydration' })
    await cardOf(page, 'Latte').waitFor()
    // Grid: one column
    const lefts = await page.getByRole('article').evaluateAll(cards => cards.map(c => Math.round(c.getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(1)

    await page.getByRole('button', { name: 'List view' }).click()
    const list = page.getByRole('list', { name: 'Menu items' })
    await list.getByText('Espresso · $3.50–$4.25').waitFor()
    expect(await page.getByRole('table').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // On phones the item opens as its own page (D90).
    await list.getByRole('button', { name: 'Latte', exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/products/item-1')
  })

  it('lays the grid out by the width it has: several columns at 1440px (D89)', async () => {
    const { page } = await open()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect.poll(async () => {
      const lefts = await page.getByRole('article').evaluateAll(cards => cards.map(c => Math.round(c.getBoundingClientRect().left)))
      return new Set(lefts).size
    }).toBe(await page.getByRole('article').count())
  })

  it('shows the empty state when there are no menu items', async () => {
    const { page } = await open(backend([], []), '')
    await page.getByText('No menu items yet').waitFor()
  })
})

describe('menu item states', () => {
  it('publishes a draft, unpublishes a published item and restores an archived one, each from the version read', async () => {
    const bodies: Record<string, unknown> = {}
    const answer = (action: string): MockHandler => ({ url, body }) => {
      bodies[`${action} ${url.pathname.split('/').at(-2)}`] = body
      return MATCHA
    }
    const OLD = menuItemSummaryOf('item-3', 'Old chai', { status: 'archived', version: 9 })
    const { page } = await open({
      ...backend([LATTE_ROW, MATCHA_ROW, OLD]),
      'POST /admin/menu/items/{id}/publish': answer('publish'),
      'POST /admin/menu/items/{id}/unpublish': answer('unpublish'),
      'POST /admin/menu/items/{id}/restore': answer('restore'),
    })
    const act = async (name: string, action: string) => {
      await page.getByRole('button', { name: `Actions for ${name}` }).click()
      await page.getByRole('menuitem', { name: action }).click()
    }
    await act('Matcha', 'Publish')
    await toast(page, 'Menu item "Matcha" published').waitFor()
    await act('Latte', 'Unpublish')
    await toast(page, 'Menu item "Latte" unpublished').waitFor()
    await act('Old chai', 'Restore')
    await toast(page, 'Menu item "Old chai" restored as a draft').waitFor()
    expect(bodies).toEqual({ 'publish item-2': { version: 1 }, 'unpublish item-1': { version: 3 }, 'restore item-3': { version: 9 } })
  })

  it('a draft with nothing to sell is refused with the server\'s reason', async () => {
    const { page } = await open({
      ...backend(),
      'POST /admin/menu/items/{id}/publish': () => {
        throw failures.validation('Switch on and price at least one version before publishing.')
      },
    })
    await page.getByRole('button', { name: 'Actions for Matcha' }).click()
    await page.getByRole('menuitem', { name: 'Publish' }).click()
    await toast(page, 'Could not publish "Matcha"').waitFor()
    await page.getByText('Switch on and price at least one version before publishing.').first().waitFor()
  })

  it('an archived item opens read-only', async () => {
    const OLD = menuItemOf('item-3', 'Old chai', { status: 'archived' })
    const { page } = await open(backend([summaryOf(OLD)], [OLD]), 'Old chai')
    await page.getByRole('button', { name: 'Actions for Old chai' }).click()
    await page.getByRole('menuitem', { name: 'View' }).click()
    const form = page.getByRole('dialog', { name: 'Archived menu item' })
    await form.getByText('This menu item is archived. Restore it from the list to edit it.').waitFor()
    expect(await form.getByLabel('Name', { exact: true }).isDisabled()).toBe(true)
    expect(await form.getByRole('button', { name: 'Save' }).count()).toBe(0)
  })
})

describe('menu item form', () => {
  it('creates a draft with an uploaded image, a leaf category, a price in cents and a rule', async () => {
    let uploaded: unknown
    let body: unknown
    const { page } = await open({
      ...backend(),
      'GET /admin/menu/availability-rules': () => [{ id: 'rule-1', name: 'Breakfast', status: 'active', windows: [], itemCount: 0, categoryCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP }],
      'POST /admin/media': (request) => {
        uploaded = request.body
        return UPLOADED
      },
      'POST /admin/menu/items': (request) => {
        body = request.body
        return menuItemOf('item-9', 'Mocha')
      },
    })
    const form = await openNew(page)

    // Nothing is sent while required fields are empty.
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Category is required').waitFor()
    await form.getByText('Set a price, or switch it off').waitFor()

    await chooseImage(form, PNG)
    await expect.poll(() => form.locator('img').getAttribute('src')).toBe(UPLOADED.url)
    await form.getByLabel('Name', { exact: true }).fill('Mocha')
    // Only leaves are offered: Drinks has a sub-category.
    await form.getByRole('combobox', { name: 'Category' }).click()
    await page.getByRole('option', { name: 'Drinks › Espresso' }).waitFor()
    expect(await page.getByRole('option', { name: 'Drinks', exact: true }).count()).toBe(0)
    await page.getByRole('option', { name: 'Drinks › Espresso' }).click()
    await typePrice(form.getByRole('spinbutton', { name: 'Price' }), '4.2')
    await form.getByRole('combobox', { name: 'Availability' }).click()
    await page.getByRole('option', { name: 'Breakfast' }).click()
    await page.keyboard.press('Escape') // close the multi-select list
    await form.getByRole('button', { name: 'Create' }).click()

    await toast(page, 'Menu item "Mocha" created as a draft').waitFor()
    // Multipart with the chosen file.
    expect(uploaded).toContain('filename="photo.png"')
    expect(body).toEqual({
      categoryId: ESPRESSO.id,
      name: 'Mocha',
      description: '',
      imageId: UPLOADED.id,
      optionSetIds: [],
      variations: [{ valueIds: [], priceMinor: 420, status: 'active' }],
      modifierGroups: [],
      availabilityRuleIds: ['rule-1'],
    })
  })

  it('builds the price grid from two option sets, keeping prices, and sends every version', async () => {
    let body: { optionSetIds?: string[], variations?: unknown[] } | undefined
    const { page } = await open({
      ...backend(),
      'POST /admin/menu/items': (request) => {
        body = request.body as typeof body
        return menuItemOf('item-9', 'Flat white')
      },
    })
    const form = await openNew(page)
    await form.getByLabel('Name', { exact: true }).fill('Flat white')
    await form.getByRole('combobox', { name: 'Category' }).click()
    await page.getByRole('option', { name: 'Tea' }).click()

    await addFromMenu(form, 'Add option set', 'Size')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small' }), '3')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Large' }), '4')
    await addFromMenu(form, 'Add option set', 'Temperature')
    // The second set makes a 2 × 2 grid; the new combinations have no price yet.
    await form.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => form.getByText('Set a price, or switch it off').count()).toBe(4)
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small, Hot' }), '3')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small, Iced' }), '3.25')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Large, Hot' }), '4')
    await form.getByRole('switch', { name: 'Sell Large, Iced' }).click()
    // No more option sets than two.
    expect(await form.getByRole('button', { name: 'Add option set' }).isDisabled()).toBe(true)
    await form.getByRole('button', { name: 'Create' }).click()

    await toast(page, 'Menu item "Flat white" created as a draft').waitFor()
    expect(body?.optionSetIds).toEqual([SIZE.id, TEMP.id])
    expect(body?.variations).toEqual([
      { valueIds: ['val-s', 'val-hot'], priceMinor: 300, status: 'active' },
      { valueIds: ['val-s', 'val-iced'], priceMinor: 325, status: 'active' },
      { valueIds: ['val-l', 'val-hot'], priceMinor: 400, status: 'active' },
      { valueIds: ['val-l', 'val-iced'], priceMinor: null, status: 'disabled' },
    ])
  })

  it('edits from the version it read: grid, add-on prices and rules, image kept', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend(),
      'PATCH /admin/menu/items/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return { ...LATTE, version: 4 }
      },
    })
    const form = await openEdit(page, 'Latte')
    // The grid as saved: Large, Iced is off (its price kept).
    expect(await form.getByRole('switch', { name: 'Sell Large, Iced' }).getAttribute('aria-checked')).toBe('false')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Large, Hot' }), '4.5')
    // Oat back to its own price; Soy (own price) back to the library's.
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Oat in Milk' }), '0.75')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Soy in Milk' }), '0.4')
    await form.getByRole('checkbox', { name: /Own rules for this item/ }).click()
    await typePrice(form.getByRole('spinbutton', { name: 'At least, Milk' }), '1')
    await form.getByRole('button', { name: 'Save' }).click()

    await toast(page, 'Menu item "Latte" updated').waitFor()
    expect(body).toMatchObject({
      version: 3,
      categoryId: ESPRESSO.id,
      imageId: 'asset-latte',
      optionSetIds: [SIZE.id, TEMP.id],
      variations: [
        { valueIds: ['val-s', 'val-hot'], priceMinor: 350, status: 'active' },
        { valueIds: ['val-s', 'val-iced'], priceMinor: 375, status: 'active' },
        { valueIds: ['val-l', 'val-hot'], priceMinor: 450, status: 'active' },
        { valueIds: ['val-l', 'val-iced'], priceMinor: 450, status: 'disabled' },
      ],
      modifierGroups: [{ groupId: MILK.id, rules: { minSelect: 1, maxSelect: 1 }, prices: [{ modifierId: 'mod-oat', priceDeltaMinor: 75 }] }],
    })
  })

  it('adds an add-on group from the library, and checks its own rules before sending', async () => {
    const { page, api } = await open({ ...backend([MATCHA_ROW], [{ ...MATCHA, variations: [{ ...MATCHA.variations[0]!, priceMinor: 300, status: 'active' }] }]) }, 'Matcha')
    const form = await openEdit(page, 'Matcha')
    await addFromMenu(form, 'Add add-on group', 'Milk')
    await form.getByRole('region', { name: 'Add-on group Milk' }).waitFor()
    await form.getByRole('checkbox', { name: /Own rules for this item/ }).click()
    await typePrice(form.getByRole('spinbutton', { name: 'At least, Milk' }), '3')
    // The library allows at most 1: raise it, so the check that fails is the active add-ons one.
    await typePrice(form.getByRole('spinbutton', { name: 'At most, Milk' }), '3')
    await form.getByRole('button', { name: 'Save' }).click()
    await form.getByText('Customers must choose 3, but only 2 add-ons are active.').waitFor()
    expect(api.calls.filter(c => c.startsWith('PATCH'))).toEqual([])
  })

  it('a refused save shows inside the panel, on its field, and keeps the input', async () => {
    const { page } = await open({
      ...backend(),
      'PATCH /admin/menu/items/{id}': () => {
        throw failures.conflict('VERSION_CONFLICT', 'This menu item was changed by someone else.')
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByLabel('Name', { exact: true }).fill('Latte 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await form.getByText('Someone else changed this menu item.', { exact: false }).waitFor()
    expect(await form.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte 2')
  })

  it('maps a server error on a version\'s price to its cell', async () => {
    const { page } = await open({
      ...backend(),
      'PATCH /admin/menu/items/{id}': () => {
        throw failures.validation('A version that\'s on needs a price', { 'variations.2.priceMinor': ['A version that\'s on needs a price'] })
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByRole('button', { name: 'Save' }).click()
    await form.getByText('Not saved').waitFor()
    // Under "Large, Hot" (the third version), as well as in the alert.
    await expect.poll(() => form.getByText('A version that\'s on needs a price').count()).toBe(2)
  })

  it('removes the image: saved with imageId null', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend(),
      'PATCH /admin/menu/items/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return LATTE
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByRole('button', { name: 'Remove', exact: true }).click()
    await form.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => body?.imageId).toBeNull()
  })

  it('rejects the wrong file type or a file over 5 MB without uploading', async () => {
    const { page, api } = await open()
    const form = await openNew(page)
    await chooseImage(form, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') })
    await form.getByText('Use a JPEG, PNG or WebP image.').waitFor()
    await chooseImage(form, { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
    await form.getByText('The image is larger than 5 MB.').waitFor()
    expect(api.calls.filter(c => c.includes('media'))).toEqual([])
  })

  it('cannot save while the image is uploading, and keeps the old image when the upload fails', async () => {
    const upload = deferred()
    const { page, api } = await open({ ...backend(), 'POST /admin/media': upload.handler })
    const form = await openEdit(page, 'Latte')
    await chooseImage(form, PNG)
    await upload.started()
    await form.getByText('Waiting for the image upload…').waitFor()
    expect(await form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)

    upload.fail(failures.validation('Use a JPEG, PNG or WebP image.'))
    await expect.poll(() => form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(false)
    expect(await form.locator('img').getAttribute('src')).toBe('/media/menu/latte.png')
    expect(api.calls.filter(c => c.startsWith('PATCH'))).toEqual([])
  })

  it('a changed price counts as unsaved: closing asks first', async () => {
    const { page } = await open()
    const form = await openEdit(page, 'Latte')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small, Hot' }), '9')
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})

describe('menu item editor URLs (D90, decision 4)', () => {
  const params = (page: Page) => new URL(page.url()).searchParams

  it('from sm the list opens the slide-over at ?item= (filters kept); Back closes it, resizing changes nothing', async () => {
    const { page } = await open(backend(), 'Matcha', '/admin/products?status=draft')
    await cardOf(page, 'Matcha').click()
    const form = page.getByRole('dialog', { name: 'Edit menu item' })
    await expect.poll(() => form.getByLabel('Name', { exact: true }).inputValue()).toBe('Matcha')
    expect(params(page).get('item')).toBe('item-2')
    expect(params(page).get('status')).toBe('draft')

    // Resizing to a phone keeps the slide-over and the URL.
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await form.getAttribute('data-state')).toBe('open')
    expect(params(page).get('item')).toBe('item-2')
    await page.setViewportSize({ width: 1280, height: 800 })

    await page.goBack()
    await form.waitFor({ state: 'hidden' })
    expect(params(page).get('item')).toBeNull()
    expect(params(page).get('status')).toBe('draft')
  })

  it('closing the slide-over removes only `item`, and asks only once about unsaved input', async () => {
    const { page } = await open(backend(), 'Matcha', '/admin/products?status=draft')
    await cardOf(page, 'Matcha').click()
    const form = page.getByRole('dialog', { name: 'Edit menu item' })
    await form.getByLabel('Name', { exact: true }).fill('Matcha 2')
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.poll(() => params(page).get('item')).toBeNull()
    expect(params(page).get('status')).toBe('draft')
    // One question, not a second one from the route guard when `item` left the URL.
    await expect.poll(() => page.getByText('Discard unsaved changes?').count()).toBe(0)
    await cardOf(page, 'Matcha').waitFor()
  })

  it('on phones the list pushes /products/<id>: sections one at a time, ← back to the list with its filters', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, backend())
    await page.goto(url('/admin/products?status=active'), { waitUntil: 'hydration' })
    await cardOf(page, 'Latte').click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/products/item-1')
    await expect.poll(() => page.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte')
    expect(await page.title()).toBe('Menu item · NUK Cafe Admin')
    // One section at a time.
    expect(await page.getByRole('region', { name: 'Options and prices' }).isVisible()).toBe(false)
    await page.getByRole('tab', { name: 'Prices' }).click()
    await page.getByRole('region', { name: 'Options and prices' }).waitFor()
    expect(await page.getByLabel('Name', { exact: true }).isVisible()).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.getByRole('button', { name: 'Back to Menu items' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/products')
    expect(params(page).get('status')).toBe('active')
  })

  it('an invalid field in a hidden section shows its section (phones, a new item at /products/new)', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, backend())
    await page.goto(url('/admin/products'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'New menu item' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/products/new')
    await page.getByRole('tab', { name: 'Availability' }).click()
    await page.getByRole('toolbar', { name: 'Save' }).getByRole('button', { name: 'Create' }).click()
    await page.getByText('Name is required').waitFor()
    expect(await page.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true')
  })

  it('/admin/products/<id> opens the item at every width; Save sends the version read and returns to the list', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend(),
      'PATCH /admin/menu/items/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return { ...LATTE, name: 'Latte 2', version: 4 }
      },
    }, '', '/admin/products/item-1')
    // Wide: every section at once, Save in the navbar.
    await expect.poll(() => page.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte')
    await page.getByRole('region', { name: 'Options and prices' }).waitFor()
    expect(await page.getByRole('tab', { name: 'Prices' }).count()).toBe(0)
    await page.getByLabel('Name', { exact: true }).fill('Latte 2')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await toast(page, 'Menu item "Latte 2" updated').waitFor()
    expect(body).toMatchObject({ version: 3, name: 'Latte 2' })
    await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/products')
  })

  it('leaving /products/<id> with unsaved input asks first', async () => {
    const { page } = await open(backend(), '', '/admin/products/item-1')
    await expect.poll(() => page.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte')
    await page.getByLabel('Name', { exact: true }).fill('Latte 2')
    await page.getByRole('link', { name: 'Categories' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    expect(new URL(page.url()).pathname).toBe('/admin/products/item-1')
  })
})

describe('reordering a category\'s items (step 10.3, D117)', () => {
  const CHAI = summaryOf(menuItemOf('item-20', 'Chai', { categoryId: 'cat-1' }), { sortOrder: 1, version: 3 })
  const GREEN = summaryOf(menuItemOf('item-21', 'Green tea', { categoryId: 'cat-1' }), { sortOrder: 2, version: 5, status: 'active' })
  const OOLONG = summaryOf(menuItemOf('item-22', 'Oolong', { categoryId: 'cat-1' }), { sortOrder: 3, version: 7, status: 'active' })
  const OLD = summaryOf(menuItemOf('item-23', 'Old tea', { categoryId: 'cat-1' }), { sortOrder: 4, status: 'archived' })

  function reorderBackend(put: MockHandler) {
    return {
      ...backend(),
      'GET /admin/menu/items': ({ url }: { url: URL }) => {
        const inTea = url.searchParams.get('categoryId') === 'cat-1'
        const rows = inTea ? [OOLONG, CHAI, GREEN, OLD] : [LATTE_ROW, MATCHA_ROW]
        return { items: rows, page: 1, pageSize: 100, total: rows.length, totalPages: 1 }
      },
      'PUT /admin/menu/items/order': put,
    } as Record<string, MockHandler>
  }

  async function openReorder(page: Page) {
    await page.getByRole('button', { name: 'Reorder' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reorder menu items' })
    await dialog.getByRole('combobox', { name: 'Category' }).click()
    await page.getByRole('option', { name: 'Tea' }).click()
    await dialog.getByRole('list', { name: 'Menu items in order' }).waitFor()
    return dialog
  }

  it('lists the category\'s items in their order (not archived ones), moves one, and saves every item with its version', async () => {
    let sent: unknown
    const { page, api } = await open(reorderBackend(({ body }) => {
      sent = body
      return null
    }))
    const dialog = await openReorder(page)
    const names = () => dialog.getByRole('listitem').evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')))
    expect(await names()).toEqual(['Chai', 'Green tea', 'Oolong'])
    expect(await dialog.getByRole('button', { name: 'Save order' }).isDisabled()).toBe(true)

    await dialog.getByRole('button', { name: 'Move Oolong up' }).click()
    await dialog.getByText('Oolong moved to position 2 of 3').waitFor()
    await dialog.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Order saved').waitFor()
    expect(sent).toEqual({ categoryId: 'cat-1', items: [{ id: 'item-20', version: 3 }, { id: 'item-22', version: 7 }, { id: 'item-21', version: 5 }] })
    expect(api.calls.filter(c => c.startsWith('PUT'))).toEqual(['PUT /admin/menu/items/order'])
  })

  it('someone changed an item meanwhile: says so, nothing moves, Reload brings the latest order', async () => {
    const { page, api } = await open(reorderBackend(() => {
      throw failures.conflict('ITEMS_CHANGED', 'These menu items were changed by someone else.')
    }))
    const dialog = await openReorder(page)
    await dialog.getByRole('button', { name: 'Move Chai down' }).click()
    await dialog.getByRole('button', { name: 'Save order' }).click()
    await dialog.getByText('Someone changed these items meanwhile').waitFor()
    const reads = api.calls.filter(c => c === 'GET /admin/menu/items').length
    await dialog.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => api.calls.filter(c => c === 'GET /admin/menu/items').length).toBeGreaterThan(reads)
    await expect.poll(() => dialog.getByText('Someone changed these items meanwhile').count()).toBe(0)
    expect(await dialog.getByRole('listitem').first().getAttribute('aria-label')).toBe('Chai')
  })

  it('closing with a move asks first', async () => {
    const { page } = await open(reorderBackend(() => null))
    const dialog = await openReorder(page)
    await dialog.getByRole('button', { name: 'Move Chai down' }).click()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})
