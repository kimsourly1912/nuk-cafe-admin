import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MenuCategory } from '../../shared/contracts/menu-categories'
import type { MockHandler } from './support/mock-api'
import { failures, menuCategoryOf, mockApi, setupE2e, toast } from './support/mock-api'

// Categories as a tree (docs/plans/list-ui-refresh.md, D37) on the new menu API (D55, step 3.8b
// part 3): mains with their subs, loaded whole, filtered and counted on the client.
await setupE2e()

type Row = MenuCategory
const main = (id: string, name: string, sortOrder: number, overrides: Partial<Row> = {}) => menuCategoryOf(id, name, { sortOrder, ...overrides })
const sub = (id: string, name: string, parent: Row, sortOrder: number, overrides: Partial<Row> = {}) =>
  menuCategoryOf(id, name, { sortOrder, parentId: parent.id, ...overrides })

const DRINKS = main('cat-1', 'Drinks', 1, { childCount: 1, version: 3 })
const FOOD = main('cat-2', 'Food', 2, { childCount: 1, version: 2 })
const COFFEE = sub('cat-11', 'Coffee', DRINKS, 1, { version: 5 })
const TEA = sub('cat-12', 'Tea', DRINKS, 2, { status: 'archived' })
const JUICE = sub('cat-13', 'Juice', DRINKS, 3, { availabilityRules: [{ id: 'rule-1', name: 'Breakfast', status: 'active' }] })
const TOAST = sub('cat-21', 'Toast', FOOD, 1)

/** A backend whose list reflects archives and restores. Out of order on purpose: the page sorts. */
function backend(initial: Row[] = [TOAST, FOOD, TEA, JUICE, COFFEE, DRINKS], extra: Record<string, MockHandler> = {}) {
  let rows = [...initial]
  const setStatus = (id: string, status: Row['status']) => {
    rows = rows.map(r => (r.id === id || (status === 'archived' && r.parentId === id) ? { ...r, status, version: r.version + 1 } : r))
    return rows.find(r => r.id === id)
  }
  return {
    'GET /admin/menu/categories': () => rows,
    'GET /admin/menu/availability-rules': () => [],
    'POST /admin/menu/categories/{id}/archive': ({ url }) => setStatus(url.pathname.split('/').at(-2)!, 'archived'),
    'POST /admin/menu/categories/{id}/restore': ({ url }) => setStatus(url.pathname.split('/').at(-2)!, 'active'),
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
const tab = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Status' }).getByRole('tab', { name })

describe('categories tree', () => {
  it('nests active sub-categories under their main, both in sort order, with counts and rules', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    expect(await shown(page)).toEqual(['Drinks', 'Coffee', 'Juice', 'Food', 'Toast'])
    await item(page, 'Drinks').getByText('2 sub-categories').waitFor()
    await item(page, 'Juice').getByText('Breakfast').waitFor()
    await expect.poll(() => page.getByRole('group', { name: 'Status' }).innerText()).toMatch(/All\s*6\s*Active\s*5\s*Archived\s*1/)
  })

  it('shows archived ones on their tab, under their main for context', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    await tab(page, /Archived/).click()
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Tea'])
    await item(page, 'Tea').getByText('Archived').waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('archived')
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
    await page.getByPlaceholder('Search categories…').fill('juice')
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Juice'])
    expect(api.calls.length).toBe(loads)
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('juice')
  })

  it('opens a category by clicking its row', async () => {
    const { page } = await open()
    await item(page, 'Toast').getByText('Toast').click()
    await page.getByRole('dialog', { name: 'Edit category' }).waitFor()
  })

  it('adds a sub-category with the parent filled in, a description and a rule', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open(backend(undefined, {
      'GET /admin/menu/availability-rules': () => [{ id: 'rule-1', name: 'Breakfast', status: 'active', windows: [], itemCount: 0, categoryCount: 0, version: 1, createdAt: '', updatedAt: '' }],
      'POST /admin/menu/categories': (request) => {
        body = request.body as Record<string, unknown>
        return menuCategoryOf('cat-30', 'Sandwiches', { parentId: FOOD.id })
      },
    }))
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    await page.getByRole('menuitem', { name: 'Add sub-category' }).click()
    const form = page.getByRole('dialog', { name: 'New sub-category' })
    await expect.poll(() => form.getByRole('combobox', { name: 'Parent category' }).textContent()).toContain('Food')
    await form.getByLabel('Name').fill('Sandwiches')
    await form.getByLabel('Description').fill('Toasted to order')
    await form.getByRole('combobox', { name: 'Availability' }).click()
    await page.getByRole('option', { name: 'Breakfast' }).click()
    await page.keyboard.press('Escape')
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Category "Sandwiches" created').waitFor()
    expect(body).toEqual({ name: 'Sandwiches', description: 'Toasted to order', parentId: FOOD.id, availabilityRuleIds: ['rule-1'] })
  })

  it('keeps a main with sub-categories a main: its parent can\'t change', async () => {
    const { page } = await open()
    await item(page, 'Drinks').getByText('Drinks').first().click()
    const form = page.getByRole('dialog', { name: 'Edit category' })
    await form.getByText('It has sub-categories, so it stays a main category.').waitFor()
    expect(await form.getByRole('combobox', { name: 'Parent category' }).isDisabled()).toBe(true)
  })

  it('shows the load error with Retry', async () => {
    let fail = true
    const { page } = await open({
      'GET /admin/menu/categories': () => {
        if (fail) throw failures.server()
        return [DRINKS]
      },
    })
    await page.getByText('Could not load categories').waitFor()
    fail = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await item(page, 'Drinks').waitFor()
  })

  it('archives a category after saying its sub-categories go too, and restores it', async () => {
    const bodies: unknown[] = []
    const base = backend()
    const { page, api } = await open({
      ...base,
      'POST /admin/menu/categories/{id}/archive': (request) => {
        bodies.push(request.body)
        return base['POST /admin/menu/categories/{id}/archive'](request)
      },
    })
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('Its 1 sub-category will be archived too.').waitFor()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, 'Category "Food" archived').waitFor()
    expect(bodies).toEqual([{ version: 2 }])
    await item(page, 'Food').waitFor({ state: 'detached' })

    await tab(page, /Archived/).click()
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    await toast(page, 'Category "Food" restored').waitFor()
    expect(api.calls).toContain('POST /admin/menu/categories/cat-2/restore')
  })

  it('bulk-archives the selection, sub-categories first, with one confirmation', async () => {
    const order: string[] = []
    const { page } = await open(backend(undefined, {
      'POST /admin/menu/categories/{id}/archive': ({ url, body }) => {
        order.push(`${url.pathname.split('/').at(-2)} v${(body as { version: number }).version}`)
        return null
      },
    }))
    await page.getByRole('checkbox', { name: 'Select Drinks' }).click()
    await page.getByRole('checkbox', { name: 'Select Coffee' }).click()
    await page.getByText('2 selected').waitFor()
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, '2 categories archived').waitFor()
    // Each archive names the version it read.
    expect(order).toEqual(['cat-11 v5', 'cat-1 v3'])
  })
})

