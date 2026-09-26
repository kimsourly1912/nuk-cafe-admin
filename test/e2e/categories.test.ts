import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { failures, mockApi, setupE2e, toast } from './support/mock-api'

// Categories as a tree (docs/plans/list-ui-refresh.md, D37): mains with their subs, loaded whole,
// filtered and counted on the client.
await setupE2e()

type Row = { id: number, categoryName: string, status: string, type: string, sortOrder: number, mainCategoryId?: number, mainCategory?: { id: number, categoryName: string } }
const main = (id: number, name: string, sortOrder: number, status = 'ACTIVE'): Row => ({ id, categoryName: name, status, type: 'MAIN', sortOrder })
const sub = (id: number, name: string, parent: Row, sortOrder: number, status = 'ACTIVE'): Row =>
  ({ id, categoryName: name, status, type: 'SUB', sortOrder, mainCategoryId: parent.id, mainCategory: { id: parent.id, categoryName: parent.categoryName } })

const DRINKS = main(1, 'Drinks', 1)
const FOOD = main(2, 'Food', 2)
const COFFEE = sub(11, 'Coffee', DRINKS, 1)
const TEA = sub(12, 'Tea', DRINKS, 2, 'INACTIVE')
const TOAST = sub(21, 'Toast', FOOD, 1)

/** A backend whose list reflects deletes. Out of order on purpose: the page sorts. */
function backend(initial: Row[] = [TOAST, FOOD, TEA, COFFEE, DRINKS], extra: Record<string, MockHandler> = {}) {
  let rows = [...initial]
  return {
    'GET /staff/categories/all': () => rows,
    'DELETE /staff/categories/{id}': ({ url }) => {
      rows = rows.filter(r => r.id !== Number(url.pathname.split('/').pop()))
      return null
    },
    ...extra,
  } satisfies Record<string, MockHandler>
}

async function open(handlers: Record<string, MockHandler> = backend(), path = '/categories') {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const item = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true })
/** Names in the order shown (mains and their subs, depth-first). */
const shown = (page: Page) => page.locator('[role="list"][aria-label="Categories"] [role="listitem"]').evaluateAll(els =>
  els.map(el => el.getAttribute('aria-label')))

describe('categories tree', () => {
  it('nests sub-categories under their main, both in sort order, with counts', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    expect(await shown(page)).toEqual(['Drinks', 'Coffee', 'Tea', 'Food', 'Toast'])
    await item(page, 'Drinks').getByText('2 sub-categories').waitFor()
    await expect.poll(() => page.getByRole('group', { name: 'Status' }).innerText()).toMatch(/All\s*5\s*Active\s*4\s*Inactive\s*1/)
  })

  it('collapses and expands a main category', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Collapse Drinks' }).click()
    await item(page, 'Coffee').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Expand Drinks' }).click()
    await item(page, 'Coffee').waitFor()
  })

  it('searches on the client, keeping a matching sub under its main', async () => {
    const { page, api } = await open()
    await item(page, 'Toast').waitFor()
    const loads = api.calls.length
    await page.getByPlaceholder('Search categories…').fill('tea')
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Tea'])
    expect(api.calls.length).toBe(loads)
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('tea')
  })

  it('filters by status with the tabs', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    await page.getByRole('group', { name: 'Status' }).getByRole('tab', { name: /Inactive/ }).click()
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Tea'])
  })

  it('opens a category by clicking its row', async () => {
    const { page } = await open()
    await item(page, 'Toast').getByText('Toast').click()
    await page.getByRole('dialog', { name: 'Edit category' }).waitFor()
  })

  it('adds a sub-category with the parent filled in', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open(backend(undefined, {
      'POST /staff/categories': (request) => {
        body = request.body as Record<string, unknown>
        return { id: 30 }
      },
    }))
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    await page.getByRole('menuitem', { name: 'Add sub-category' }).click()
    const form = page.getByRole('dialog', { name: 'New sub-category' })
    await expect.poll(() => form.getByRole('combobox').first().textContent()).toContain('Food')
    await form.getByLabel('Name').fill('Sandwiches')
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Category "Sandwiches" created').waitFor()
    expect(body).toMatchObject({ categoryName: 'Sandwiches', mainCategoryId: 2 })
  })

  it('shows the load error with Retry', async () => {
    let fail = true
    const { page } = await open({
      'GET /staff/categories/all': () => {
        if (fail) throw failures.technical()
        return [DRINKS]
      },
    })
    await page.getByText('Could not load categories').waitFor()
    fail = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await item(page, 'Drinks').waitFor()
  })

  it('deletes a category after confirmation', async () => {
    const { page, api } = await open()
    await page.getByRole('button', { name: 'Actions for Toast' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByText('Delete "Toast"?').waitFor()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Category "Toast" deleted').waitFor()
    expect(api.calls).toContain('DELETE /staff/categories/21')
    await item(page, 'Toast').waitFor({ state: 'detached' })
  })

  it('bulk-deletes the selection, sub-categories first, with one confirmation', async () => {
    const order: string[] = []
    const { page } = await open(backend(undefined, {
      'DELETE /staff/categories/{id}': ({ url }) => {
        order.push(url.pathname.split('/').pop()!)
        return null
      },
    }))
    await page.getByRole('checkbox', { name: 'Select Drinks' }).click()
    await page.getByRole('checkbox', { name: 'Select Coffee' }).click()
    await page.getByText('2 selected').waitFor()
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, '2 categories deleted').waitFor()
    expect(order).toEqual(['11', '1'])
  })
})

