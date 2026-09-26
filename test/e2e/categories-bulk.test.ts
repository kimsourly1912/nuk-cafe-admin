import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { COFFEE, deferred, failures, mockApi, paginatedHandler, setupE2e, TEA, toast } from './support/mock-api'

// Row busy state, bulk delete (conflicts, Stop, Retry failed), selection reset and the
// last-page step-back on the Categories reference list.
await setupE2e()

type Row = { id: number, categoryName: string, status: string, type: string }
const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, categoryName: `Category ${i + 1}`, status: 'ACTIVE', type: 'MAIN' }))

/** A backend whose list reflects deletes, like the real one. */
function backend(initial: Row[]) {
  let rows = [...initial]
  const idOf = (u: URL) => Number(u.pathname.split('/').pop())
  return {
    list: paginatedHandler(() => rows),
    /** Deletes after `wait` (if given) resolves; then the row is gone from the list. */
    remove: (wait?: MockHandler): MockHandler => async (request) => {
      if (wait) await wait(request)
      rows = rows.filter(r => r.id !== idOf(request.url))
      return null
    },
  }
}

async function open(handlers: Record<string, MockHandler>, path = '/categories', firstCell = 'Category 1') {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  await page.getByRole('cell', { name: firstCell, exact: true }).waitFor()
  return { page, api }
}

const deletes = (calls: string[]) => calls.filter(c => c.startsWith('DELETE'))
const selectedCount = (page: Page, n: number) => page.getByText(`${n} selected`)

async function bulkDelete(page: Page) {
  await page.getByRole('button', { name: 'Delete' }).first().click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete' }).click()
}

describe('bulk delete vs an edit in progress', () => {
  it('skips the row being saved, deletes the others, and keeps the skipped row selected', async () => {
    const save = deferred()
    const { page, api } = await open({
      'GET /staff/categories': () => ({ content: [TEA, COFFEE], totalElements: 2, totalPages: 1, currentPage: 0, pageSize: 20, hasNext: false, hasPrevious: false }),
      'PUT /staff/categories/{id}': save.handler,
      'DELETE /staff/categories/{id}': () => null,
    }, '/categories', 'Tea')

    // Edit Tea, save, and close the modal while the save is still running.
    await page.getByRole('button', { name: 'Actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const form = page.getByRole('dialog', { name: 'Edit category' })
    await form.locator('input').first().fill('Tea 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await save.started()
    await page.keyboard.press('Escape')
    await form.waitFor({ state: 'hidden' })
    // UIcon is aria-hidden, so select the busy spinner by its attribute.
    await page.locator('[aria-label="Working…"]').waitFor()

    // Select all includes the busy row; the delete must still not touch it.
    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await selectedCount(page, 2).waitFor()
    await bulkDelete(page)

    await toast(page, /^1 category deleted$/).waitFor()
    await page.getByText('1 skipped (another action on it was in progress)').first().waitFor()
    expect(deletes(api.calls)).toEqual(['DELETE /staff/categories/2'])
    await selectedCount(page, 1).waitFor()

    save.release({ ...TEA, categoryName: 'Tea 2' })
    await toast(page, 'Category "Tea 2" updated').waitFor()
  })
})

describe('bulk delete: Stop and Retry failed', () => {
  it('Stop lets running deletes finish, starts no more, and keeps the rest selected', async () => {
    const slow = deferred()
    const server = backend(rowsOf(6))
    const { page, api } = await open({ 'GET /staff/categories': server.list, 'DELETE /staff/categories/{id}': server.remove(slow.handler) })

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await selectedCount(page, 6).waitFor()
    await bulkDelete(page)
    await slow.started(4) // concurrency 4: two wait in the queue
    await page.getByRole('button', { name: 'Stop' }).click()
    for (let i = 0; i < 4; i++) slow.release()

    await toast(page, '4 categories deleted').waitFor()
    await page.getByText('2 not started (stopped)').first().waitFor()
    expect(deletes(api.calls)).toHaveLength(4)
    await selectedCount(page, 2).waitFor()
  })

  it('Retry failed reruns only the failed deletes, without asking again', async () => {
    let failOnce = true
    const server = backend(rowsOf(2))
    const remove = server.remove()
    const { page, api } = await open({
      'GET /staff/categories': server.list,
      'DELETE /staff/categories/{id}': (request) => {
        if (request.url.pathname.endsWith('/2') && failOnce) {
          failOnce = false
          throw failures.validation('Category is in use')
        }
        return remove(request)
      },
    })

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await bulkDelete(page)
    await toast(page, '1 category deleted, 1 failed').waitFor()
    await page.getByText('Category is in use (1)').first().waitFor()
    await selectedCount(page, 1).waitFor()

    await page.getByRole('button', { name: 'Retry failed' }).click()
    await toast(page, /^1 category deleted$/).waitFor()
    expect(deletes(api.calls)).toEqual(['DELETE /staff/categories/1', 'DELETE /staff/categories/2', 'DELETE /staff/categories/2'])
    expect(await page.getByRole('alertdialog').count()).toBe(0)
  })
})

describe('list state after deletes and navigation', () => {
  it('deleting the only row of the last page steps back to the previous page', async () => {
    const server = backend(rowsOf(21))
    const { page } = await open({
      'GET /staff/categories': server.list,
      'DELETE /staff/categories/{id}': server.remove(),
    }, '/categories?page=2', 'Category 21')

    await page.getByRole('button', { name: 'Actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete' }).last().click()

    await page.getByRole('cell', { name: 'Category 1', exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('page')).toBeNull()
    expect(await page.getByText('No categories').count()).toBe(0)
  })

  it('clears the selection when the filters or the page change', async () => {
    const server = backend(rowsOf(45))
    const { page } = await open({ 'GET /staff/categories': server.list })

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await selectedCount(page, 20).waitFor()
    await page.getByRole('button', { name: 'Page 2' }).click()
    await page.getByRole('cell', { name: 'Category 21', exact: true }).waitFor()
    expect(await page.getByText(/\d+ selected/).count()).toBe(0)

    await page.getByRole('checkbox', { name: 'Select row' }).first().click()
    await selectedCount(page, 1).waitFor()
    const search = page.getByRole('searchbox', { name: 'Search categories…' })
    await search.fill('Category 3')
    await search.press('Enter')
    await page.getByRole('cell', { name: 'Category 3', exact: true }).waitFor()
    expect(await page.getByText(/\d+ selected/).count()).toBe(0)
  })
})
