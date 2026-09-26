import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import type { Product } from '../../shared/contracts/menu'
import { deferred, failures, lastSegment, mockApi, paginatedHandler, productOf, setupE2e, TEA, toast } from './support/mock-api'

// Shared list behaviors on a paginated list (the Menu items grid): a busy item vs bulk delete,
// Stop, Retry failed, the last-page step-back and selection reset. They used to run on the
// Categories table, which is now an unpaginated tree (docs/plans/list-ui-refresh.md).
await setupE2e()

type Row = Product
const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => productOf(`prod-${i + 1}`, `Item ${i + 1}`, TEA, { priceMinor: 100 }))

/** A backend whose list reflects deletes, like the real one. */
function backend(initial: Row[]) {
  let rows = [...initial]
  return {
    list: paginatedHandler(() => rows),
    /** Deletes after `wait` (if given) resolves; then the item is gone from the list. */
    remove: (wait?: MockHandler): MockHandler => async (request) => {
      if (wait) await wait(request)
      rows = rows.filter(r => r.id !== lastSegment(request.url))
      return null
    },
  }
}

async function open(handlers: Record<string, MockHandler>, path = '/products', first = 'Item 1') {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  await card(page, first).waitFor()
  return { page, api }
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const deletes = (calls: string[]) => calls.filter(c => c.startsWith('DELETE'))
const selectedCount = (page: Page, n: number) => page.getByText(`${n} selected`)

async function bulkDelete(page: Page) {
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete' }).click()
}

describe('bulk delete vs an edit in progress', () => {
  it('skips the item being saved, deletes the others, and keeps the skipped item selected', async () => {
    const save = deferred()
    const [one, two] = rowsOf(2)
    const { page, api } = await open({
      'GET /admin/products': paginatedHandler([one!, two!]),
      'GET /admin/schedules/options': () => [],
      'PATCH /admin/products/{id}': save.handler,
      'DELETE /admin/products/{id}': () => null,
    })

    // Edit Item 1, save, and close the panel while the save is still running.
    await page.getByRole('button', { name: 'Actions for Item 1' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const form = page.getByRole('dialog', { name: 'Edit menu item' })
    await form.getByLabel('Name', { exact: true }).fill('Item 1b')
    await form.getByRole('button', { name: 'Save' }).click()
    await save.started()
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Close' }).click()
    await form.waitFor({ state: 'hidden' })
    // UIcon is aria-hidden, so select the busy spinner by its attribute.
    await page.locator('[aria-label="Working…"]').waitFor()

    // Select all includes the busy item; the delete must still not touch it.
    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await selectedCount(page, 2).waitFor()
    await bulkDelete(page)

    await toast(page, /^1 menu item deleted$/).waitFor()
    await page.getByText('1 skipped (another action on it was in progress)').first().waitFor()
    expect(deletes(api.calls)).toEqual(['DELETE /admin/products/prod-2'])
    await selectedCount(page, 1).waitFor()

    save.release({ ...one, name: 'Item 1b', version: 2 })
    await toast(page, 'Menu item "Item 1b" updated').waitFor()
  })
})

describe('bulk delete: Stop and Retry failed', () => {
  it('Stop lets running deletes finish, starts no more, and keeps the rest selected', async () => {
    const slow = deferred()
    const server = backend(rowsOf(6))
    const { page, api } = await open({ 'GET /admin/products': server.list, 'DELETE /admin/products/{id}': server.remove(slow.handler) })

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await selectedCount(page, 6).waitFor()
    await bulkDelete(page)
    await slow.started(4) // concurrency 4: two wait in the queue
    await page.getByRole('button', { name: 'Stop' }).click()
    for (let i = 0; i < 4; i++) slow.release()

    await toast(page, '4 menu items deleted').waitFor()
    await page.getByText('2 not started (stopped)').first().waitFor()
    expect(deletes(api.calls)).toHaveLength(4)
    await selectedCount(page, 2).waitFor()
  })

  it('Retry failed reruns only the failed deletes, without asking again', async () => {
    let failOnce = true
    const server = backend(rowsOf(2))
    const remove = server.remove()
    const { page, api } = await open({
      'GET /admin/products': server.list,
      'DELETE /admin/products/{id}': (request) => {
        if (lastSegment(request.url) === 'prod-2' && failOnce) {
          failOnce = false
          throw failures.conflict('VERSION_CONFLICT', 'Menu item is in an open order')
        }
        return remove(request)
      },
    })

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await bulkDelete(page)
    await toast(page, '1 menu item deleted, 1 failed').waitFor()
    await page.getByText('Menu item is in an open order (1)').first().waitFor()
    await selectedCount(page, 1).waitFor()

    await page.getByRole('button', { name: 'Retry failed' }).click()
    await toast(page, /^1 menu item deleted$/).waitFor()
    expect(deletes(api.calls)).toEqual(['DELETE /admin/products/prod-1', 'DELETE /admin/products/prod-2', 'DELETE /admin/products/prod-2'])
    expect(await page.getByRole('alertdialog').count()).toBe(0)
  })
})

describe('list state after deletes and navigation', () => {
  it('deleting the only item of the last page steps back to the previous page', async () => {
    const server = backend(rowsOf(21))
    const { page } = await open({
      'GET /admin/products': server.list,
      'DELETE /admin/products/{id}': server.remove(),
    }, '/products?page=2', 'Item 21')

    await page.getByRole('button', { name: 'Actions for Item 21' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete' }).last().click()

    await card(page, 'Item 1').waitFor()
    expect(new URL(page.url()).searchParams.get('page')).toBeNull()
    expect(await page.getByText('No menu items').count()).toBe(0)
  })

  it('clears the selection when the filters or the page change', async () => {
    const server = backend(rowsOf(45))
    const { page } = await open({ 'GET /admin/products': server.list })

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await selectedCount(page, 20).waitFor()
    await page.getByRole('button', { name: 'Page 2' }).click()
    await card(page, 'Item 21').waitFor()
    // The bar fades out (100 ms): wait for it to go.
    await expect.poll(() => page.getByText(/\d+ selected/).count()).toBe(0)

    await card(page, 'Item 21').getByRole('checkbox').click()
    await selectedCount(page, 1).waitFor()
    const search = page.getByRole('searchbox', { name: 'Search menu items…' })
    await search.fill('Item 3')
    await search.press('Enter')
    await card(page, 'Item 3').waitFor()
    await expect.poll(() => page.getByText(/\d+ selected/).count()).toBe(0)
  })
})
