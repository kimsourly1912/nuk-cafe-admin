import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { deferred, gotoViaSidebar, menuItemSummaryOf, mockApi, pageOf, paginatedHandler, setupE2e } from './support/mock-api'

// List-page behaviour shared by every paginated feature (usePaginatedQuery, SearchInput,
// ListEmptyState, ListSkeleton), exercised on Menu items. (It ran on Categories until that became
// an unpaginated tree, then on Schedules until they were replaced by Availability: D66.)
await setupE2e()

const item = (id: number, name: string) => menuItemSummaryOf(`item-${id}`, name, { status: 'active' })
const MANY = Array.from({ length: 45 }, (_, i) => item(i + 1, i === 0 ? 'Green tea' : `Item ${i + 1}`))

/** The status tabs ask the same endpoint for counts (`pageSize=1`): leave those out. */
const isCount = (request: { url: URL }) => request.url.searchParams.get('pageSize') === '1'

async function open(path = '/c/nuk/admin/products', rows = MANY) {
  const page = await createPage()
  const api = await mockApi(page, { 'GET /admin/menu/items': paginatedHandler(rows) })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search menu items…' })
const query = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams)

describe('list page: search', () => {
  it('searches as you type, with one request after typing stops', async () => {
    const lists: string[] = []
    const list = paginatedHandler(MANY)
    const page = await createPage()
    await mockApi(page, {
      'GET /admin/menu/items': (request) => {
        if (!isCount(request)) lists.push(request.url.search)
        return list(request)
      },
    })
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await card(page, 'Green tea').waitFor()
    const before = lists.length

    await search(page).pressSequentially('green', { delay: 50 })
    await expect.poll(() => query(page)).toEqual({ search: 'green' })
    await expect.poll(() => page.getByRole('article', { name: /^Item \d+$/ }).count()).toBe(0)
    await card(page, 'Green tea').waitFor()
    expect(lists.length - before).toBe(1)
  })

  it('applies at once on Enter, and Clear resets the search', async () => {
    const { page } = await open()
    await search(page).fill('green')
    await search(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ search: 'green' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.poll(() => query(page)).toEqual({})
    await expect(search(page).inputValue()).resolves.toBe('')
  })
})

describe('list page: state in the URL', () => {
  it('restores search, filters and page from the URL (reload, shared link)', async () => {
    const { page } = await open('/c/nuk/admin/products?status=active&page=2')
    await card(page, 'Item 21').waitFor()
    await page.reload({ waitUntil: 'networkidle' })
    await card(page, 'Item 21').waitFor()
    expect(query(page)).toEqual({ status: 'active', page: '2' })
    expect(await page.getByRole('group', { name: 'Status' }).getByRole('tab', { name: /Published/, selected: true }).count()).toBe(1)
  })

  it('writes the page, and a filter change goes back to page 1', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Page 2' }).click()
    await expect.poll(() => query(page)).toEqual({ page: '2' })
    await search(page).fill('item')
    await search(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ search: 'item' })
  })

  it('does not add history entries: back leaves the list', async () => {
    const page = await createPage()
    await mockApi(page, { 'GET /admin/menu/items': paginatedHandler(MANY) })
    await gotoViaSidebar(page, [/Menu items/])
    await search(page).fill('green')
    await search(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ search: 'green' })
    await page.goBack()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin')
  })

  it('the sidebar link opens the bare list and resets the filters', async () => {
    const { page } = await open('/c/nuk/admin/products?search=green')
    await expect(search(page).inputValue()).resolves.toBe('green')
    await page.getByRole('link', { name: /Menu items/ }).first().click()
    await expect.poll(() => query(page)).toEqual({})
    await expect(search(page).inputValue()).resolves.toBe('')
  })
})

describe('list page: empty states', () => {
  it('nothing yet: offers to create', async () => {
    const { page } = await open('/c/nuk/admin/products', [])
    await page.getByText('No menu items yet').waitFor()
    await page.getByRole('button', { name: 'New menu item' }).last().click()
    await page.getByRole('dialog', { name: 'New menu item' }).waitFor()
  })

  it('filters hide everything: offers to clear them', async () => {
    const { page } = await open('/c/nuk/admin/products?search=zzz')
    await page.getByText('No menu items match your filters').waitFor()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await card(page, 'Green tea').waitFor()
    expect(query(page)).toEqual({})
  })
})

describe('list page: loading and out-of-order responses', () => {
  it('shows placeholders until the first page arrives, never the empty state', async () => {
    const first = deferred()
    const list = paginatedHandler(MANY)
    const page = await createPage()
    await mockApi(page, { 'GET /admin/menu/items': request => (isCount(request) ? list(request) : first.handler(request)) })
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await page.getByRole('status', { name: 'Loading menu items…' }).waitFor()
    expect(await page.getByText('No menu items yet').count()).toBe(0)
    first.release(list({ url: new URL('http://x/api/admin/menu/items'), body: null }))
    await card(page, 'Green tea').waitFor()
    expect(await page.getByRole('status', { name: 'Loading menu items…' }).count()).toBe(0)
  })

  it('a slow response for an older search never replaces the newer results', async () => {
    const slowGreen = deferred()
    const list = paginatedHandler(MANY)
    const handler: MockHandler = request =>
      (!isCount(request) && request.url.searchParams.get('search') === 'green' ? slowGreen.handler(request) : list(request))
    const page = await createPage()
    await mockApi(page, { 'GET /admin/menu/items': handler })
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await card(page, 'Green tea').waitFor()

    await search(page).fill('green')
    await search(page).press('Enter')
    await slowGreen.started()
    await search(page).fill('Item 45')
    await search(page).press('Enter')
    await card(page, 'Item 45').waitFor()

    // The older request answers last, with rows that don't match the current search.
    slowGreen.release(pageOf([item(99, 'Stale green tea')]))
    await page.waitForTimeout(500)
    expect(await page.getByText('Stale green tea').count()).toBe(0)
    await card(page, 'Item 45').waitFor()
  })
})