describe('category order', () => {
  function saving(record: (body: unknown) => void, fail = false): Record<string, MockHandler> {
    return backend(undefined, {
      'PUT /staff/categories/sort-order': (request) => {
        record(request.body)
        if (fail) throw failures.validation('Sort order must be unique')
        return null
      },
    })
  }

  it('reorders mains with the keyboard and saves only the mains, numbered from 1', async () => {
    let body: unknown
    const { page } = await open(saving(b => (body = b)))
    const handle = page.getByRole('button', { name: /^Reorder Food/ })
    await handle.press('ArrowUp')
    await expect.poll(() => shown(page)).toEqual(['Food', 'Toast', 'Drinks', 'Coffee', 'Tea'])
    // Focus follows the moved group.
    expect(await handle.evaluate(el => el === document.activeElement)).toBe(true)
    await page.getByText('The new order isn\'t saved yet.').waitFor()
    await page.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Category order saved').waitFor()
    expect(body).toEqual({ items: [{ id: 2, sortOrder: 1 }, { id: 1, sortOrder: 2 }] })
  })

  it('reorders subs within their main only, numbered from 1 for that main', async () => {
    let body: unknown
    const { page } = await open(saving(b => (body = b)))
    await page.getByRole('button', { name: /^Reorder Tea/ }).press('ArrowUp')
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Tea', 'Coffee', 'Food', 'Toast'])
    // The last sub can't leave its main.
    await page.getByRole('button', { name: /^Reorder Coffee/ }).press('ArrowDown')
    expect(await shown(page)).toEqual(['Drinks', 'Tea', 'Coffee', 'Food', 'Toast'])
    await page.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Category order saved').waitFor()
    expect(body).toEqual({ items: [{ id: 12, sortOrder: 1 }, { id: 11, sortOrder: 2 }] })
  })

  it('reorders mains by dragging the handle with the mouse', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: /^Reorder Food/ }).dragTo(page.getByRole('button', { name: /^Reorder Drinks/ }))
    await expect.poll(async () => (await shown(page))[0]).toBe('Food')
    await page.getByText('The new order isn\'t saved yet.').waitFor()
  })

  it('discard puts the server order back and sends nothing', async () => {
    const { page, api } = await open()
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Coffee', 'Tea', 'Food', 'Toast'])
    expect(api.calls.filter(c => c.startsWith('PUT'))).toEqual([])
  })

  it('keeps the new order and says why when saving fails', async () => {
    const { page } = await open(saving(() => {}, true))
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    await page.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Could not save the category order').waitFor()
    await page.getByText('Sort order must be unique').first().waitFor()
    expect((await shown(page))[0]).toBe('Food')
  })

  it('locks the filters and asks before leaving while the order is unsaved', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    expect(await page.getByPlaceholder('Search categories…').isDisabled()).toBe(true)
    await page.getByRole('link', { name: /Schedules/ }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('needs the whole tree to reorder: with a search, handles hide and the banner explains', async () => {
    const { page } = await open(backend(), '/categories?search=o')
    await page.getByText('Clear the search and status filter to change the order.').waitFor()
    expect(await page.getByRole('button', { name: /^Reorder / }).count()).toBe(0)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(5)
  })
})
