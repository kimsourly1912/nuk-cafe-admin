import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { deferred, gotoViaSidebar, mockApi, paginatedHandler, setupE2e } from './support/mock-api'

// List-page behaviour shared by every feature (usePaginatedQuery, SearchInput, ListEmptyState),
// exercised on Categories.
await setupE2e()

const MANY = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, categoryName: i === 0 ? 'Green tea' : `Category ${i + 1}`, status: 'ACTIVE', type: 'MAIN' }))

async function open(path = '/categories', rows = MANY) {
  const page = await createPage()
  const api = await mockApi(page, { 'GET /staff/categories': paginatedHandler(rows) })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search categories…' })
const listRequests = (calls: string[]) => calls.filter(c => c === 'GET /staff/categories').length
const query = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams)

describe('list page: search', () => {
  it('searches as you type, with one request after typing stops', async () => {
    const { page, api } = await open()
    await page.getByRole('cell', { name: 'Green tea' }).waitFor()
    const before = listRequests(api.calls)

    await search(page).pressSequentially('green', { delay: 50 })
    await expect.poll(() => query(page)).toEqual({ search: 'green' })
    await expect.poll(() => page.getByRole('cell', { name: /^Category \d+$/ }).count()).toBe(0)
    await page.getByRole('cell', { name: 'Green tea' }).waitFor()
    expect(listRequests(api.calls) - before).toBe(1)
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
    const { page } = await open('/categories?status=ACTIVE&page=2')
    await page.getByRole('cell', { name: 'Category 21' }).waitFor()
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('cell', { name: 'Category 21' }).waitFor()
    expect(query(page)).toEqual({ status: 'ACTIVE', page: '2' })
  })

  it('writes the page, and a filter change goes back to page 1', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Page 2' }).click()
    await expect.poll(() => query(page)).toEqual({ page: '2' })
    await search(page).fill('category')
    await search(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ search: 'category' })
  })

  it('does not add history entries: back leaves the list', async () => {
    const page = await createPage()
    await mockApi(page, { 'GET /staff/categories': paginatedHandler(MANY) })
    await gotoViaSidebar(page, [/Categories/])
    await search(page).fill('green')
    await search(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ search: 'green' })
    await page.goBack()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  })

  it('the sidebar link opens the bare list and resets the filters', async () => {
    const { page } = await open('/categories?search=green')
    await expect(search(page).inputValue()).resolves.toBe('green')
    await page.getByRole('link', { name: /Categories/ }).first().click()
    await expect.poll(() => query(page)).toEqual({})
    await expect(search(page).inputValue()).resolves.toBe('')
  })
})

describe('list page: empty states', () => {
  it('nothing yet: offers to create', async () => {
    const { page } = await open('/categories', [])
    await page.getByText('No categories yet').waitFor()
    await page.getByRole('button', { name: 'New category' }).last().click()
    await page.getByRole('dialog', { name: 'New category' }).waitFor()
  })

  it('filters hide everything: offers to clear them', async () => {
    const { page } = await open('/categories?search=zzz')
    await page.getByText('No categories match your filters').waitFor()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByRole('cell', { name: 'Green tea' }).waitFor()
    expect(query(page)).toEqual({})
  })
})

describe('list page: loading and out-of-order responses', () => {
  it('shows the loading text until the first page arrives, never the empty state', async () => {
    const first = deferred()
    const page = await createPage()
    await mockApi(page, { 'GET /staff/categories': first.handler })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByText('Loading categories…').waitFor()
    expect(await page.getByText('No categories yet').count()).toBe(0)
    first.release(paginatedHandler(MANY)({ url: new URL('http://x/staff/categories'), body: null }))
    await page.getByRole('cell', { name: 'Green tea' }).waitFor()
  })

  it('a slow response for an older search never replaces the newer results', async () => {
    const slowTea = deferred()
    const list = paginatedHandler(MANY)
    const page = await createPage()
    await mockApi(page, {
      'GET /staff/categories': request => (request.url.searchParams.get('search') === 'green' ? slowTea.handler(request) : list(request)),
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByRole('cell', { name: 'Green tea' }).waitFor()

    await search(page).fill('green')
    await search(page).press('Enter')
    await slowTea.started()
    await search(page).fill('Category 45')
    await search(page).press('Enter')
    await page.getByRole('cell', { name: 'Category 45', exact: true }).waitFor()

    // The older request answers last, with rows that don't match the current search.
    slowTea.release({ content: [{ id: 99, categoryName: 'Stale green tea', status: 'ACTIVE', type: 'MAIN' }], totalElements: 1, totalPages: 1, currentPage: 0, pageSize: 20, hasNext: false, hasPrevious: false })
    await page.waitForTimeout(500)
    expect(await page.getByText('Stale green tea').count()).toBe(0)
    await page.getByRole('cell', { name: 'Category 45', exact: true }).waitFor()
  })
})
