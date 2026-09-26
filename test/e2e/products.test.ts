import type { Locator, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { COFFEE, deferred, failures, mockApi, paginatedHandler, setupE2e, TEA, toast } from './support/mock-api'

// Menu items (products): list, filters, create with an image upload, edit keeping what the form
// doesn't edit (variants, translations, image), schedules picker, delete (docs/plans/products.md).
await setupE2e()

type Row = Record<string, unknown> & { id: number, productName: string }

const LATTE: Row = {
  id: 1,
  productName: 'Latte',
  description: 'Espresso and milk',
  price: 3.5,
  status: 'ACTIVE',
  category: { id: 2, categoryName: 'Coffee' },
  imageUrl: 'https://img.example/latte.png',
  imageUuid: 'file-latte',
  scheduleIds: [30],
  sortOrder: 0,
  nameI18n: { km: 'ឡាតេ' },
  variants: [
    { id: 43, variantName: 'Milk', requiredSelection: true, allowMultipleSelection: false, sortOrder: 0, options: [
      { id: 73, optionName: 'Whole', price: 0, sortOrder: 0 },
      { id: 74, optionName: 'Oat', price: 0.5, sortOrder: 1 },
    ] },
  ],
}
const MATCHA: Row = { id: 2, productName: 'Matcha', price: 4.25, status: 'INACTIVE', category: { id: 1, categoryName: 'Tea' }, scheduleIds: [], variants: [] }

const BREAKFAST = { id: 30, name: 'Breakfast', status: 'ACTIVE' }
const LUNCH = { id: 31, name: 'Lunch', status: 'ACTIVE' }
const RETIRED = { id: 32, name: 'Old promo', status: 'INACTIVE' }

const UPLOADED = { id: 'file-new', url: 'https://img.example/new.png', contentType: 'image/png', sizeBytes: 68 }

function backend(initial: Row[] = [LATTE, MATCHA]) {
  let rows = [...initial]
  const handlers: Record<string, MockHandler> = {
    'GET /staff/products': paginatedHandler(() => rows, 'productName'),
    'GET /staff/categories/all': () => [TEA, COFFEE],
    'GET /staff/schedules/all': () => [BREAKFAST, LUNCH, RETIRED],
    'DELETE /staff/products/{id}': ({ url }) => {
      const id = Number(url.pathname.split('/').pop())
      rows = rows.filter(r => r.id !== id)
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

const rowOf = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })

async function openEdit(page: Page, name: string) {
  await rowOf(page, name).getByRole('button', { name: 'Actions' }).click()
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
  it('shows image, name, category, price in dollars and status', async () => {
    const { page } = await open()
    const latte = rowOf(page, 'Latte')
    await latte.getByText('Espresso and milk').waitFor()
    await latte.getByRole('cell', { name: 'Coffee', exact: true }).waitFor()
    await latte.getByText('$3.50').waitFor()
    await rowOf(page, 'Matcha').getByText('$4.25').waitFor()
    await rowOf(page, 'Matcha').getByText('Inactive').waitFor()
    expect(await latte.locator('img').getAttribute('src')).toBe('https://img.example/latte.png')
  })

  it('searches by productName and filters by categoryId, both in the URL', async () => {
    const seen: URLSearchParams[] = []
    const list = paginatedHandler([LATTE, MATCHA], 'productName')
    const { page } = await open({
      ...backend(),
      'GET /staff/products': (request) => {
        seen.push(request.url.searchParams)
        return list(request)
      },
    })
    await page.getByPlaceholder('Search menu items…').fill('lat')
    await expect.poll(() => seen.at(-1)?.get('productName')).toBe('lat')

    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.getByRole('option', { name: 'Coffee' }).click()
    await expect.poll(() => seen.at(-1)?.get('categoryId')).toBe('2')
    await expect.poll(() => new URL(page.url()).searchParams.get('categoryId')).toBe('2')
  })

  it('shows the empty state when there are no menu items', async () => {
    const { page } = await open({ ...backend([]) }, '')
    await page.getByText('No menu items yet').waitFor()
  })
})

describe('menu item form', () => {
  it('creates a menu item with an uploaded image, a category, a price and schedules', async () => {
    let uploaded: unknown
    let body: unknown
    const { page } = await open({
      ...backend(),
      'POST /staff/products/upload': (request) => {
        uploaded = request.body
        return UPLOADED
      },
      'POST /staff/products': (request) => {
        body = request.body
        return { id: 9 }
      },
    })
    const form = await openNew(page)

    // Nothing is sent while required fields are empty.
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Category is required').waitFor()
    await form.getByText('Price is required').waitFor()

    await chooseImage(form, PNG)
    await expect.poll(() => form.locator('img').getAttribute('src')).toBe(UPLOADED.url)
    await form.getByLabel('Name').fill('Mocha')
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
      productName: 'Mocha',
      categoryId: 2,
      price: 4.2,
      description: '',
      scheduleIds: [31],
      status: 'ACTIVE',
      imageUrl: UPLOADED.url,
      imageUuid: UPLOADED.id,
      variants: [],
    })
  })

  it('rejects the wrong file type or a file over 5 MB without uploading', async () => {
    const { page, api } = await open()
    const form = await openNew(page)
    await chooseImage(form, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') })
    await form.getByText('Use a JPEG, PNG or WebP image.').waitFor()
    await chooseImage(form, { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
    await form.getByText('The image is larger than 5 MB.').waitFor()
    expect(api.calls.filter(c => c.includes('upload'))).toEqual([])
  })

  it('cannot save while the image is uploading, and shows an upload failure', async () => {
    const upload = deferred()
    const { page, api } = await open({ ...backend(), 'POST /staff/products/upload': upload.handler })
    const form = await openEdit(page, 'Latte')
    await chooseImage(form, PNG)
    await upload.started()
    await form.getByText('Waiting for the image upload…').waitFor()
    expect(await form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)

    upload.fail(failures.validation('File too large for the server'))
    await toast(page, 'Could not upload "photo.png"').waitFor()
    await expect.poll(() => form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(false)
    // The previous image is still the one in the form.
    expect(await form.locator('img').getAttribute('src')).toBe('https://img.example/latte.png')
    expect(api.calls.filter(c => c.startsWith('PUT'))).toEqual([])
  })

  it('edits and re-sends variants, translations, image and schedules it does not change', async () => {
    let body: unknown
    const { page } = await open({
      ...backend(),
      'PUT /staff/products/{id}': (request) => {
        body = request.body
        return LATTE
      },
    })
    const form = await openEdit(page, 'Latte')
    // Variants are listed read-only.
    await form.getByText('Required, pick one').waitFor()
    await form.getByText('Whole, Oat (+$0.50)').waitFor()

    await form.getByLabel('Name').fill('Oat latte')
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Menu item "Oat latte" updated').waitFor()
    expect(body).toEqual({
      productName: 'Oat latte',
      categoryId: 2,
      price: 3.5,
      description: 'Espresso and milk',
      scheduleIds: [30],
      status: 'ACTIVE',
      imageUrl: 'https://img.example/latte.png',
      imageUuid: 'file-latte',
      nameI18n: { km: 'ឡាតេ' },
      variants: [{
        id: 43,
        variantName: 'Milk',
        requiredSelection: true,
        allowMultipleSelection: false,
        options: [{ id: 73, optionName: 'Whole', price: 0 }, { id: 74, optionName: 'Oat', price: 0.5 }],
      }],
    })
  })

  it('keeps a selected inactive schedule visible, but does not offer inactive ones as new choices', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open({
      ...backend([{ ...LATTE, scheduleIds: [32] }]),
      'PUT /staff/products/{id}': (request) => {
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
    expect(body?.scheduleIds).toEqual([32, 30])
  })

  it('keeps the input and shows the backend reason when the save fails', async () => {
    const { page } = await open({
      ...backend(),
      'PUT /staff/products/{id}': () => {
        throw failures.validation('Price must be positive')
      },
    })
    const form = await openEdit(page, 'Latte')
    await form.getByLabel('Name').fill('Latte 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await page.getByText('Price must be positive').first().waitFor()
    expect(await form.getByLabel('Name').inputValue()).toBe('Latte 2')
  })
})

describe('menu item delete', () => {
  it('deletes after confirmation', async () => {
    const { page, api } = await open()
    await rowOf(page, 'Matcha').getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByText('Delete "Matcha"?').waitFor()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Menu item "Matcha" deleted').waitFor()
    expect(api.calls).toContain('DELETE /staff/products/2')
  })
})
