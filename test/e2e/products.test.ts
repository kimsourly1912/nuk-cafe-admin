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
  image: { id: 'asset-latte', url: '/media/menu/latte.png', display: { card: '/media/menu/latte.png', detail: '/media/menu/latte.png', detailSmall: null, placeholder: null } },
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

/** What `POST /admin/media/photos` answers (D158). */
const UPLOADED_PHOTO = { id: 'asset-new', image: { card: '/media/t/1/menu/new-card.webp', detail: '/media/t/1/menu/new-detail.webp', detailSmall: '/media/t/1/menu/new-small.webp', placeholder: null } }

/** The list, with the server's `photo=missing` filter (D160). */
const itemList = (rows: MenuItemSummary[]): MockHandler => request =>
  paginatedHandler(request.url.searchParams.get('photo') === 'missing' ? rows.filter(row => !row.imageUrl) : rows)(request)

function backend(rows: MenuItemSummary[] = [LATTE_ROW, MATCHA_ROW], items: MenuItem[] = [LATTE, MATCHA]) {
  const handlers: Record<string, MockHandler> = {
    'GET /admin/menu/items': itemList(rows),
    'GET /admin/menu/items/{id}': ({ url }) => items.find(i => i.id === url.pathname.split('/').pop()),
    'GET /admin/menu/categories': () => [MENU_TEA, DRINKS, ESPRESSO],
    'GET /admin/menu/option-sets': () => [SIZE, TEMP],
    'GET /admin/menu/modifier-groups': () => [MILK],
  }
  return handlers
}

/** `first: ''` doesn't wait for any card (empty list). */
async function open(handlers: Record<string, MockHandler> = backend(), first = 'Latte', path = '/c/nuk/admin/products') {
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

interface TestFile { name: string, mimeType: string, buffer: Buffer }

/** A real photo-like PNG of `width` × `height`, drawn in the page: a warm background and a round dish. */
async function photoFile(page: Page, width: number, height: number, name = 'dish.png'): Promise<TestFile> {
  const bytes = await page.evaluate(async ([w, h]) => {
    const canvas = document.createElement('canvas')
    canvas.width = w!
    canvas.height = h!
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e9dcc9'
    context.fillRect(0, 0, w!, h!)
    context.fillStyle = '#7a4b2a'
    context.beginPath()
    context.arc(w! / 2, h! / 2, Math.min(w!, h!) / 3, 0, Math.PI * 2)
    context.fill()
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, [width, height])
  return { name, mimeType: 'image/png', buffer: Buffer.from(bytes) }
}

/** Opens the photo editor from the form (Add photo / Edit photo). */
async function openPhotoEditor(form: Locator, button = 'Add photo') {
  await form.getByRole('button', { name: button }).click()
  const editor = form.page().getByRole('dialog', { name: /Add photo|Edit photo/ })
  await editor.waitFor()
  return editor
}

/** Chooses a file in the photo editor (the file dialog VueUse opens). */
async function choosePhoto(editor: Locator, file: TestFile, button = 'Choose photo') {
  const [chooser] = await Promise.all([
    editor.page().waitForEvent('filechooser'),
    editor.getByRole('button', { name: button }).click(),
  ])
  await chooser.setFiles(file)
}

/** Latte's saved photo, for Edit photo: how it was made and its private source. */
async function routeSavedPhoto(page: Page, edit: unknown = null) {
  const source = await photoFile(page, 1200, 900)
  await page.route('**/api/c/nuk/admin/media/photos/asset-latte', route => route.fulfill({ json: { id: 'asset-latte', edit, image: LATTE.image!.display } }))
  await page.route('**/api/c/nuk/admin/media/photos/asset-latte/source', route => route.fulfill({ contentType: 'image/png', body: source.buffer }))
}

/** The photo editor's upload, its raw bytes kept (the mock's handlers get text, which garbles binary). */
async function capturePhotoUpload(page: Page, answer: unknown = UPLOADED_PHOTO) {
  const uploads: Buffer[] = []
  await page.route('**/api/c/nuk/admin/media/photos', async (route) => {
    uploads.push(route.request().postDataBuffer()!)
    await route.fulfill({ status: 201, json: answer })
  })
  return uploads
}

/** One part of a multipart body: its text, or for a file the image's size, read back in the page. */
function partOf(body: Buffer, name: string): Buffer {
  const marker = `name="${name}"`
  const start = body.indexOf(marker)
  const data = body.indexOf('\r\n\r\n', start) + 4
  const end = body.indexOf('\r\n--', data)
  return body.subarray(data, end)
}
async function imageSizeOf(page: Page, bytes: Buffer) {
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]))
    return [bitmap.width, bitmap.height]
  }, [...bytes])
}

/** `UInputNumber` updates its model on blur. */
/** Picks a searchable dropdown's option (RecordSelect) and waits for its list to close: it hands focus back to its button as it closes. */
async function chooseOption(page: Page, name: string) {
  await page.getByRole('option', { name }).click()
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
}

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
    await bar.getByText('None selected').waitFor()
    expect(await bar.getByRole('button', { name: 'Archive selected' }).isDisabled()).toBe(true)
    await cardOf(page, 'Matcha').click()
    await bar.getByText('1 selected').waitFor()
    expect(await page.getByRole('dialog').count()).toBe(0)
    await cardOf(page, 'Matcha').getByRole('checkbox', { name: 'Select Matcha' }).click()
    await bar.getByText('None selected').waitFor()
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

    await page.getByRole('combobox', { name: 'Category', exact: true }).click()
    await page.getByRole('option', { name: 'Drinks › Espresso' }).click()
    await expect.poll(() => seen.at(-1)?.get('categoryId')).toBe(ESPRESSO.id)
    await expect.poll(() => new URL(page.url()).searchParams.get('categoryId')).toBe(ESPRESSO.id)
  })

  it('the category filter is searchable: matches anywhere in the path, All categories stays, and no match says so (D126)', async () => {
    const { page } = await open(backend())
    await page.getByRole('combobox', { name: 'Category', exact: true }).click()
    const search = page.getByPlaceholder('Search categories…')
    await search.fill('esp')
    await expect.poll(() => page.getByRole('option').allTextContents()).toEqual(['All categories', 'Drinks › Espresso'])
    await search.fill('zzz')
    await expect.poll(() => page.getByRole('option').allTextContents()).toEqual(['All categories'])
    await page.getByRole('listbox').getByText('No categories match “zzz”').waitFor()
  })

  it('on phones: the List view is rows (no table), the page fits, and a row\'s name opens it (D89, D90)', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, backend())
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
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
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/products/item-1')
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
    expect(await form.getByRole('button', { name: 'Save', exact: true }).count()).toBe(0)
  })
})

