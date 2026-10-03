import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MenuItemSummary } from '../../shared/contracts/menu-items'
import type { MockHandler } from './support/mock-api'
import { deferred, failures, menuItemOf, menuItemSummaryOf, mockApi, paginatedHandler, setupE2e, toast } from './support/mock-api'

// Shared list behaviors on a paginated list (the Menu items grid): a busy item vs a bulk action,
// Stop, Retry failed, the last-page step-back and selection reset. They used to run on the
// Categories table, which is now an unpaginated tree (docs/plans/list-ui-refresh.md).
await setupE2e()

const rowsOf = (n: number): MenuItemSummary[] => Array.from({ length: n }, (_, i) => menuItemSummaryOf(`item-${i + 1}`, `Item ${i + 1}`))
/** `/c/nuk/admin/menu/items/item-3/archive` → `item-3`. */
const idOf = (request: { url: URL }) => request.url.pathname.split('/').at(-2)!

/** A backend whose list reflects archiving, like the real one. */
function backend(initial: MenuItemSummary[]) {
  let rows = [...initial]
  return {
    list: paginatedHandler(() => rows),
    /** Archives after `wait` (if given) resolves. */
    archive: (wait?: MockHandler): MockHandler => async (request) => {
      if (wait) await wait(request)
      const id = idOf(request)
      rows = rows.map(r => (r.id === id ? { ...r, status: 'archived' as const, version: r.version + 1 } : r))
      return menuItemOf(id, id, { status: 'archived' })
    },
  }
}

async function open(handlers: Record<string, MockHandler>, path = '/c/nuk/admin/products', first = 'Item 1') {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  await card(page, first).waitFor()
  return { page, api }
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const archives = (calls: string[]) => calls.filter(c => c.endsWith('/archive'))
const selectedCount = (page: Page, n: number) => page.getByText(n ? `${n} selected` : 'None selected', { exact: true })

/** Select mode, then Select all in its bar (D89). */
async function selectAll(page: Page) {
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Select all' }).click()
}

async function bulkArchive(page: Page) {
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive selected' }).click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Archive' }).click()
}