describe('list page: the pager (D128)', () => {
  const visibleOf = (locator: ReturnType<Page['locator']>) => locator.filter({ visible: true })
  const pageBox = (page: Page) => page.getByRole('spinbutton', { name: 'Page number' })
  const rowsPerPage = (page: Page) => visibleOf(page.getByRole('combobox', { name: 'Rows per page' }))

  it('goes to a typed page on Enter, kept within the pages that exist', async () => {
    const { page } = await open()
    await card(page, 'Green tea').waitFor()
    await expect(page.getByText('of 3', { exact: true }).isVisible()).resolves.toBe(true)
    await pageBox(page).fill('3')
    await pageBox(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ page: '3' })
    await card(page, 'Item 41').waitFor()

    await pageBox(page).fill('99')
    await pageBox(page).press('Enter')
    await expect.poll(() => pageBox(page).inputValue()).toBe('3')
    expect(query(page)).toEqual({ page: '3' })
  })

  it('a new page size goes back to page 1, asks the API for it and stays in the URL', async () => {
    const sizes: string[] = []
    const list = paginatedHandler(MANY)
    const page = await createPage()
    await mockApi(page, {
      'GET /admin/menu/items': (request) => {
        if (!isCount(request)) sizes.push(`${request.url.searchParams.get('page')}/${request.url.searchParams.get('pageSize')}`)
        return list(request)
      },
    })
    await page.goto(url('/c/nuk/admin/products?page=2'), { waitUntil: 'hydration' })
    await card(page, 'Item 21').waitFor()

    await rowsPerPage(page).click()
    await page.getByRole('option', { name: '50', exact: true }).click()
    await expect.poll(() => query(page)).toEqual({ pageSize: '50' })
    await card(page, 'Item 45').waitFor()
    expect(sizes.at(-1)).toBe('1/50')
    // Everything fits one page now: no page numbers
    expect(await page.getByRole('button', { name: 'Page 2' }).count()).toBe(0)

    await page.reload({ waitUntil: 'networkidle' })
    await card(page, 'Item 45').waitFor()
    expect(query(page)).toEqual({ pageSize: '50' })
  })

  it('on a phone: previous and next around "Page n of N", rows per page under them', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, { 'GET /admin/menu/items': paginatedHandler(MANY) })
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Next page' }).waitFor()
    // The numbered pager is the desktop's
    expect(await page.getByRole('button', { name: 'Page 2' }).isVisible()).toBe(false)
    expect(await page.getByRole('button', { name: 'Previous page' }).isDisabled()).toBe(true)

    await page.getByRole('button', { name: 'Next page' }).click()
    await expect.poll(() => query(page)).toEqual({ page: '2' })
    await expect.poll(() => pageBox(page).inputValue()).toBe('2')
    expect(await rowsPerPage(page).count()).toBe(1)
    const pager = await page.getByRole('navigation', { name: 'Pagination' }).boundingBox()
    expect(pager!.x + pager!.width).toBeLessThanOrEqual(390)
  })
})

describe('list page: status tabs that don\'t fit (D128)', () => {
  /** The tab row's scroll position, how far it can scroll, and whether a label is cut off. */
  const tabRow = (page: Page) => page.getByRole('group', { name: 'Status' }).getByRole('tablist').evaluate((list) => {
    const labels = [...list.querySelectorAll<HTMLElement>('[role="tab"] [data-slot="label"]')]
    const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')!
    const ideal = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2
    return {
      scrollLeft: list.scrollLeft,
      scrolls: list.scrollWidth > list.clientWidth,
      cut: labels.filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent),
      /** How far the row is from centering the active tab (as far as the row can scroll). */
      offCenter: Math.abs(list.scrollLeft - Math.min(Math.max(ideal, 0), list.scrollWidth - list.clientWidth)),
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })

  async function openAt(path: string) {
    const page = await createPage()
    await page.setViewportSize({ width: 320, height: 700 })
    await mockApi(page, { 'GET /admin/menu/items': paginatedHandler(MANY) })
    await page.goto(url(path), { waitUntil: 'hydration' })
    await page.getByRole('group', { name: 'Status' }).getByRole('tab').first().waitFor()
    return page
  }

  it('shows every label in full; the row scrolls, not the page', async () => {
    const page = await openAt('/c/nuk/admin/products')
    const row = await tabRow(page)
    expect(row.cut).toEqual([])
    expect(row.scrolls).toBe(true)
    expect(row.pageScrollsSideways).toBe(false)
  })

  it('brings a tapped tab, or the one in the URL, to the middle of the row', async () => {
    const page = await openAt('/c/nuk/admin/products?status=archived')
    await expect.poll(async () => (await tabRow(page)).scrollLeft).toBeGreaterThan(0)

    await page.getByRole('group', { name: 'Status' }).getByRole('tab', { name: /^All/ }).click()
    await expect.poll(async () => (await tabRow(page)).scrollLeft).toBe(0)
    await page.getByRole('group', { name: 'Status' }).getByRole('tab', { name: /^Published/ }).click()
    await expect.poll(() => query(page)).toEqual({ status: 'active' })
    await expect.poll(async () => (await tabRow(page)).offCenter).toBeLessThan(2)
  })
})