describe('deleting permanently (D200)', () => {
  it('deletes a never-ordered archived item after asking, from the version read, and the row goes', async () => {
    const OLD = menuItemSummaryOf('item-3', 'Old chai', { status: 'archived', version: 9 })
    const rows = [LATTE_ROW, MATCHA_ROW, OLD]
    const bodies: unknown[] = []
    const { page } = await open({
      ...backend(rows),
      'DELETE /admin/menu/items/{id}': ({ url: u, body }) => {
        bodies.push({ id: u.pathname.split('/').pop(), version: u.searchParams.get('version'), body })
        rows.splice(rows.indexOf(OLD), 1)
        return null
      },
    })
    await page.getByRole('button', { name: 'Actions for Old chai' }).click()
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete "Old chai" permanently?' })
    await dialog.getByText('It was never ordered.', { exact: false }).waitFor()
    await dialog.getByRole('button', { name: 'Delete permanently' }).click()
    await toast(page, 'Menu item "Old chai" deleted').waitFor()
    await cardOf(page, 'Old chai').waitFor({ state: 'detached' })
    expect(bodies).toEqual([{ id: 'item-3', body: { version: 9 } }])
  })

  it('says why an archived item with history can\'t go, and offers a draft\'s delete only without history', async () => {
    const SOLD = menuItemSummaryOf('item-3', 'Old chai', { status: 'archived', deleteBlocker: 'ordered' })
    const PROMOTED = menuItemSummaryOf('item-4', 'Old mocha', { status: 'archived', deleteBlocker: 'promotion' })
    const SOLD_DRAFT = summaryOf(MATCHA, { deleteBlocker: 'ordered' })
    const { page } = await open(backend([LATTE_ROW, SOLD_DRAFT, SOLD, PROMOTED]))
    const menuOf = async (name: string) => {
      await page.getByRole('button', { name: `Actions for ${name}` }).click()
      const menu = page.getByRole('menu')
      await menu.waitFor()
      return menu
    }
    let menu = await menuOf('Old chai')
    expect(await menu.getByRole('menuitem', { name: 'Delete permanently (it was ordered)' }).isDisabled()).toBe(true)
    await page.keyboard.press('Escape')
    menu = await menuOf('Old mocha')
    expect(await menu.getByRole('menuitem', { name: 'Delete permanently (it is in a promotion)' }).isDisabled()).toBe(true)
    await page.keyboard.press('Escape')
    // Published: archive first.
    menu = await menuOf('Latte')
    expect(await menu.getByRole('menuitem', { name: /Delete/ }).count()).toBe(0)
    await page.keyboard.press('Escape')
    menu = await menuOf('Matcha')
    expect(await menu.getByRole('menuitem', { name: /Delete/ }).count()).toBe(0)
  })

  it('shows the server\'s refusal when the item got history meanwhile, and keeps the row', async () => {
    const OLD = menuItemSummaryOf('item-3', 'Old chai', { status: 'archived' })
    const { page } = await open({
      ...backend([LATTE_ROW, OLD]),
      'DELETE /admin/menu/items/{id}': () => {
        throw failures.conflict('ITEM_HAS_HISTORY', 'This menu item was ordered, so it stays archived to keep your order history.')
      },
    })
    await page.getByRole('button', { name: 'Actions for Old chai' }).click()
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click()
    await toast(page, 'Could not delete "Old chai"').waitFor()
    await page.getByText('This menu item was ordered, so it stays archived', { exact: false }).first().waitFor()
    await cardOf(page, 'Old chai').waitFor()
  })
})

