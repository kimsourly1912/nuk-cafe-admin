import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { deferred, gotoViaSidebar, mockApi, paginatedHandler, setupE2e } from './support/mock-api'

// List-page behaviour shared by every paginated feature (usePaginatedQuery, SearchInput,
// ListEmptyState, ListSkeleton), exercised on Schedules. (It ran on Categories until that became
// an unpaginated tree: docs/plans/list-ui-refresh.md.)
await setupE2e()

const schedule = (id: number, name: string) => ({ id, name, status: 'ACTIVE', startTime: '08:00', endTime: '10:00', timezone: 'UTC', days: ['MONDAY'], item_count: 0 })
const MANY = Array.from({ length: 45 }, (_, i) => schedule(i + 1, i === 0 ? 'Green tea' : `Schedule ${i + 1}`))

/** The status tabs ask the same endpoint for counts (`size=1`): leave those out. */
const isCount = (request: { url: URL }) => request.url.searchParams.get('size') === '1'

async function open(path = '/schedules', rows = MANY) {
  const page = await createPage()
  const api = await mockApi(page, { 'GET /staff/schedules': paginatedHandler(rows, 'name') })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search schedules…' })
const query = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams)

describe('list page: search', () => {
  it('searches as you type, with one request after typing stops', async () => {
    const lists: string[] = []
    const list = paginatedHandler(MANY, 'name')
    const page = await createPage()
    await mockApi(page, {
      'GET /staff/schedules': (request) => {
        if (!isCount(request)) lists.push(request.url.search)
        return list(request)
      },
    })
    await page.goto(url('/schedules'), { waitUntil: 'hydration' })
    await card(page, 'Green tea').waitFor()
    const before = lists.length

    await search(page).pressSequentially('green', { delay: 50 })
    await expect.poll(() => query(page)).toEqual({ search: 'green' })
    await expect.poll(() => page.getByRole('article', { name: /^Schedule \d+$/ }).count()).toBe(0)
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
    const { page } = await open('/schedules?status=ACTIVE&page=2')
    await card(page, 'Schedule 21').waitFor()
    await page.reload({ waitUntil: 'networkidle' })
    await card(page, 'Schedule 21').waitFor()
    expect(query(page)).toEqual({ status: 'ACTIVE', page: '2' })
    expect(await page.getByRole('group', { name: 'Status' }).getByRole('tab', { name: /Active/, selected: true }).count()).toBe(1)
  })

  it('writes the page, and a filter change goes back to page 1', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Page 2' }).click()
    await expect.poll(() => query(page)).toEqual({ page: '2' })
    await search(page).fill('schedule')
    await search(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ search: 'schedule' })
  })

  it('does not add history entries: back leaves the list', async () => {
    const page = await createPage()
    await mockApi(page, { 'GET /staff/schedules': paginatedHandler(MANY, 'name') })
    await gotoViaSidebar(page, [/Schedules/])
    await search(page).fill('green')
    await search(page).press('Enter')
    await expect.poll(() => query(page)).toEqual({ search: 'green' })
    await page.goBack()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  })

  it('the sidebar link opens the bare list and resets the filters', async () => {
    const { page } = await open('/schedules?search=green')
    await expect(search(page).inputValue()).resolves.toBe('green')
    await page.getByRole('link', { name: /Schedules/ }).first().click()
    await expect.poll(() => query(page)).toEqual({})
    await expect(search(page).inputValue()).resolves.toBe('')
  })
})

describe('list page: empty states', () => {
  it('nothing yet: offers to create', async () => {
    const { page } = await open('/schedules', [])
    await page.getByText('No schedules yet').waitFor()
    await page.getByRole('button', { name: 'New schedule' }).last().click()
    await page.getByRole('dialog', { name: 'New schedule' }).waitFor()
  })

  it('filters hide everything: offers to clear them', async () => {
    const { page } = await open('/schedules?search=zzz')
    await page.getByText('No schedules match your filters').waitFor()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await card(page, 'Green tea').waitFor()
    expect(query(page)).toEqual({})
  })
})

describe('list page: loading and out-of-order responses', () => {
  it('shows placeholders until the first page arrives, never the empty state', async () => {
    const first = deferred()
    const list = paginatedHandler(MANY, 'name')
    const page = await createPage()
    await mockApi(page, { 'GET /staff/schedules': request => (isCount(request) ? list(request) : first.handler(request)) })
    await page.goto(url('/schedules'), { waitUntil: 'hydration' })
    await page.getByRole('status', { name: 'Loading schedules…' }).waitFor()
    expect(await page.getByText('No schedules yet').count()).toBe(0)
    first.release(list({ url: new URL('http://x/staff/schedules'), body: null }))
    await card(page, 'Green tea').waitFor()
    expect(await page.getByRole('status', { name: 'Loading schedules…' }).count()).toBe(0)
  })

  it('a slow response for an older search never replaces the newer results', async () => {
    const slowGreen = deferred()
    const list = paginatedHandler(MANY, 'name')
    const handler: MockHandler = request =>
      (!isCount(request) && request.url.searchParams.get('search') === 'green' ? slowGreen.handler(request) : list(request))
    const page = await createPage()
    await mockApi(page, { 'GET /staff/schedules': handler })
    await page.goto(url('/schedules'), { waitUntil: 'hydration' })
    await card(page, 'Green tea').waitFor()

    await search(page).fill('green')
    await search(page).press('Enter')
    await slowGreen.started()
    await search(page).fill('Schedule 45')
    await search(page).press('Enter')
    await card(page, 'Schedule 45').waitFor()

    // The older request answers last, with rows that don't match the current search.
    slowGreen.release({ content: [schedule(99, 'Stale green tea')], totalElements: 1, totalPages: 1, currentPage: 0, pageSize: 20, hasNext: false, hasPrevious: false })
    await page.waitForTimeout(500)
    expect(await page.getByText('Stale green tea').count()).toBe(0)
    await card(page, 'Schedule 45').waitFor()
  })
})
