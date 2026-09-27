import type { Locator, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { Product, ScheduleOption, VariantGroup } from '../../shared/contracts/menu'
import type { MockHandler } from './support/mock-api'
import { COFFEE, deferred, failures, lastSegment, mockApi, paginatedHandler, productOf, setupE2e, TEA, toast } from './support/mock-api'

// Menu items (products): list, filters, create with an image upload, edit (variants with stable
// ids, schedules, image), delete. Prices are cents in the API and dollars on screen.
await setupE2e()

const MILK: VariantGroup = {
  id: 'grp-43',
  name: 'Milk',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'opt-73', name: 'Whole', priceDeltaMinor: 0 },
    { id: 'opt-74', name: 'Oat', priceDeltaMinor: 50 },
  ],
}
const LATTE = productOf('prod-1', 'Latte', COFFEE, {
  description: 'Espresso and milk',
  priceMinor: 350,
  image: { id: 'asset-latte', url: '/media/menu/latte.png' },
  scheduleIds: ['sched-30'],
  variantGroups: [MILK],
  version: 3,
})
const MATCHA = productOf('prod-2', 'Matcha', TEA, { priceMinor: 425, status: 'INACTIVE' })

const BREAKFAST: ScheduleOption = { id: 'sched-30', name: 'Breakfast', status: 'ACTIVE' }
const LUNCH: ScheduleOption = { id: 'sched-31', name: 'Lunch', status: 'ACTIVE' }
const RETIRED: ScheduleOption = { id: 'sched-32', name: 'Old promo', status: 'INACTIVE' }

const UPLOADED = { id: 'asset-new', url: '/media/menu/new.png' }

function backend(initial: Product[] = [LATTE, MATCHA]) {
  let rows = [...initial]
  const handlers: Record<string, MockHandler> = {
    'GET /admin/products': paginatedHandler(() => rows),
    'GET /admin/categories': () => [TEA, COFFEE],
    'GET /admin/schedules/options': () => [BREAKFAST, LUNCH, RETIRED],
    'DELETE /admin/products/{id}': ({ url }) => {
      rows = rows.filter(r => r.id !== lastSegment(url))
      return null
    },
  }
  return handlers
}

/** `firstCell: ''` doesn't wait for any row (empty list). */
async function open(handlers: Record<string, MockHandler> = backend(), firstCell = 'Latte') {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url('/products'), { waitUntil: 'hydration' })
  if (firstCell) await page.getByText(firstCell, { exact: true }).first().waitFor()
  return { page, api }
}

/** A menu item's card in the grid (the default view). */
const cardOf = (page: Page, name: string) => page.getByRole('article', { name, exact: true })