describe('bulk archive vs an edit in progress', () => {
  it('skips the item being saved, archives the others, and keeps the skipped item selected', async () => {
    const save = deferred()
    const [one, two] = rowsOf(2)
    const { page, api } = await open({
      'GET /admin/menu/items': paginatedHandler([one!, two!]),
      'GET /admin/menu/items/{id}': () => menuItemOf('item-1', 'Item 1'),
      'PATCH /admin/menu/items/{id}': save.handler,
      'POST /admin/menu/items/{id}/archive': request => menuItemOf(idOf(request), 'x', { status: 'archived' }),
    })

    // Edit Item 1, save, and close the panel while the save is still running.
    await page.getByRole('button', { name: 'Actions for Item 1' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const form = page.getByRole('dialog', { name: 'Edit menu item' })
    await form.getByLabel('Name', { exact: true }).fill('Item 1b')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await save.started()
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Close' }).click()
    await form.waitFor({ state: 'hidden' })
    // UIcon is aria-hidden, so select the busy spinner by its attribute.
    await page.locator('[aria-label="Working…"]').waitFor()

    // Select all includes the busy item; the archive must still not touch it.
    await selectAll(page)
    await selectedCount(page, 2).waitFor()
    await bulkArchive(page)

    await toast(page, /^1 menu item archived$/).waitFor()
    await page.getByText('1 skipped (another action on it was in progress)').first().waitFor()
    expect(archives(api.calls)).toEqual(['POST /admin/menu/items/item-2/archive'])
    await selectedCount(page, 1).waitFor()

    save.release(menuItemOf('item-1', 'Item 1b', { version: 2 }))
    await toast(page, 'Menu item "Item 1b" updated').waitFor()
  })
})

describe('bulk archive: Stop and Retry failed', () => {
  it('Stop lets running archives finish, starts no more, and keeps the rest selected', async () => {
    const slow = deferred()
    const server = backend(rowsOf(6))
    const { page, api } = await open({ 'GET /admin/menu/items': server.list, 'POST /admin/menu/items/{id}/archive': server.archive(slow.handler) })

    await selectAll(page)
    await selectedCount(page, 6).waitFor()
    await bulkArchive(page)
    await slow.started(4) // concurrency 4: two wait in the queue
    await page.getByRole('button', { name: 'Stop' }).click()
    for (let i = 0; i < 4; i++) slow.release()

    await toast(page, '4 menu items archived').waitFor()
    await page.getByText('2 not started (stopped)').first().waitFor()
    expect(archives(api.calls)).toHaveLength(4)
    await selectedCount(page, 2).waitFor()
  })

  it('Retry failed reruns only the failed archives, without asking again', async () => {
    let failOnce = true
    const server = backend(rowsOf(2))
    const archive = server.archive()
    const { page, api } = await open({
      'GET /admin/menu/items': server.list,
      'POST /admin/menu/items/{id}/archive': (request) => {
        if (idOf(request) === 'item-2' && failOnce) {
          failOnce = false
          throw failures.conflict('VERSION_CONFLICT', 'This menu item was changed by someone else')
        }
        return archive(request)
      },
    })

    await selectAll(page)
    await bulkArchive(page)
    await toast(page, '1 menu item archived, 1 failed').waitFor()
    await page.getByText('This menu item was changed by someone else (1)').first().waitFor()
    await selectedCount(page, 1).waitFor()

    await page.getByRole('button', { name: 'Retry failed' }).click()
    await toast(page, /^1 menu item archived$/).waitFor()
    expect(archives(api.calls)).toEqual(['POST /admin/menu/items/item-1/archive', 'POST /admin/menu/items/item-2/archive', 'POST /admin/menu/items/item-2/archive'])
    expect(await page.getByRole('alertdialog').count()).toBe(0)
  })
})

describe('bulk publish (D125)', () => {
  it('publishes the selected drafts only, after asking; a refused one stays selected with the reason', async () => {
    const rows = [
      menuItemSummaryOf('item-1', 'Item 1'),
      menuItemSummaryOf('item-2', 'Item 2'),
      menuItemSummaryOf('item-3', 'Item 3', { status: 'active' }),
    ]
    const { page, api } = await open({
      'GET /admin/menu/items': paginatedHandler(rows),
      'POST /admin/menu/items/{id}/publish': (request) => {
        if (idOf(request) === 'item-2') throw failures.validation('Switch on and price at least one version before publishing.')
        return menuItemOf(idOf(request), 'x', { status: 'active' })
      },
    })
    await selectAll(page)
    await selectedCount(page, 3).waitFor()
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Publish 2 drafts' }).click()
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await confirm.getByText('Publish 2 menu items?').waitFor()
    await confirm.getByRole('button', { name: 'Publish', exact: true }).click()

    await toast(page, '1 menu item published, 1 failed').waitFor()
    await page.getByText('Switch on and price at least one version before publishing. (1)').first().waitFor()
    expect(api.calls.filter(c => c.endsWith('/publish')).sort()).toEqual(['POST /admin/menu/items/item-1/publish', 'POST /admin/menu/items/item-2/publish'])
    await selectedCount(page, 1).waitFor()
  })
})

describe('list state after archiving and navigation', () => {
  it('archiving the only draft of the last page steps back to the previous page', async () => {
    const server = backend(rowsOf(21))
    const { page } = await open({
      'GET /admin/menu/items': server.list,
      'POST /admin/menu/items/{id}/archive': server.archive(),
    }, '/c/nuk/admin/products?status=draft&page=2', 'Item 21')

    await page.getByRole('button', { name: 'Actions for Item 21' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByRole('button', { name: 'Archive' }).last().click()

    await card(page, 'Item 1').waitFor()
    expect(new URL(page.url()).searchParams.get('page')).toBeNull()
    expect(await page.getByText('No menu items').count()).toBe(0)
  })

  it('clears the selection when the filters or the page change', async () => {
    const server = backend(rowsOf(45))
    const { page } = await open({ 'GET /admin/menu/items': server.list })

    await selectAll(page)
    await selectedCount(page, 20).waitFor()
    await page.getByRole('button', { name: 'Page 2' }).click()
    await card(page, 'Item 21').waitFor()
    // Still in Select mode, with nothing selected.
    await selectedCount(page, 0).waitFor()

    await card(page, 'Item 21').getByRole('checkbox').click()
    await selectedCount(page, 1).waitFor()
    const search = page.getByRole('searchbox', { name: 'Search menu items…' })
    await search.fill('Item 3')
    await search.press('Enter')
    await card(page, 'Item 3').waitFor()
    await selectedCount(page, 0).waitFor()
  })
})