describe('menu item form', () => {
  it('creates a draft with an uploaded image, a leaf category, a price in cents and a rule', async () => {
    let body: unknown
    const { page } = await open({
      ...backend(),
      'GET /admin/menu/availability-rules': () => [{ id: 'rule-1', name: 'Breakfast', status: 'active', windows: [], itemCount: 0, categoryCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP }],
      'POST /admin/menu/items': (request) => {
        body = request.body
        return menuItemOf('item-9', 'Mocha')
      },
    })
    const form = await openNew(page)

    // Nothing is sent while required fields are empty.
    await form.getByRole('button', { name: 'Create', exact: true }).click()
    await form.getByText('Category is required').waitFor()
    await form.getByText('Set a price, or switch it off').waitFor()

    const uploads = await capturePhotoUpload(page)
    const editor = await openPhotoEditor(form)
    await choosePhoto(editor, await photoFile(page, 1600, 1200))
    await editor.getByRole('button', { name: 'Use photo' }).click()
    await editor.waitFor({ state: 'hidden' })
    await expect.poll(() => form.getByRole('img', { name: 'Menu item photo' }).getAttribute('src')).toBe(UPLOADED_PHOTO.image.card)
    expect(uploads).toHaveLength(1)
    await form.getByLabel('Name', { exact: true }).fill('Mocha')
    // Only leaves are offered: Drinks has a sub-category.
    await form.getByRole('combobox', { name: 'Category', exact: true }).click()
    await page.getByRole('option', { name: 'Drinks › Espresso' }).waitFor()
    expect(await page.getByRole('option', { name: 'Drinks', exact: true }).count()).toBe(0)
    await chooseOption(page, 'Drinks › Espresso')
    await typePrice(form.getByRole('spinbutton', { name: 'Price' }), '4.2')
    await form.getByRole('combobox', { name: 'Availability', exact: true }).click()
    await page.getByRole('option', { name: 'Breakfast' }).click()
    await page.keyboard.press('Escape') // close the multi-select list
    await form.getByRole('button', { name: 'Create', exact: true }).click()

    await toast(page, 'Menu item "Mocha" created as a draft').waitFor()
    expect(body).toEqual({
      categoryId: ESPRESSO.id,
      name: 'Mocha',
      description: '',
      imageId: UPLOADED_PHOTO.id,
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
    await form.getByRole('combobox', { name: 'Category', exact: true }).click()
    await chooseOption(page, 'Tea')

    await addFromMenu(form, 'Add option set', 'Size')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small' }), '3')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Large' }), '4')
    await addFromMenu(form, 'Add option set', 'Temperature')
    // The second set makes a 2 × 2 grid; the new combinations have no price yet.
    await form.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.poll(() => form.getByText('Set a price, or switch it off').count()).toBe(4)
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small, Hot' }), '3')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small, Iced' }), '3.25')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Large, Hot' }), '4')
    await form.getByRole('switch', { name: 'Sell Large, Iced' }).click()
    // No more option sets than two.
    expect(await form.getByRole('button', { name: 'Add option set' }).isDisabled()).toBe(true)
    await form.getByRole('button', { name: 'Create', exact: true }).click()

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
    await form.getByRole('button', { name: 'Save', exact: true }).click()

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
    await form.getByRole('button', { name: 'Save', exact: true }).click()
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
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await form.getByText('Someone else saved this menu item').waitFor()
    expect(await form.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte 2')
  })

  it('someone else saved first: Reload takes their version and keeps my changes on top, then Save names their version (D153)', async () => {
    let saved = LATTE
    const bodies: Record<string, unknown>[] = []
    const { page } = await open({
      ...backend(),
      'GET /admin/menu/items/{id}': () => saved,
      'PATCH /admin/menu/items/{id}': (request) => {
        const body = request.body as Record<string, unknown>
        bodies.push(body)
        if (body.version !== saved.version) throw failures.conflict('VERSION_CONFLICT', 'This menu item was changed by someone else.')
        saved = { ...saved, name: String(body.name), version: saved.version + 1 }
        return saved
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByLabel('Name', { exact: true }).fill('Caffè Latte')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Large, Hot' }), '4.5')
    // Meanwhile, someone else: a new description and other prices.
    saved = {
      ...LATTE,
      description: 'Double shot and steamed milk',
      variations: LATTE.variations.map(variation => ({ ...variation, priceMinor: (variation.priceMinor ?? 0) + 25 })),
      version: 4,
    }
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    const conflict = form.getByText('Someone else saved this menu item')
    await conflict.waitFor()

    await form.getByRole('button', { name: 'Reload' }).click()
    await form.getByText('Loaded the latest version').waitFor()
    await form.getByText('You both changed the prices: yours are kept. Check them, then save.').waitFor()
    expect(await conflict.count()).toBe(0)
    // Mine on top (the name, and the prices I edited), theirs where I changed nothing (the description).
    expect(await form.getByLabel('Name', { exact: true }).inputValue()).toBe('Caffè Latte')
    expect(await form.getByLabel('Description').inputValue()).toBe('Double shot and steamed milk')
    expect(await form.getByRole('spinbutton', { name: 'Price of Large, Hot' }).inputValue()).toBe('$4.50')

    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await toast(page, 'Menu item "Caffè Latte" updated').waitFor()
    expect(bodies.at(-1)).toMatchObject({ version: 4, name: 'Caffè Latte', description: 'Double shot and steamed milk' })
  })

  it('Reload with nothing changed by both says their changes are in, and the form still asks before closing', async () => {
    let saved = LATTE
    const { page } = await open({
      ...backend(),
      'GET /admin/menu/items/{id}': () => saved,
      'PATCH /admin/menu/items/{id}': () => {
        throw failures.conflict('VERSION_CONFLICT', 'This menu item was changed by someone else.')
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByLabel('Name', { exact: true }).fill('Caffè Latte')
    saved = { ...LATTE, description: 'Double shot and steamed milk', version: 4 }
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await form.getByRole('button', { name: 'Reload' }).click()
    await form.getByText('Their changes are in the form, with yours kept. Save to keep both.').waitFor()
    // Still unsaved: my name over their version.
    await form.getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('Reload when someone archived the item meanwhile: says so and keeps the input', async () => {
    let saved = LATTE
    const { page } = await open({
      ...backend(),
      'GET /admin/menu/items/{id}': () => saved,
      'PATCH /admin/menu/items/{id}': () => {
        throw failures.conflict('VERSION_CONFLICT', 'This menu item was changed by someone else.')
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByLabel('Name', { exact: true }).fill('Caffè Latte')
    saved = { ...LATTE, status: 'archived', version: 4 }
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await form.getByRole('button', { name: 'Reload' }).click()
    await form.getByText('Someone archived this menu item meanwhile.', { exact: false }).waitFor()
    expect(await form.getByLabel('Name', { exact: true }).inputValue()).toBe('Caffè Latte')
  })

  it('maps a server error on a version\'s price to its cell', async () => {
    const { page } = await open({
      ...backend(),
      'PATCH /admin/menu/items/{id}': () => {
        throw failures.validation('A version that\'s on needs a price', { 'variations.2.priceMinor': ['A version that\'s on needs a price'] })
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
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
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => body?.imageId).toBeNull()
  })

  it('the photo editor refuses a file that isn\'t a photo, one over 25 MB, or one it can\'t open, without uploading (D158)', async () => {
    const { page, api } = await open()
    const form = await openNew(page)
    const editor = await openPhotoEditor(form)
    await choosePhoto(editor, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') })
    await editor.getByText('Use a JPEG, PNG or WebP photo.').waitFor()
    await choosePhoto(editor, { name: 'enormous.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) })
    await editor.getByText('This photo is larger than 25 MB. Choose a smaller one.').waitFor()
    await choosePhoto(editor, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') })
    await editor.getByText('This photo can\'t be opened here. Save it as a JPEG or PNG, or choose another one.').waitFor()
    expect(await editor.getByRole('button', { name: 'Use photo' }).isDisabled()).toBe(true)
    expect(api.calls.filter(c => c.includes('media'))).toEqual([])
  })

  it('makes the photo\'s files in the browser at their sizes, as framed; the item page follows the menu card (D158, D161)', async () => {
    const { page } = await open()
    const uploads = await capturePhotoUpload(page)
    const form = await openNew(page)
    await form.getByLabel('Name', { exact: true }).fill('Mocha')
    const editor = await openPhotoEditor(form)
    // A 3200 × 2400 photo: the source is kept at 2400 px at most.
    await choosePhoto(editor, await photoFile(page, 3200, 2400))
    await editor.getByTestId('photo-frame').waitFor()
    // Both previews, with the item's name.
    for (const view of ['card', 'detail']) await expect.poll(() => editor.getByTestId(`photo-preview-${view}`).getByText('Mocha').isVisible()).toBe(true)
    // The menu card framed by hand: the photo moved right, as far as it goes.
    await editor.getByTestId('photo-frame').focus()
    for (let press = 0; press < 20; press++) await page.keyboard.press('ArrowRight')
    await editor.getByRole('button', { name: 'Use photo' }).click()
    await editor.waitFor({ state: 'hidden' })

    const body = uploads[0]!
    expect(await imageSizeOf(page, partOf(body, 'source'))).toEqual([2400, 1800])
    expect(await imageSizeOf(page, partOf(body, 'card'))).toEqual([480, 480])
    expect(await imageSizeOf(page, partOf(body, 'detail'))).toEqual([1200, 900])
    expect(await imageSizeOf(page, partOf(body, 'detailSmall'))).toEqual([600, 450])
    expect(body.toString('latin1')).toContain('Content-Type: image/webp')
    const edit = JSON.parse(partOf(body, 'edit').toString())
    // The square shows the photo's left part; its middle is the point the item page follows.
    expect(edit.card).toMatchObject({ zoom: 1, adjusted: true })
    expect(edit.card.x).toBeCloseTo(0.375, 2)
    expect(edit.focus.x).toBeCloseTo(0.375, 2)
    // A 4:3 photo fills the item page whole wherever that point is.
    expect(edit.detail).toMatchObject({ zoom: 1, adjusted: false })
    expect(partOf(body, 'placeholder').toString()).toMatch(/^data:image\/(webp|jpeg);base64,/)
  }, 60_000)

  it('a big photo is made smaller while it opens, the same shape (D160)', async () => {
    const { page } = await open()
    // Record how the editor asks the browser to open photos.
    await page.evaluate(() => {
      const opened: unknown[] = []
      ;(window as unknown as { opened: unknown[] }).opened = opened
      const original = window.createImageBitmap.bind(window)
      window.createImageBitmap = ((image: ImageBitmapSource, options?: ImageBitmapOptions) => {
        opened.push(options ?? null)
        return original(image, options)
      }) as typeof window.createImageBitmap
    })
    const uploads = await capturePhotoUpload(page)
    const form = await openNew(page)
    const editor = await openPhotoEditor(form)
    // 6000 × 4000 = 24 MP: opened at 2400 px wide instead of whole.
    await choosePhoto(editor, await photoFile(page, 6000, 4000))
    await editor.getByTestId('photo-frame').waitFor()
    expect(await page.evaluate(() => (window as unknown as { opened: unknown[] }).opened)).toContainEqual({ imageOrientation: 'from-image', resizeWidth: 2400, resizeQuality: 'high' })
    await editor.getByRole('button', { name: 'Use photo' }).click()
    await editor.waitFor({ state: 'hidden' })
    await expect.poll(() => uploads.length).toBe(1)
    expect(await imageSizeOf(page, partOf(uploads[0]!, 'source'))).toEqual([2400, 1600])
  }, 60_000)

  it('the frame moves and zooms with the keyboard; Rotate turns the photo; a small photo is warned about (D158, D161)', async () => {
    const { page } = await open()
    const uploads = await capturePhotoUpload(page)
    const form = await openNew(page)
    const editor = await openPhotoEditor(form)
    // 800 × 600: under 900 px on its short side.
    await choosePhoto(editor, await photoFile(page, 800, 600))
    await editor.getByText('This photo is small').waitFor()
    const frame = editor.getByTestId('photo-frame')
    await editor.getByRole('button', { name: 'Rotate right' }).click()
    await expect.poll(() => frame.getAttribute('data-photo')).toBe('600x800')

    // The menu card is framed first.
    await frame.focus()
    await page.keyboard.press('+')
    await page.keyboard.press('+')
    await page.keyboard.press('ArrowLeft')
    await editor.getByRole('button', { name: 'Use photo' }).click()
    await editor.waitFor({ state: 'hidden' })

    const body = uploads[0]!
    expect(await imageSizeOf(page, partOf(body, 'source'))).toEqual([600, 800])
    const edit = JSON.parse(partOf(body, 'edit').toString())
    expect(edit.card.adjusted).toBe(true)
    expect(edit.card.zoom).toBeCloseTo(1.2)
    expect(edit.detail.adjusted).toBe(false)
    // A tall photo stays whole on the item page: zoomed out to fit, the fill colour around it.
    expect(edit.detail.zoom).toBeLessThan(1)
  }, 60_000)

  it('a preview frames its view; framing the item page stops it following the menu card, and Reset suggests it again (D161)', async () => {
    const { page } = await open()
    const uploads = await capturePhotoUpload(page)
    const form = await openNew(page)
    const editor = await openPhotoEditor(form)
    // 1500 × 1000 (3:2): a little wider than 4:3, so the item page is a crop too.
    await choosePhoto(editor, await photoFile(page, 1500, 1000))
    const frame = editor.getByTestId('photo-frame')
    await frame.waitFor()
    expect(await editor.getByRole('button', { name: 'Reset' }).isDisabled()).toBe(true)
    // Edit crop on the item page's preview frames it: a 4:3 frame.
    await editor.getByRole('button', { name: 'Frame the item page' }).click()
    // The item page's card says Editing, the tab is chosen, and the menu card offers Edit crop.
    await editor.getByTestId('photo-preview-detail').getByText('Editing').waitFor()
    expect(await editor.getByRole('tab', { name: 'Item page' }).getAttribute('aria-selected')).toBe('true')
    await editor.getByRole('button', { name: 'Frame the menu card' }).waitFor()
    await expect.poll(async () => {
      const box = (await frame.boundingBox())!
      return Math.round((box.width / box.height) * 100) / 100
    }).toBe(1.33)
    await frame.focus()
    for (let press = 0; press < 5; press++) await page.keyboard.press('ArrowLeft')
    await editor.getByRole('button', { name: 'Reset' }).click()
    await frame.focus()
    for (let press = 0; press < 5; press++) await page.keyboard.press('ArrowLeft')
    // Back to the menu card by its tab: moving it leaves the framed item page where it is.
    await editor.getByRole('tab', { name: 'Menu card' }).click()
    await frame.focus()
    for (let press = 0; press < 5; press++) await page.keyboard.press('ArrowRight')
    await editor.getByRole('button', { name: 'Use photo' }).click()
    await editor.waitFor({ state: 'hidden' })

    const edit = JSON.parse(partOf(uploads[0]!, 'edit').toString())
    expect(edit.detail.adjusted).toBe(true)
    expect(edit.detail.x).toBeGreaterThan(0.5)
    expect(edit.card.adjusted).toBe(true)
    expect(edit.card.x).toBeLessThan(0.5)
  }, 60_000)

  it('opens again after being closed, any number of times (D158)', async () => {
    const { page } = await open()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const form = await openNew(page)
    for (let time = 0; time < 3; time++) {
      const editor = await openPhotoEditor(form)
      await editor.getByRole('button', { name: 'Cancel' }).click()
      await editor.waitFor({ state: 'hidden' })
    }
    expect(errors).toEqual([])
  })

  it('Edit photo opens the saved photo with how it was made (D158)', async () => {
    const { page } = await open()
    const saved = { focus: { x: 0.5, y: 0.5 }, card: { zoom: 2, x: 0.5, y: 0.5, adjusted: true }, detail: { zoom: 1, x: 0.5, y: 0.5, adjusted: false }, fill: '#e9dcc9' }
    await routeSavedPhoto(page, saved)
    const form = await openEdit(page, 'Latte')
    const editor = await openPhotoEditor(form, 'Edit photo')
    await editor.getByTestId('photo-frame').waitFor()
    // Opened as saved: the menu card at its zoom.
    await expect.poll(() => editor.getByRole('slider', { name: 'Zoom' }).getAttribute('aria-valuenow')).toBe('2')
    // Nothing changed: Cancel closes without asking.
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await editor.waitFor({ state: 'hidden' })
  }, 60_000)

  it('Use photo closes the editor at once; the upload shows on the preview, Save waits, Edit photo reopens it from memory, and a failed upload offers Try again (D158)', async () => {
    const { page } = await open()
    let answer: 'hold' | 'fail' | 'ok' = 'hold'
    const held: (() => void)[] = []
    let uploads = 0
    await page.route('**/api/c/nuk/admin/media/photos', async (route) => {
      uploads++
      if (answer === 'hold') await new Promise<void>(resolve => held.push(resolve))
      if (answer === 'fail') {
        const message = 'Telegram is down'
        await route.fulfill({ status: 503, json: { error: true, statusCode: 503, message, data: { code: 'UNAVAILABLE', message } } })
        return
      }
      await route.fulfill({ status: 201, json: UPLOADED_PHOTO })
    })
    await routeSavedPhoto(page)
    let reads = 0
    page.on('request', (request) => {
      if (request.url().includes('/media/photos/asset-latte')) reads++
    })
    const form = await openEdit(page, 'Latte')
    let editor = await openPhotoEditor(form, 'Edit photo')
    await editor.getByRole('button', { name: 'Choose another' }).waitFor()
    await choosePhoto(editor, await photoFile(page, 1600, 1200), 'Choose another')
    await editor.getByTestId('photo-frame').waitFor()
    await editor.getByRole('button', { name: 'Use photo' }).click()
    await editor.waitFor({ state: 'hidden' })

    // Uploading: the new photo on the preview with a spinner, and Save waits for it.
    await form.getByText('Uploading the photo… You can keep editing.').waitFor()
    await form.getByTestId('photo-upload-state').waitFor()
    expect(await form.getByRole('img', { name: 'Menu item photo' }).getAttribute('src')).toMatch(/^blob:/)
    await form.getByText('Waiting for the photo upload…').waitFor()
    expect(await form.getByRole('button', { name: 'Save', exact: true }).isDisabled()).toBe(true)

    // Closing the form meanwhile asks first: the photo isn't in the form yet (D160).
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await page.getByText('Discard unsaved changes?').waitFor({ state: 'hidden' })

    // Edit photo meanwhile: the same photo, from memory (no request for the saved one).
    const readsBefore = reads
    editor = await openPhotoEditor(form, 'Edit photo')
    await editor.getByTestId('photo-frame').waitFor()
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await editor.waitFor({ state: 'hidden' })
    expect(reads).toBe(readsBefore)

    // It fails: said on the preview; Try again uploads the same photo.
    answer = 'fail'
    held.splice(0).forEach(release => release())
    await form.getByText('The photo didn\'t upload. Try again, or Cancel to keep the photo it had.').waitFor()
    // Save waits for a decision: the photo again, or Cancel (D160).
    await form.getByText('The photo didn\'t upload: Try again, or Cancel it, before saving.').waitFor()
    expect(await form.getByRole('button', { name: 'Save', exact: true }).isDisabled()).toBe(true)
    answer = 'ok'
    await form.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => form.getByRole('img', { name: 'Menu item photo' }).getAttribute('src')).toBe(UPLOADED_PHOTO.image.card)
    expect(uploads).toBe(2)
    await form.getByText('Shown square on the menu and 4:3 on the item\'s page.').waitFor()
  }, 60_000)

  it('a failed upload\'s Cancel keeps the photo the item had (D158)', async () => {
    const { page } = await open()
    await page.route('**/api/c/nuk/admin/media/photos', (route) => {
      const message = 'Busy'
      return route.fulfill({ status: 503, json: { error: true, statusCode: 503, message, data: { code: 'UNAVAILABLE', message } } })
    })
    await routeSavedPhoto(page)
    const form = await openEdit(page, 'Latte')
    const editor = await openPhotoEditor(form, 'Edit photo')
    await editor.getByRole('button', { name: 'Choose another' }).waitFor()
    await choosePhoto(editor, await photoFile(page, 1600, 1200), 'Choose another')
    await editor.getByTestId('photo-frame').waitFor()
    await editor.getByRole('button', { name: 'Use photo' }).click()
    await form.getByRole('button', { name: 'Try again' }).waitFor()
    await form.getByRole('button', { name: 'Cancel', exact: true }).first().click()
    await expect.poll(() => form.getByRole('img', { name: 'Menu item photo' }).getAttribute('src')).toBe('/media/menu/latte.png')
    // Back to the photo it had: nothing unsaved, Save works again (D160).
    expect(await form.getByRole('button', { name: 'Save', exact: true }).isDisabled()).toBe(false)
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await form.waitFor({ state: 'hidden' })
  }, 60_000)

  it('a changed price counts as unsaved: closing asks first', async () => {
    const { page } = await open()
    const form = await openEdit(page, 'Latte')
    await typePrice(form.getByRole('spinbutton', { name: 'Price of Small, Hot' }), '9')
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})

describe('publishing from the form (D125)', () => {
  /** A draft with a priced version: the form can save it. */
  const CHAI = menuItemOf('item-4', 'Chai')
  const withChai = () => backend([LATTE_ROW, MATCHA_ROW, summaryOf(CHAI)], [LATTE, MATCHA, CHAI])

  it('opening the form, new or to edit, raises no error in the page', async () => {
    const { page } = await open()
    const errors: string[] = []
    // The app's error handler catches it (and toasts "Unexpected error"), so it shows as a console error.
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    const created = await openNew(page)
    await created.getByLabel('Name', { exact: true }).waitFor()
    await created.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await created.waitFor({ state: 'hidden' })
    await openEdit(page, 'Matcha')
    await page.waitForTimeout(300)
    expect(errors).toEqual([])
  })

  it('Create and publish: saves, then publishes the version the save returned, with one toast', async () => {
    let published: unknown
    const { page, api } = await open({
      ...backend(),
      'POST /admin/menu/items': () => menuItemOf('item-9', 'Mocha', { version: 1 }),
      'POST /admin/menu/items/{id}/publish': ({ body }) => {
        published = body
        return menuItemOf('item-9', 'Mocha', { status: 'active', version: 2 })
      },
    })
    const form = await openNew(page)
    await form.getByLabel('Name', { exact: true }).fill('Mocha')
    await form.getByRole('combobox', { name: 'Category', exact: true }).click()
    await chooseOption(page, 'Tea')
    await typePrice(form.getByRole('spinbutton', { name: 'Price' }), '4.2')
    await form.getByRole('button', { name: 'Create and publish' }).click()

    await toast(page, 'Menu item "Mocha" published').waitFor()
    await form.waitFor({ state: 'hidden' })
    expect(await toast(page, 'Menu item "Mocha" created as a draft').count()).toBe(0)
    const writes = api.calls.filter(call => call.startsWith('POST /admin/menu/items'))
    expect(writes).toEqual(['POST /admin/menu/items', 'POST /admin/menu/items/item-9/publish'])
    expect(published).toEqual({ version: 1 })
  })

  it('Save and publish on a draft: a refused publish leaves it saved as a draft, and the toast says why', async () => {
    let published: unknown
    const { page } = await open({
      ...withChai(),
      'PATCH /admin/menu/items/{id}': () => ({ ...CHAI, name: 'Chai latte', version: 5 }),
      'POST /admin/menu/items/{id}/publish': ({ body }) => {
        published = body
        throw failures.validation('This category holds sub-categories: move the item to one of them.')
      },
    })
    const form = await openEdit(page, 'Chai')
    await form.getByLabel('Name', { exact: true }).fill('Chai latte')
    await form.getByRole('button', { name: 'Save and publish' }).click()
    await toast(page, '"Chai latte" was saved as a draft, but not published').waitFor()
    await page.getByText('This category holds sub-categories: move the item to one of them.').first().waitFor()
    await form.waitFor({ state: 'hidden' })
    expect(published).toEqual({ version: 5 })
  })

  it('a published item has only Save; Save on a draft doesn\'t publish', async () => {
    const { page, api } = await open({ ...withChai(), 'PATCH /admin/menu/items/{id}': () => CHAI })
    let form = await openEdit(page, 'Latte')
    expect(await form.getByRole('button', { name: 'Save and publish' }).count()).toBe(0)
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await form.waitFor({ state: 'hidden' })

    form = await openEdit(page, 'Chai')
    await form.getByLabel('Name', { exact: true }).fill('Chai 2')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await toast(page, 'Menu item "Chai 2" updated').waitFor()
    expect(api.calls.some(call => call.endsWith('/publish'))).toBe(false)
  })
})

// View on menu (D145): a published item opens on the customer menu, in a new tab, with its detail open.
describe('View on menu', () => {
  it('opens a published item on the customer menu in a new tab, from its form and its row', async () => {
    const { page } = await open()
    const form = await openEdit(page, 'Latte')
    const view = form.getByRole('link', { name: 'View on menu (opens in a new tab)' })
    expect([await view.getAttribute('href'), await view.getAttribute('target')]).toEqual(['/c/nuk?item=item-1', '_blank'])
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await form.waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Actions for Latte' }).click()
    const row = page.getByRole('menuitem', { name: 'View on menu' })
    expect([await row.getAttribute('href'), await row.getAttribute('target')]).toEqual(['/c/nuk?item=item-1', '_blank'])
  })

  it('a draft isn\'t on the menu: the button is disabled and says why, the row offers nothing', async () => {
    const { page } = await open()
    const form = await openEdit(page, 'Matcha')
    const view = form.getByRole('button', { name: 'View on menu: Publish it to see it on the menu' })
    expect(await view.isDisabled()).toBe(true)
    expect(await form.getByRole('link', { name: /View on menu/ }).count()).toBe(0)
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await form.waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Actions for Matcha' }).click()
    await page.getByRole('menuitem', { name: 'Publish' }).waitFor()
    expect(await page.getByRole('menuitem', { name: 'View on menu' }).count()).toBe(0)
  })
})

describe('menu item editor URLs (D90, decision 4)', () => {
  const params = (page: Page) => new URL(page.url()).searchParams

  it('from sm the list opens the slide-over at ?item= (filters kept); Back closes it, resizing changes nothing', async () => {
    const { page } = await open(backend(), 'Matcha', '/c/nuk/admin/products?status=draft')
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

  it('the slide-over is as wide as max-w-2xl from sm (Nuxt UI 4.12 caps the width with sm:max-w-md)', async () => {
    const { page } = await open()
    await page.setViewportSize({ width: 1280, height: 800 })
    const form = await openEdit(page, 'Latte')
    // 42rem = 672px; the Nuxt UI default would leave 448px.
    await expect.poll(async () => Math.round((await form.boundingBox())?.width ?? 0)).toBe(672)

    // Under sm it takes the screen, as before.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => Math.round((await form.boundingBox())?.width ?? 0)).toBe(390)
  })

  it('closing the slide-over removes only `item`, and asks only once about unsaved input', async () => {
    const { page } = await open(backend(), 'Matcha', '/c/nuk/admin/products?status=draft')
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
    await page.goto(url('/c/nuk/admin/products?status=active'), { waitUntil: 'hydration' })
    await cardOf(page, 'Latte').click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/products/item-1')
    await expect.poll(() => page.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte')
    expect(await page.title()).toBe('Menu item · NUK Cafe Admin')
    // One section at a time.
    expect(await page.getByRole('region', { name: 'Options and prices' }).isVisible()).toBe(false)
    await page.getByRole('tab', { name: 'Prices' }).click()
    await page.getByRole('region', { name: 'Options and prices' }).waitFor()
    expect(await page.getByLabel('Name', { exact: true }).isVisible()).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.getByRole('button', { name: 'Back to Menu items' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/products')
    expect(params(page).get('status')).toBe('active')
  })

  it('an invalid field in a hidden section shows its section (phones, a new item at /products/new)', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, backend())
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'New menu item' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/products/new')
    await page.getByRole('tab', { name: 'Availability' }).click()
    await page.getByRole('toolbar', { name: 'Save', exact: true }).getByRole('button', { name: 'Create', exact: true }).click()
    await page.getByText('Name is required').waitFor()
    expect(await page.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true')
    // The invalid field is focused (and so scrolled into view) once its section is shown.
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('name') ?? document.activeElement?.id)).toBeTruthy()
    expect(await page.getByLabel('Name', { exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
  })

  it('/c/nuk/admin/products/<id> opens the item at every width; Save sends the version read and returns to the list', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend(),
      'PATCH /admin/menu/items/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return { ...LATTE, name: 'Latte 2', version: 4 }
      },
    }, '', '/c/nuk/admin/products/item-1')
    // Wide: every section at once, Save in the navbar.
    await expect.poll(() => page.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte')
    await page.getByRole('region', { name: 'Options and prices' }).waitFor()
    expect(await page.getByRole('tab', { name: 'Prices' }).count()).toBe(0)
    await page.getByLabel('Name', { exact: true }).fill('Latte 2')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await toast(page, 'Menu item "Latte 2" updated').waitFor()
    expect(body).toMatchObject({ version: 3, name: 'Latte 2' })
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/products')
  })

  it('leaving /products/<id> with unsaved input asks first', async () => {
    const { page } = await open(backend(), '', '/c/nuk/admin/products/item-1')
    await expect.poll(() => page.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte')
    await page.getByLabel('Name', { exact: true }).fill('Latte 2')
    await page.getByRole('link', { name: 'Categories' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    expect(new URL(page.url()).pathname).toBe('/c/nuk/admin/products/item-1')
  })
})

describe('reordering a category\'s items (step 10.3, D118)', () => {
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
    await dialog.getByRole('combobox', { name: 'Category', exact: true }).click()
    await chooseOption(page, 'Tea')
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
    const handlers = reorderBackend(() => {
      throw failures.conflict('ITEMS_CHANGED', 'These menu items were changed by someone else.')
    })
    const read = handlers['GET /admin/menu/items']!
    const reloadRead = deferred()
    let holdReads = false
    handlers['GET /admin/menu/items'] = ((input: Parameters<MockHandler>[0]) => (holdReads ? reloadRead.handler(input) : read(input))) as MockHandler
    const { page } = await open(handlers)
    const dialog = await openReorder(page)
    await dialog.getByRole('button', { name: 'Move Chai down' }).click()
    await dialog.getByRole('button', { name: 'Save order' }).click()
    await dialog.getByText('Someone changed these items meanwhile').waitFor()

    // While the latest order loads, the refused one stays refused: the alert stays and Save is off.
    holdReads = true
    await dialog.getByRole('button', { name: 'Reload' }).click()
    await reloadRead.started()
    await dialog.getByText('Someone changed these items meanwhile').waitFor()
    expect(await dialog.getByRole('button', { name: 'Save order' }).isDisabled()).toBe(true)

    reloadRead.release(read({ url: new URL('http://localhost/api/admin/menu/items?categoryId=cat-1') } as Parameters<MockHandler>[0]))
    await expect.poll(() => dialog.getByText('Someone changed these items meanwhile').count()).toBe(0)
    expect(await dialog.getByRole('listitem').first().getAttribute('aria-label')).toBe('Chai')
    expect(await dialog.getByRole('button', { name: 'Save order' }).isDisabled()).toBe(true)
  })

  it('closing with a move asks first', async () => {
    const { page } = await open(reorderBackend(() => null))
    const dialog = await openReorder(page)
    await dialog.getByRole('button', { name: 'Move Chai down' }).click()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})

describe('the toolbar and Select mode at every width (D129)', () => {
  /** The toolbar's box and whether it, the page or the bulk bar scrolls sideways. */
  const layout = (page: Page) => page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('[data-list-toolbar]')
    const bar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Bulk actions"]')
    const count = bar?.querySelector<HTMLElement>('span.font-semibold')
    return {
      pageSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      toolbarSideways: toolbar ? toolbar.scrollWidth > toolbar.clientWidth : false,
      barSideways: bar ? bar.scrollWidth > bar.clientWidth : false,
      /** The count's line: one line of text, not a word per line. */
      countLines: count ? Math.round(count.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(count).lineHeight)) : 0,
    }
  })

  async function openAt(width: number) {
    const page = await createPage()
    await page.setViewportSize({ width, height: 800 })
    await mockApi(page, backend())
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await cardOf(page, 'Latte').waitFor()
    return page
  }

  it('the Select button is a toggle: Cancel leaves the mode where it started', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await cardOf(page, 'Matcha').click()
    await bar.getByText('1 selected').waitFor()
    // No ✕ in the bar: it carries actions only.
    expect(await bar.getByRole('button', { name: /Exit|Cancel/ }).count()).toBe(0)
    await page.getByRole('button', { name: 'Cancel selection' }).click()
    await bar.waitFor({ state: 'detached' })
    expect(await page.getByRole('checkbox').count()).toBe(0)
    await page.getByRole('button', { name: 'Select', exact: true }).waitFor()
    // S toggles too.
    await page.keyboard.press('s')
    await bar.waitFor()
    await page.keyboard.press('s')
    await bar.waitFor({ state: 'detached' })
  })

  it('on a phone: search on its own line, Reorder and Select behind ⋯, Cancel in its place while selecting; the bar on two lines', async () => {
    const page = await openAt(390)
    const search = await page.getByRole('searchbox', { name: 'Search menu items…' }).boundingBox()
    const category = await page.getByRole('combobox', { name: 'Category', exact: true }).boundingBox()
    expect(category!.y).toBeGreaterThan(search!.y + search!.height - 1)
    expect(search!.width).toBeGreaterThan(300)
    expect(await page.getByRole('button', { name: 'Select', exact: true }).count()).toBe(0)

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Select' }).click()
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await bar.getByText('None selected').waitFor()
    await cardOf(page, 'Matcha').click()
    await bar.getByText('1 selected').waitFor()
    expect(await layout(page)).toMatchObject({ pageSideways: false, toolbarSideways: false, barSideways: false, countLines: 1 })
    // The actions share one row under the count.
    const publish = (await bar.getByRole('button', { name: /^Publish/ }).boundingBox())!
    const archive = (await bar.getByRole('button', { name: 'Archive selected' }).boundingBox())!
    expect(Math.abs(publish.y - archive.y)).toBeLessThan(2)
    expect(Math.abs(publish.width - archive.width)).toBeLessThan(2)

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await bar.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'More actions' }).waitFor()
  })

  for (const width of [320, 680, 768, 1024, 1440]) {
    it(`nothing scrolls sideways at ${width} px, in Select mode too`, async () => {
      const page = await openAt(width)
      expect(await layout(page)).toMatchObject({ pageSideways: false, toolbarSideways: false })
      if (width < 640) {
        await page.getByRole('button', { name: 'More actions' }).click()
        await page.getByRole('menuitem', { name: 'Select' }).click()
      }
      else {
        await page.getByRole('button', { name: 'Select', exact: true }).click()
      }
      await cardOf(page, 'Matcha').click()
      await page.getByRole('toolbar', { name: 'Bulk actions' }).getByText('1 selected').waitFor()
      expect(await layout(page)).toMatchObject({ pageSideways: false, toolbarSideways: false, barSideways: false, countLines: 1 })
    })
  }
})

// Duplicate (D154): a new item filled from another one, without its photo, created as a draft.
describe('Duplicate', () => {
  it('opens a new item filled from the row\'s item, named "… (copy)" without the photo, and creates it as a draft', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend(),
      'POST /admin/menu/items': (request) => {
        body = request.body as Record<string, unknown>
        return menuItemOf('item-9', 'Latte (copy)')
      },
    })
    await page.getByRole('button', { name: 'Actions for Latte' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    const form = page.getByRole('dialog', { name: 'New menu item' })
    await expect.poll(() => form.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte (copy)')
    await form.getByText('A copy of "Latte", without its photo.', { exact: false }).first().waitFor()
    expect(await form.locator('img').count()).toBe(0)
    expect(await form.getByRole('spinbutton', { name: 'Price of Large, Hot' }).inputValue()).toBe('$4.25')

    await form.getByRole('button', { name: 'Create', exact: true }).click()
    await toast(page, 'Menu item "Latte (copy)" created as a draft').waitFor()
    expect(body).toEqual({
      categoryId: ESPRESSO.id,
      name: 'Latte (copy)',
      description: 'Espresso and milk',
      imageId: null,
      optionSetIds: [SIZE.id, TEMP.id],
      variations: [
        { valueIds: ['val-s', 'val-hot'], priceMinor: 350, status: 'active' },
        { valueIds: ['val-s', 'val-iced'], priceMinor: 375, status: 'active' },
        { valueIds: ['val-l', 'val-hot'], priceMinor: 425, status: 'active' },
        { valueIds: ['val-l', 'val-iced'], priceMinor: 450, status: 'disabled' },
      ],
      modifierGroups: [{ groupId: MILK.id, rules: null, prices: [{ modifierId: 'mod-soy', priceDeltaMinor: 60 }] }],
      availabilityRuleIds: [],
    })
  })

  it('a copy counts as unsaved: closing it asks first', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Actions for Latte' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    const form = page.getByRole('dialog', { name: 'New menu item' })
    await expect.poll(() => form.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte (copy)')
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('on phones it opens /products/new?copy=<id>', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, backend())
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Actions for Latte' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBe('/c/nuk/admin/products/new?copy=item-1')
    await expect.poll(() => page.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte (copy)')
  })
})

describe('items without a photo (D160)', () => {
  const TEA = menuItemOf('item-5', 'Tea')
  const CHAI = menuItemOf('item-6', 'Chai')
  const rows = [LATTE_ROW, MATCHA_ROW, summaryOf(TEA), summaryOf(CHAI)]

  it('says how many items have no photo; Show them filters the list, and the filter can be removed', async () => {
    const { page } = await open(backend(rows, [LATTE, MATCHA, TEA, CHAI]))
    await page.getByText('3 menu items have no photo.').waitFor()
    await page.getByRole('button', { name: 'Show them' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('photo')).toBe('missing')
    await cardOf(page, 'Matcha').waitFor()
    await cardOf(page, 'Latte').waitFor({ state: 'detached' })
    await page.getByText('3 menu items have no photo.').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'No photo: remove this filter' }).click()
    await cardOf(page, 'Latte').waitFor()
    expect(new URL(page.url()).searchParams.get('photo')).toBeNull()
  })

  it('with the filter on, Save is Save and next: it opens the next item on the page; the last one says Save', async () => {
    const saved: string[] = []
    const { page } = await open({
      ...backend(rows, [LATTE, MATCHA, TEA, CHAI]),
      'PATCH /admin/menu/items/{id}': ({ url: address }) => {
        const item = [TEA, CHAI].find(i => i.id === address.pathname.split('/').pop())!
        saved.push(item.name)
        return { ...item, version: item.version + 1 }
      },
    }, 'Matcha', '/c/nuk/admin/products?photo=missing')
    await openEdit(page, 'Tea')
    let form = page.getByRole('dialog', { name: 'Edit menu item' })
    expect(await form.getByLabel('Name', { exact: true }).inputValue()).toBe('Tea')
    await form.getByRole('button', { name: 'Save and next' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBe(CHAI.id)
    form = page.getByRole('dialog', { name: 'Edit menu item' })
    await expect.poll(() => form.getByLabel('Name', { exact: true }).inputValue()).toBe('Chai')
    expect(saved).toEqual(['Tea'])
    // The last item on the page: an ordinary Save, which closes.
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBeNull()
    expect(saved).toEqual(['Tea', 'Chai'])
  })
})