async function openEdit(page: Page, name: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit menu item' })
  await form.waitFor()
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

async function choose(form: Locator, field: string, option: string) {
  await form.getByRole('combobox', { name: field }).click()
  await form.page().getByRole('option', { name: option }).click()
}

describe('menu items list', () => {
  it('shows cards with image, name, category, option groups, price in dollars and status', async () => {
    const { page } = await open()
    const latte = cardOf(page, 'Latte')
    await latte.getByText('$3.50').waitFor()
    await latte.getByText('Coffee · 1 option group').waitFor()
    expect(await latte.locator('img').getAttribute('src')).toBe('/media/menu/latte.png')
    await cardOf(page, 'Matcha').getByText('$4.25').waitFor()
    await cardOf(page, 'Matcha').getByText('Inactive').waitFor()
  })

  it('opens a menu item by clicking its card, but not from its checkbox', async () => {
    const { page } = await open()
    await cardOf(page, 'Matcha').getByRole('checkbox').click()
    await page.getByText('1 selected').waitFor()
    expect(await page.getByRole('dialog').count()).toBe(0)
    await cardOf(page, 'Latte').getByRole('heading', { name: 'Latte' }).click()
    await page.getByRole('dialog', { name: 'Edit menu item' }).waitFor()
  })

  it('switches to the list (table), opens a row by clicking it, and remembers the view', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'List view' }).click()
    await page.getByRole('cell', { name: 'Coffee', exact: true }).waitFor()
    await page.getByRole('cell', { name: '$4.25' }).click()
    await page.getByRole('dialog', { name: 'Edit menu item' }).waitFor()
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.goto(page.url(), { waitUntil: 'hydration' })
    await page.getByRole('cell', { name: 'Coffee', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('groups the whole menu by category, in the order customers see it', async () => {
    const seen: string[] = []
    const { page } = await open({
      ...backend(),
      'GET /admin/categories': () => [{ ...TEA, sortOrder: 1 }, { ...COFFEE, sortOrder: 2 }],
      'GET /admin/products/all': ({ url }) => {
        seen.push(url.search)
        return [LATTE, MATCHA]
      },
    })
    await page.getByRole('switch', { name: 'Group by category' }).click()
    await page.getByRole('region', { name: 'Tea' }).getByRole('article', { name: 'Matcha' }).waitFor()
    await page.getByRole('region', { name: 'Coffee' }).getByRole('article', { name: 'Latte' }).waitFor()
    expect(await page.locator('section h2').allInnerTexts()).toEqual(['Tea\n1', 'Coffee\n1'])
    expect(seen.length).toBeGreaterThan(0)
  })

  it('filters by status with tabs that show counts', async () => {
    const seen: URLSearchParams[] = []
    const list = paginatedHandler([LATTE, MATCHA])
    const { page } = await open({
      ...backend(),
      'GET /admin/products': (request) => {
        if (request.url.searchParams.get('pageSize') !== '1') seen.push(request.url.searchParams)
        return list(request)
      },
    })
    const tabs = page.getByRole('group', { name: 'Status' })
    await expect.poll(() => tabs.innerText()).toMatch(/All\s*2\s*Active\s*1\s*Inactive\s*1/)
    await tabs.getByRole('tab', { name: /Inactive/ }).click()
    await expect.poll(() => seen.at(-1)?.get('status')).toBe('INACTIVE')
    await expect.poll(() => page.getByRole('article').count()).toBe(1)
    expect(new URL(page.url()).searchParams.get('status')).toBe('INACTIVE')
  })

  it('searches and filters by category, both in the URL', async () => {
    const seen: URLSearchParams[] = []
    const list = paginatedHandler([LATTE, MATCHA])
    const { page } = await open({
      ...backend(),
      'GET /admin/products': (request) => {
        seen.push(request.url.searchParams)
        return list(request)
      },
    })
    await page.getByPlaceholder('Search menu items…').fill('lat')
    await expect.poll(() => seen.at(-1)?.get('search')).toBe('lat')

    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.getByRole('option', { name: 'Coffee' }).click()
    await expect.poll(() => seen.at(-1)?.get('categoryId')).toBe(COFFEE.id)
    await expect.poll(() => new URL(page.url()).searchParams.get('categoryId')).toBe(COFFEE.id)
  })

  it('shows the empty state when there are no menu items', async () => {
    const { page } = await open({ ...backend([]) }, '')
    await page.getByText('No menu items yet').waitFor()
  })
})

describe('menu item form', () => {
  it('creates a menu item with an uploaded image, a category, a price in cents and schedules', async () => {
    let uploaded: unknown
    let body: unknown
    const { page } = await open({
      ...backend(),
      'POST /admin/media': (request) => {
        uploaded = request.body
        return UPLOADED
      },
      'POST /admin/products': (request) => {
        body = request.body
        return productOf('prod-9', 'Mocha', COFFEE)
      },
    })
    const form = await openNew(page)

    // Nothing is sent while required fields are empty.
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Category is required').waitFor()
    await form.getByText('Price is required').waitFor()

    await chooseImage(form, PNG)
    await expect.poll(() => form.locator('img').getAttribute('src')).toBe(UPLOADED.url)
    await form.getByLabel('Name', { exact: true }).fill('Mocha')
    await form.getByText('Name is required').waitFor({ state: 'hidden' })
    await choose(form, 'Category', 'Coffee')
    await form.getByRole('spinbutton', { name: 'Price' }).fill('4.2')
    await choose(form, 'Schedules', 'Lunch')
    await page.keyboard.press('Escape') // close the multi-select list
    await form.getByRole('button', { name: 'Create' }).click()

    await toast(page, 'Menu item "Mocha" created').waitFor()
    // Multipart with the chosen file.
    expect(uploaded).toContain('filename="photo.png"')
    expect(body).toEqual({
      name: 'Mocha',
      categoryId: COFFEE.id,
      priceMinor: 420,
      description: '',
      scheduleIds: [LUNCH.id],
      status: 'ACTIVE',
      imageAssetId: UPLOADED.id,
      variantGroups: [],
    })
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

  it('cannot save while the image is uploading, and shows an upload failure', async () => {
    const upload = deferred()
    const { page, api } = await open({ ...backend(), 'POST /admin/media': upload.handler })
    const form = await openEdit(page, 'Latte')
    await chooseImage(form, PNG)
    await upload.started()
    await form.getByText('Waiting for the image upload…').waitFor()
    expect(await form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)

    upload.fail(failures.validation('Use a JPEG, PNG or WebP image.'))
    await toast(page, 'Could not upload "photo.png"').waitFor()
    await expect.poll(() => form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(false)
    // The previous image is still the one in the form.
    expect(await form.locator('img').getAttribute('src')).toBe('/media/menu/latte.png')
    expect(api.calls.filter(c => c.startsWith('PATCH'))).toEqual([])
  })

  it('edits from the version it read, sending variants with their ids, schedules and image', async () => {
    let body: unknown
    const { page } = await open({
      ...backend(),
      'PATCH /admin/products/{id}': (request) => {
        body = request.body
        return { ...LATTE, name: 'Oat latte', version: 4 }
      },
    })
    const form = await openEdit(page, 'Latte')
    // The variants are in the editor, untouched.
    expect(await form.getByLabel('Name of group 1').inputValue()).toBe('Milk')
    expect(await form.getByLabel('Name of option 2 in Milk').inputValue()).toBe('Oat')

    await form.getByLabel('Name', { exact: true }).fill('Oat latte')
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Menu item "Oat latte" updated').waitFor()
    expect(body).toEqual({
      version: 3,
      name: 'Oat latte',
      categoryId: COFFEE.id,
      priceMinor: 350,
      description: 'Espresso and milk',
      scheduleIds: ['sched-30'],
      status: 'ACTIVE',
      imageAssetId: 'asset-latte',
      variantGroups: [{
        id: 'grp-43',
        name: 'Milk',
        minSelect: 1,
        maxSelect: 1,
        options: [{ id: 'opt-73', name: 'Whole', priceDeltaMinor: 0 }, { id: 'opt-74', name: 'Oat', priceDeltaMinor: 50 }],
      }],
    })
  })

  it('removes the image: saved with imageAssetId null', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend(),
      'PATCH /admin/products/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return { ...LATTE, image: null, version: 4 }
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByRole('button', { name: 'Remove', exact: true }).click()
    await form.getByRole('button', { name: 'Upload image' }).waitFor()
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, /updated$/).waitFor()
    expect(body?.imageAssetId).toBeNull()
  })

  it('keeps a selected inactive schedule visible, but does not offer inactive ones as new choices', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend([{ ...LATTE, scheduleIds: [RETIRED.id] }]),
      'PATCH /admin/products/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return LATTE
      },
    })
    const form = await openEdit(page, 'Latte')
    const schedules = form.getByRole('combobox', { name: 'Schedules' })
    await expect.poll(() => schedules.textContent()).toContain('Old promo (inactive)')

    await schedules.click()
    await page.getByRole('option', { name: 'Breakfast' }).click()
    expect(await page.getByRole('option', { name: 'Old promo', exact: true }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, /updated$/).waitFor()
    expect(body?.scheduleIds).toEqual([RETIRED.id, BREAKFAST.id])
  })

  it('keeps the input and shows the server\'s reason when the save fails', async () => {
    const { page } = await open({
      ...backend(),
      'PATCH /admin/products/{id}': () => {
        throw failures.conflict('VERSION_CONFLICT', 'This menu item was changed by someone else. Reload it and try again.')
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByLabel('Name', { exact: true }).fill('Latte 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await page.getByText('This menu item was changed by someone else. Reload it and try again.').first().waitFor()
    expect(await form.getByLabel('Name', { exact: true }).inputValue()).toBe('Latte 2')
  })
})

describe('menu item delete', () => {
  it('deletes after confirmation, naming the version it read', async () => {
    let version: string | null = null
    const { page, api } = await open({
      ...backend(),
      'DELETE /admin/products/{id}': ({ url }) => {
        version = url.searchParams.get('version')
        return null
      },
    })
    await page.getByRole('button', { name: 'Actions for Matcha' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByText('Delete "Matcha"?').waitFor()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Menu item "Matcha" deleted').waitFor()
    expect(api.calls).toContain('DELETE /admin/products/prod-2')
    expect(version).toBe('1')
  })
})

const SIZE: VariantGroup = {
  id: 'grp-50',
  name: 'Size',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'opt-90', name: 'Regular', priceDeltaMinor: 0 },
    { id: 'opt-91', name: 'Large', priceDeltaMinor: 100 },
  ],
}
const MILK_AND_SIZE = productOf(LATTE.id, 'Latte', COFFEE, { ...LATTE, variantGroups: [MILK, SIZE] })

/** A PATCH handler that records the body and answers with the item. */
function savingHandler(record: (body: Record<string, unknown>) => void): MockHandler {
  return (request) => {
    record(request.body as Record<string, unknown>)
    return { ...MILK_AND_SIZE, version: MILK_AND_SIZE.version + 1 }
  }
}

describe('menu item variants', () => {
  it('adds, edits, removes and reorders (keyboard) groups and options, and sends the whole list', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({ ...backend([MILK_AND_SIZE]), 'PATCH /admin/products/{id}': savingHandler(b => (body = b)) })
    const form = await openEdit(page, 'Latte')

    // Milk: rename Oat, add Soy (+$0.75), move Soy up above Oat with the keyboard.
    await form.getByLabel('Name of option 2 in Milk').fill('Oat milk')
    await form.getByRole('button', { name: 'Add option' }).first().click()
    await form.getByLabel('Name of option 3 in Milk').fill('Soy')
    await form.getByRole('spinbutton', { name: 'Extra price of option 3 in Milk' }).fill('0.75')
    await form.getByRole('button', { name: /^Reorder option Soy/ }).press('ArrowUp')
    await expect.poll(() => form.getByLabel('Name of option 2 in Milk').inputValue()).toBe('Soy')

    // Size: remove Large; then move the Size group above Milk.
    await form.getByRole('button', { name: 'Remove option Large' }).click()
    const sizeHandle = form.getByRole('button', { name: /^Reorder Size/ })
    await sizeHandle.press('ArrowUp')
    await expect.poll(() => form.getByLabel('Name of group 1').inputValue()).toBe('Size')
    // Focus stays on the moved handle, so it can be moved again.
    await expect.poll(() => sizeHandle.evaluate(el => el === document.activeElement)).toBe(true)

    // A new group at the end, allowing several choices.
    await form.getByRole('button', { name: 'Add variant group' }).click()
    await form.getByLabel('Name of group 3').fill('Extras')
    await form.getByLabel('Name of option 1 in Extras').fill('Extra shot')
    await form.getByRole('spinbutton', { name: 'Extra price of option 1 in Extras' }).fill('0.5')
    await form.getByRole('switch', { name: 'Customers can pick several' }).last().click()

    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Menu item "Latte" updated').waitFor()
    expect(body?.variantGroups).toEqual([
      { id: 'grp-50', name: 'Size', minSelect: 1, maxSelect: 1, options: [
        { id: 'opt-90', name: 'Regular', priceDeltaMinor: 0 },
      ] },
      { id: 'grp-43', name: 'Milk', minSelect: 1, maxSelect: 1, options: [
        { id: 'opt-73', name: 'Whole', priceDeltaMinor: 0 },
        { name: 'Soy', priceDeltaMinor: 75 },
        { id: 'opt-74', name: 'Oat milk', priceDeltaMinor: 50 },
      ] },
      { name: 'Extras', minSelect: 0, maxSelect: null, options: [
        { name: 'Extra shot', priceDeltaMinor: 50 },
      ] },
    ])
  })

  it('reorders groups by dragging the handle with the mouse', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({ ...backend([MILK_AND_SIZE]), 'PATCH /admin/products/{id}': savingHandler(b => (body = b)) })
    const form = await openEdit(page, 'Latte')
    await form.getByRole('button', { name: /^Reorder Size/ }).dragTo(form.getByRole('button', { name: /^Reorder Milk/ }))
    await expect.poll(() => form.getByLabel('Name of group 1').inputValue()).toBe('Size')
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, /updated$/).waitFor()
    expect((body?.variantGroups as VariantGroup[]).map(v => v.name)).toEqual(['Size', 'Milk'])
  })

  it('checks new groups before sending anything', async () => {
    const { page, api } = await open()
    const form = await openEdit(page, 'Latte')
    await form.getByRole('button', { name: 'Add variant group' }).click()
    await form.getByRole('button', { name: 'Save' }).click()
    await form.getByText('Group name is required').waitFor()
    await form.getByText('Option name is required').waitFor()
    // Removing the only option is checked on the next save (the user may be about to add one).
    await form.getByRole('button', { name: 'Remove option 1' }).click()
    await form.getByRole('button', { name: 'Save' }).click()
    await form.getByText('Add at least one option').waitFor()
    expect(api.calls.filter(c => c.startsWith('PATCH'))).toEqual([])
  })

  it('counts a reorder as an unsaved change', async () => {
    const { page } = await open({ ...backend([MILK_AND_SIZE]) })
    const form = await openEdit(page, 'Latte')
    await form.getByRole('button', { name: /^Reorder Size/ }).press('ArrowUp')
    await form.getByRole('button', { name: 'Cancel' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})