describe('category order', () => {
  function saving(record: (body: unknown) => void, fail = false): Record<string, MockHandler> {
    return backend(undefined, {
      'PUT /admin/menu/categories/order': (request) => {
        record(request.body)
        if (fail) throw failures.conflict('VERSION_CONFLICT', 'The categories at this level changed. Reload them and try again.')
        return []
      },
    })
  }

  it('reorders mains with the keyboard and saves only the mains, each with its version', async () => {
    const bodies: unknown[] = []
    const { page } = await open(saving(b => bodies.push(b)))
    const handle = page.getByRole('button', { name: /^Reorder Food/ })
    await handle.press('ArrowUp')
    await expect.poll(() => shown(page)).toEqual(['Food', 'Toast', 'Drinks', 'Coffee', 'Juice'])
    // Focus follows the moved group.
    expect(await handle.evaluate(el => el === document.activeElement)).toBe(true)
    await page.getByText('The new order isn\'t saved yet.').waitFor()
    await page.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies).toEqual([{ parentId: null, items: [{ id: 'cat-2', version: 2 }, { id: 'cat-1', version: 3 }] }])
  })

  it('reorders subs within their main only; the archived sub has no place in the order', async () => {
    const bodies: unknown[] = []
    const { page } = await open(saving(b => bodies.push(b)))
    await page.getByRole('button', { name: /^Reorder Juice/ }).press('ArrowUp')
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Juice', 'Coffee', 'Food', 'Toast'])
    // The last sub can't leave its main.
    await page.getByRole('button', { name: /^Reorder Coffee/ }).press('ArrowDown')
    expect(await shown(page)).toEqual(['Drinks', 'Juice', 'Coffee', 'Food', 'Toast'])
    await page.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies).toEqual([{ parentId: 'cat-1', items: [{ id: 'cat-13', version: 1 }, { id: 'cat-11', version: 5 }] }])
  })

  it('saves one request per changed level', async () => {
    const bodies: { parentId: string | null }[] = []
    const { page } = await open(saving(b => bodies.push(b as { parentId: string | null })))
    await page.getByRole('button', { name: /^Reorder Juice/ }).press('ArrowUp')
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    await page.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies.map(b => b.parentId)).toEqual([null, 'cat-1'])
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
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Coffee', 'Juice', 'Food', 'Toast'])
    expect(api.calls.filter(c => c.startsWith('PUT'))).toEqual([])
  })

  it('keeps the new order and says why when saving fails', async () => {
    const { page } = await open(saving(() => {}, true))
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    await page.getByRole('button', { name: 'Save order' }).click()
    await toast(page, 'Could not save the category order').waitFor()
    await page.getByText('The categories at this level changed.').first().waitFor()
    expect((await shown(page))[0]).toBe('Food')
  })

  it('locks the filters and asks before leaving while the order is unsaved', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    expect(await page.getByPlaceholder('Search categories…').isDisabled()).toBe(true)
    await page.getByRole('link', { name: /Availability/ }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('needs every active category to reorder: with a search, handles hide and the banner explains', async () => {
    const { page } = await open(backend(), '/categories?search=o')
    await page.getByText('Clear the search and show the Active tab to change the order.').waitFor()
    expect(await page.getByRole('button', { name: /^Reorder / }).count()).toBe(0)
    await page.getByRole('button', { name: 'Show all active' }).click()
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(5)
  })
})
