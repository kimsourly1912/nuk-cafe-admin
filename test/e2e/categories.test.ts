import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MenuCategory } from '../../shared/contracts/menu-categories'
import type { MockHandler } from './support/mock-api'
import { failures, menuCategoryOf, mockApi, setupE2e, toast } from './support/mock-api'

// Categories as a tree (D37) on the new menu API (D55), redesigned in D72: top-level categories as
// groups with their subcategories, loaded whole, filtered and counted on the client; browse,
// select and reorder modes.
await setupE2e()

type Row = MenuCategory
const main = (id: string, name: string, sortOrder: number, overrides: Partial<Row> = {}) => menuCategoryOf(id, name, { sortOrder, ...overrides })
const sub = (id: string, name: string, parent: Row, sortOrder: number, overrides: Partial<Row> = {}) =>
  menuCategoryOf(id, name, { sortOrder, parentId: parent.id, ...overrides })

const BREAKFAST = { id: 'rule-1', name: 'Breakfast', status: 'active' as const }
const LUNCH = { id: 'rule-2', name: 'Lunch', status: 'active' as const }
const DRINKS = main('cat-1', 'Drinks', 1, { childCount: 2, version: 3, description: 'Hot and cold' })
const FOOD = main('cat-2', 'Food', 2, { childCount: 1, version: 2, availabilityRules: [BREAKFAST, LUNCH] })
const COFFEE = sub('cat-11', 'Coffee', DRINKS, 1, { version: 5 })
const TEA = sub('cat-12', 'Tea', DRINKS, 2, { status: 'archived' })
const JUICE = sub('cat-13', 'Juice', DRINKS, 3, { availabilityRules: [BREAKFAST] })
const TOAST = sub('cat-21', 'Toast', FOOD, 1, { itemCount: 4 })
/** A top-level category that holds menu items: it can't take subcategories. */
const SNACKS = main('cat-3', 'Snacks', 3, { itemCount: 3, description: 'Chips and cold nuts' })

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

async function open(handlers: Record<string, MockHandler> = backend(), path = '/c/nuk/admin/categories') {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const item = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true })
/** Names in the order shown (top-level categories and their subcategories, depth-first). */
const shown = (page: Page) => page.locator('[role="list"][aria-label="Categories"] [role="listitem"]').evaluateAll(els =>
  els.map(el => el.getAttribute('aria-label')))
const tab = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Status' }).getByRole('tab', { name })
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

describe('categories tree', () => {
  it('nests active subcategories under their parent, in sort order, on the Active tab by default', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    expect(await shown(page)).toEqual(['Drinks', 'Coffee', 'Juice', 'Food', 'Toast'])
    await item(page, 'Drinks').getByText('2 subcategories', { exact: true }).filter({ visible: true }).waitFor()
    await item(page, 'Drinks').getByText('Hot and cold').waitFor()
    await expect.poll(() => page.getByRole('group', { name: 'Status' }).innerText()).toMatch(/All\s*6\s*Active\s*5\s*Archived\s*1/)
    expect(await tab(page, /Active/).getAttribute('aria-selected')).toBe('true')
  })

  it('says how availability works: Always, Inherits parent, or the rules (one name +N)', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    // A top-level category without rules is always available; a subcategory follows its parent.
    await item(page, 'Drinks').getByText('Always', { exact: true }).filter({ visible: true }).waitFor()
    await item(page, 'Coffee').getByText('Inherits parent', { exact: true }).filter({ visible: true }).waitFor()
    expect(await item(page, 'Coffee').getByText('Always', { exact: true }).count()).toBe(0)
    await item(page, 'Juice').getByText('Breakfast', { exact: true }).filter({ visible: true }).waitFor()
    await item(page, 'Food').getByText('Breakfast +1', { exact: true }).filter({ visible: true }).waitFor()
    // The full list is there for screen readers (and in the tooltip).
    await item(page, 'Food').getByText('Sold only during: Breakfast, Lunch').first().waitFor()
  })

  it('shows archived ones on their tab, under their parent for context, with an Archived badge', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    // The Active view doesn't repeat an "Active" badge on every row.
    expect(await item(page, 'Coffee').getByText('Active', { exact: true }).count()).toBe(0)
    await tab(page, /Archived/).click()
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Tea'])
    await item(page, 'Tea').getByText('Archived', { exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('archived')
  })

  it('collapses and expands one parent, or all of them', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Collapse Drinks' }).click()
    await item(page, 'Coffee').waitFor({ state: 'hidden' })
    expect(await page.getByRole('button', { name: 'Expand Drinks' }).getAttribute('aria-expanded')).toBe('false')
    await page.getByRole('button', { name: 'Expand Drinks' }).click()
    await item(page, 'Coffee').waitFor()

    await button(page, 'Collapse all').click()
    await item(page, 'Coffee').waitFor({ state: 'hidden' })
    await item(page, 'Toast').waitFor({ state: 'hidden' })
    await button(page, 'Expand all').click()
    await item(page, 'Coffee').waitFor()
    await item(page, 'Toast').waitFor()
  })

  it('searches on the client, keeping a matching subcategory under its parent', async () => {
    const { page, api } = await open()
    await item(page, 'Toast').waitFor()
    const loads = api.calls.length
    await page.getByPlaceholder('Search categories…').fill('juice')
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Juice'])
    expect(api.calls.length).toBe(loads)
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('juice')
  })

  it('opens a category from its name, not from anywhere on the row', async () => {
    const { page } = await open()
    await item(page, 'Toast').getByText('Inherits parent', { exact: true }).filter({ visible: true }).click()
    expect(await page.getByRole('dialog').count()).toBe(0)
    await item(page, 'Toast').getByRole('button', { name: 'Toast', exact: true }).click()
    await page.getByRole('dialog', { name: 'Edit category' }).waitFor()
  })

  it('offers Edit, Add subcategory and Archive on a top-level category, Edit and Archive on a subcategory; never Delete', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Actions for Drinks' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Edit', 'Add subcategory', 'Archive'])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Actions for Coffee' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Edit', 'Archive'])
  })

  it('adds a subcategory from the inline action, with the parent filled in, a description and a rule', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open(backend(undefined, {
      'GET /admin/menu/availability-rules': () => [{ ...BREAKFAST, windows: [], itemCount: 0, categoryCount: 0, version: 1, createdAt: '', updatedAt: '' }],
      'POST /admin/menu/categories': (request) => {
        body = request.body as Record<string, unknown>
        return menuCategoryOf('cat-30', 'Sandwiches', { parentId: FOOD.id })
      },
    }))
    await page.getByRole('button', { name: 'Add subcategory to Food' }).click()
    const form = page.getByRole('dialog', { name: 'New subcategory' })
    await expect.poll(() => form.getByRole('button', { name: 'Parent category', exact: true }).textContent()).toContain('Food')
    await form.getByLabel('Name').fill('Sandwiches')
    await form.getByLabel('Description').fill('Toasted to order')
    await form.getByRole('button', { name: 'Availability', exact: true }).click()
    await page.getByRole('option', { name: 'Breakfast' }).click()
    await page.keyboard.press('Escape')
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Category "Sandwiches" created').waitFor()
    expect(body).toEqual({ name: 'Sandwiches', description: 'Toasted to order', parentId: FOOD.id, availabilityRuleIds: ['rule-1'] })
  })

  it('keeps a parent top-level: its parent can\'t change', async () => {
    const { page } = await open()
    await item(page, 'Drinks').getByRole('button', { name: 'Drinks', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Edit category' })
    await form.getByText('It has subcategories, so it stays a top-level category.').waitFor()
    expect(await form.getByRole('button', { name: 'Parent category', exact: true }).isDisabled()).toBe(true)
  })

  it('a save refused because someone else saved first keeps the input; Reload takes the latest version', async () => {
    const versions: number[] = []
    let current = FOOD
    const { page } = await open(backend(undefined, {
      'GET /admin/menu/categories': () => [DRINKS, current, COFFEE, JUICE, TOAST],
      'PATCH /admin/menu/categories/{id}': ({ body }) => {
        const version = (body as { version: number }).version
        versions.push(version)
        if (version !== current.version) throw failures.conflict('VERSION_CONFLICT', 'This category was changed by someone else.')
        return { ...current, name: 'Meals', version: version + 1 }
      },
    }))
    await item(page, 'Food').getByRole('button', { name: 'Food', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Edit category' })
    await form.getByLabel('Name').fill('Meals')
    // Someone else saves Food meanwhile.
    current = { ...FOOD, description: 'Changed elsewhere', version: 3 }
    await form.getByRole('button', { name: 'Save' }).click()
    await form.getByText('Someone else changed this category since you opened it.', { exact: false }).waitFor()
    expect(await form.getByLabel('Name').inputValue()).toBe('Meals')

    await form.getByRole('button', { name: 'Reload' }).click()
    await form.getByText('Not saved').waitFor({ state: 'hidden' })
    expect(await form.getByLabel('Name').inputValue()).toBe('Meals')
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Category "Meals" updated').waitFor()
    expect(versions).toEqual([2, 3])
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

  it('archives a category after saying its active subcategories go too, and restores it', async () => {
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
    await page.getByText('Its 1 active subcategory will be archived too.').waitFor()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, 'Category "Food" archived').waitFor()
    expect(bodies).toEqual([{ version: 2 }])
    await item(page, 'Food').waitFor({ state: 'detached' })

    await tab(page, /Archived/).click()
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Restore'])
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    // Toast was archived with Food: the dialog asks whether it comes back too.
    const dialog = page.getByRole('dialog', { name: 'Restore "Food"?' })
    await dialog.getByRole('checkbox', { name: 'Also restore its 1 archived subcategory' }).waitFor()
    await dialog.getByRole('button', { name: 'Restore' }).click()
    await toast(page, 'Category "Food" restored with 1 subcategory').waitFor()
    expect(api.calls).toContain('POST /admin/menu/categories/cat-2/restore')
  })

  it('a subcategory under an archived parent can\'t be restored before its parent', async () => {
    const { page } = await open(backend([main('cat-1', 'Drinks', 1, { status: 'archived' }), { ...TEA }]), '/c/nuk/admin/categories?status=archived')
    await page.getByRole('button', { name: 'Actions for Tea' }).click()
    const restore = page.getByRole('menuitem', { name: 'Restore (restore "Drinks" first)' })
    await restore.waitFor()
    expect(await restore.getAttribute('data-disabled')).not.toBeNull()
  })
})

describe('category contents and follow-ups', () => {
  const withSnacks = (extra: Record<string, MockHandler> = {}) => backend([TOAST, FOOD, TEA, JUICE, COFFEE, DRINKS, SNACKS], extra)
  const visibleText = (page: Page, name: string, text: string) => item(page, name).getByText(text, { exact: true }).filter({ visible: true })

  it('says what each category contains: subcategories, items, or nothing', async () => {
    const { page } = await open(withSnacks())
    await visibleText(page, 'Drinks', '2 subcategories').first().waitFor()
    await visibleText(page, 'Toast', '4 items').waitFor()
    await visibleText(page, 'Coffee', 'Empty').waitFor()
    await visibleText(page, 'Snacks', '3 items').waitFor()
  })

  it('a category holding menu items can\'t get subcategories, and isn\'t offered as a parent', async () => {
    const { page } = await open(withSnacks())
    await page.getByRole('button', { name: 'Actions for Snacks' }).click()
    const add = page.getByRole('menuitem', { name: 'Add subcategory (it holds menu items)' })
    await add.waitFor()
    expect(await add.getAttribute('data-disabled')).not.toBeNull()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'New category' }).first().click()
    await page.getByRole('dialog', { name: 'New category' }).getByRole('button', { name: 'Parent category', exact: true }).click()
    await page.getByRole('option', { name: 'Drinks' }).waitFor()
    expect(await page.getByRole('option', { name: /Snacks/ }).count()).toBe(0)
  })

  it('warns that archiving hides a category\'s menu items', async () => {
    const { page } = await open(withSnacks())
    await page.getByRole('button', { name: 'Actions for Snacks' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('Customers won\'t see it or its 3 menu items', { exact: false }).waitFor()
  })

  it('restores a parent alone when its subcategories are left unticked', async () => {
    const bodies: unknown[] = []
    const archivedFood = { ...FOOD, status: 'archived' as const, version: 7 }
    const { page } = await open(backend([archivedFood, { ...TOAST, status: 'archived' }], {
      'POST /admin/menu/categories/{id}/restore': ({ body }) => {
        bodies.push(body)
        return { ...archivedFood, status: 'active', childCount: 0 }
      },
    }), '/c/nuk/admin/categories?status=archived')
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    const dialog = page.getByRole('dialog', { name: 'Restore "Food"?' })
    await dialog.getByRole('checkbox', { name: 'Also restore its 1 archived subcategory' }).click()
    await dialog.getByRole('button', { name: 'Restore' }).click()
    await toast(page, 'Category "Food" restored').waitFor()
    expect(bodies).toEqual([{ version: 7 }])
  })

  it('remembers collapsed groups after a reload', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Collapse Drinks' }).click()
    await item(page, 'Coffee').waitFor({ state: 'hidden' })
    await page.goto(page.url(), { waitUntil: 'hydration' })
    await item(page, 'Toast').waitFor()
    await page.getByRole('button', { name: 'Expand Drinks' }).waitFor()
    expect(await item(page, 'Coffee').isVisible()).toBe(false)
  })

  it('finds a category by its description', async () => {
    const { page } = await open(withSnacks())
    await page.getByPlaceholder('Search categories…').fill('nuts')
    await expect.poll(() => shown(page)).toEqual(['Snacks'])
  })

  it('names each rule\'s times for the tooltip and screen readers', async () => {
    const { page } = await open(backend(undefined, {
      'GET /admin/menu/availability-rules': () => [{ ...BREAKFAST, windows: [1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 420, endMinute: 660 })), itemCount: 0, categoryCount: 1, version: 1, createdAt: '', updatedAt: '' }],
    }))
    await item(page, 'Juice').getByText('Sold only during: Breakfast (Mon–Fri · 7:00 AM – 11:00 AM)').first().waitFor({ state: 'attached' })
  })

  it('has shortcuts: S selects, R reorders, Escape leaves either mode', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    await page.keyboard.press('s')
    await page.getByRole('checkbox', { name: 'Select Drinks' }).waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('checkbox').count()).toBe(0)
    await page.keyboard.press('r')
    await page.getByRole('button', { name: /^Reorder Food/ }).waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(0)
  })
})

describe('category selection', () => {
  it('has no checkboxes until Select, and no bulk actions in the All view', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    expect(await page.getByRole('checkbox').count()).toBe(0)
    await tab(page, /All/).click()
    expect(await button(page, 'Select').isDisabled()).toBe(true)
    await tab(page, /^Active/).click()
    await button(page, 'Select').click()
    await page.getByRole('checkbox', { name: 'Select Drinks' }).waitFor()
    // A toggle (D129): the same button leaves Select mode.
    await button(page, 'Cancel selection').click()
    await expect.poll(() => page.getByRole('checkbox').count()).toBe(0)
    await button(page, 'Select').waitFor()
  })

  it('bulk-archives the selection, subcategories first, after one confirmation that warns about subcategories', async () => {
    const order: string[] = []
    const { page } = await open(backend(undefined, {
      'POST /admin/menu/categories/{id}/archive': ({ url, body }) => {
        order.push(`${url.pathname.split('/').at(-2)} v${(body as { version: number }).version}`)
        return null
      },
    }))
    await button(page, 'Select').click()
    await page.getByRole('checkbox', { name: 'Select Drinks' }).click()
    // The name selects too (a larger target).
    await item(page, 'Coffee').getByRole('button', { name: 'Coffee', exact: true }).click()
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await bar.getByText('2 selected').waitFor()
    await bar.getByRole('button', { name: 'Archive selected' }).click()
    await page.getByText('Top-level categories take their active subcategories with them.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, '2 categories archived').waitFor()
    // Each archive names the version it read.
    expect(order).toEqual(['cat-11 v5', 'cat-1 v3'])
  })

  it('keeps the failed ones selected', async () => {
    const { page } = await open(backend(undefined, {
      'POST /admin/menu/categories/{id}/archive': ({ url }) => {
        if (url.pathname.includes('cat-13')) throw failures.conflict('VERSION_CONFLICT', 'This category was changed by someone else.')
        return null
      },
    }))
    await button(page, 'Select').click()
    await page.getByRole('checkbox', { name: 'Select Coffee' }).click()
    await page.getByRole('checkbox', { name: 'Select Juice' }).click()
    await page.getByRole('button', { name: 'Archive selected' }).click()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, '1 category archived, 1 failed').waitFor()
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByText('1 selected').waitFor()
    expect(await page.getByRole('checkbox', { name: 'Select Juice' }).getAttribute('aria-checked')).toBe('true')
  })

  it('bulk-restores in the Archived view, parents before their subcategories', async () => {
    const order: string[] = []
    const archivedDrinks = main('cat-1', 'Drinks', 1, { status: 'archived' })
    const { page } = await open(backend([archivedDrinks, TEA, FOOD], {
      'POST /admin/menu/categories/{id}/restore': ({ url }) => {
        order.push(url.pathname.split('/').at(-2)!)
        return null
      },
    }), '/c/nuk/admin/categories?status=archived')
    await button(page, 'Select').click()
    await page.getByRole('checkbox', { name: 'Select Tea' }).click()
    await page.getByRole('checkbox', { name: 'Select Drinks' }).click()
    await page.getByRole('button', { name: 'Restore selected' }).click()
    await page.getByRole('button', { name: 'Restore' }).last().click()
    await toast(page, '2 categories restored').waitFor()
    expect(order).toEqual(['cat-1', 'cat-12'])
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

  it('shows handles only in Reorder mode', async () => {
    const { page } = await open()
    await item(page, 'Toast').waitFor()
    expect(await page.getByRole('button', { name: /^Reorder / }).count()).toBe(0)
    await button(page, 'Reorder').click()
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(5)
    // A toggle (D129): the same button leaves Reorder mode.
    await button(page, 'Done reordering').click()
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(0)
  })

  it('reorders top-level categories with the keyboard and saves only that level, each with its version', async () => {
    const bodies: unknown[] = []
    const { page } = await open(saving(b => bodies.push(b)))
    await button(page, 'Reorder').click()
    const handle = page.getByRole('button', { name: /^Reorder Food/ })
    await handle.press('ArrowUp')
    await expect.poll(() => shown(page)).toEqual(['Food', 'Toast', 'Drinks', 'Coffee', 'Juice'])
    // Focus follows the moved group.
    expect(await handle.evaluate(el => el === document.activeElement)).toBe(true)
    await page.getByText('The new order isn\'t saved yet.').waitFor()
    await button(page, 'Save order').click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies).toEqual([{ parentId: null, items: [{ id: 'cat-2', version: 2 }, { id: 'cat-1', version: 3 }] }])
    // Saved: back to browsing.
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(0)
  })

  it('moves with the up and down buttons, subcategories within their parent only', async () => {
    const bodies: unknown[] = []
    const { page } = await open(saving(b => bodies.push(b)))
    await button(page, 'Reorder').click()
    await button(page, 'Move Juice up').click()
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Juice', 'Coffee', 'Food', 'Toast'])
    // The last subcategory can't leave its parent, and the first top-level can't go up.
    expect(await button(page, 'Move Coffee down').isDisabled()).toBe(true)
    expect(await button(page, 'Move Drinks up').isDisabled()).toBe(true)
    await button(page, 'Save order').click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies).toEqual([{ parentId: 'cat-1', items: [{ id: 'cat-13', version: 1 }, { id: 'cat-11', version: 5 }] }])
  })

  it('saves one request per changed level', async () => {
    const bodies: { parentId: string | null }[] = []
    const { page } = await open(saving(b => bodies.push(b as { parentId: string | null })))
    await button(page, 'Reorder').click()
    await page.getByRole('button', { name: /^Reorder Juice/ }).press('ArrowUp')
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    await button(page, 'Save order').click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies.map(b => b.parentId)).toEqual([null, 'cat-1'])
  })

  it('reorders top-level categories by dragging the handle with the mouse', async () => {
    const { page } = await open()
    await button(page, 'Reorder').click()
    await page.getByRole('button', { name: /^Reorder Food/ }).dragTo(page.getByRole('button', { name: /^Reorder Drinks/ }))
    await expect.poll(async () => (await shown(page))[0]).toBe('Food')
    await page.getByText('The new order isn\'t saved yet.').waitFor()
  })

  it('discard puts the server order back and sends nothing', async () => {
    const { page, api } = await open()
    await button(page, 'Reorder').click()
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    // Unsaved moves: Done waits for Save or Discard.
    expect(await button(page, 'Done reordering').isDisabled()).toBe(true)
    await button(page, 'Discard').click()
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Coffee', 'Juice', 'Food', 'Toast'])
    expect(api.calls.filter(c => c.startsWith('PUT'))).toEqual([])
    await expect.poll(() => button(page, 'Done reordering').isEnabled()).toBe(true)
  })

  it('keeps the new order when someone else changed a level; Reload takes their versions and Save works again', async () => {
    const bodies: { items: { id: string, version: number }[] }[] = []
    let rows = [TOAST, FOOD, TEA, JUICE, COFFEE, DRINKS]
    const { page } = await open(backend(undefined, {
      'GET /admin/menu/categories': () => rows,
      'PUT /admin/menu/categories/order': ({ body }) => {
        const request = body as { items: { id: string, version: number }[] }
        bodies.push(request)
        if (request.items.some(i => i.version !== rows.find(r => r.id === i.id)?.version)) throw failures.conflict('VERSION_CONFLICT', 'The categories at this level changed. Reload them and try again.')
        return []
      },
    }))
    await button(page, 'Reorder').click()
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    // Someone else edits Drinks meanwhile.
    rows = rows.map(r => (r.id === DRINKS.id ? { ...r, version: 4 } : r))
    await button(page, 'Save order').click()
    await page.getByText('Someone else changed these categories.', { exact: false }).waitFor()
    expect((await shown(page))[0]).toBe('Food')

    await button(page, 'Reload').click()
    await button(page, 'Reload').waitFor({ state: 'detached' })
    expect((await shown(page))[0]).toBe('Food')
    await button(page, 'Save order').click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies.at(-1)!.items).toEqual([{ id: 'cat-2', version: 2 }, { id: 'cat-1', version: 4 }])
  })

  it('locks the search and tabs in Reorder mode, and asks before leaving with an unsaved order', async () => {
    const { page } = await open()
    await button(page, 'Reorder').click()
    expect(await page.getByPlaceholder('Search categories…').isDisabled()).toBe(true)
    await page.getByRole('button', { name: /^Reorder Food/ }).press('ArrowUp')
    await page.getByRole('link', { name: /Availability/ }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('reorders the whole active tree: starting it clears a search and shows the Active tab', async () => {
    const { page } = await open(backend(), '/c/nuk/admin/categories?search=o&status=all')
    await item(page, 'Coffee').waitFor()
    await button(page, 'Reorder').click()
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(5)
    await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual({})
    expect(await page.getByPlaceholder('Search categories…').inputValue()).toBe('')
  })
})

describe('categories on a phone', () => {
  async function openPhone(handlers: Record<string, MockHandler> = backend()) {
    const page = await createPage()
    await page.setViewportSize({ width: 375, height: 812 })
    const api = await mockApi(page, handlers)
    await page.goto(url('/c/nuk/admin/categories'), { waitUntil: 'hydration' })
    await item(page, 'Toast').waitFor()
    return { page, api }
  }

  it('fits the screen, with the New category button in reach', async () => {
    const { page } = await openPhone()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const add = page.getByRole('button', { name: 'New category' }).first()
    await add.click()
    await page.getByRole('dialog', { name: 'New category' }).waitFor()
  })

  it('pins the selection bar to the bottom of the screen', async () => {
    const { page } = await openPhone()
    await button(page, 'Select').click()
    await page.getByRole('checkbox', { name: 'Select Drinks' }).click()
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await bar.getByText('1 selected').waitFor()
    const box = (await bar.boundingBox())!
    expect(Math.round(box.y + box.height)).toBe(812)
  })

  it('reorders with up and down buttons, and pins Save and Discard to the bottom', async () => {
    const { page } = await openPhone()
    await button(page, 'Reorder').click()
    await button(page, 'Move Food up').click()
    await expect.poll(async () => (await shown(page))[0]).toBe('Food')
    const bar = page.getByRole('toolbar', { name: 'Reorder' })
    await bar.getByRole('button', { name: 'Save order' }).waitFor()
    const box = (await bar.boundingBox())!
    expect(Math.round(box.y + box.height)).toBe(812)
  })
})

describe('categories on the UI standard (D85)', () => {
  async function openAt(width: number, path = '/c/nuk/admin/categories') {
    const page = await createPage()
    await page.setViewportSize({ width, height: 844 })
    await mockApi(page, backend())
    await page.goto(url(path), { waitUntil: 'hydration' })
    await item(page, 'Toast').waitFor()
    return page
  }

  it('opens a category from its name, with the actions beside the name (not inside it)', async () => {
    const page = await openAt(390)
    const target = item(page, 'Coffee').getByRole('button', { name: 'Coffee', exact: true })
    const actions = item(page, 'Coffee').getByRole('button', { name: 'Actions for Coffee' })
    expect(await actions.evaluate(el => el.parentElement?.closest('button, a') === null)).toBe(true)
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await target.click()
    await page.getByRole('dialog', { name: 'Edit category' }).waitFor()
  })

  it('lays the tree out by its own width: stacked narrow, in columns when there is room', async () => {
    const heading = (page: Page) => page.getByText('Contains', { exact: true }).filter({ visible: true })
    const narrow = await openAt(640)
    expect(await heading(narrow).count()).toBe(0)
    await item(narrow, 'Coffee').getByText('Empty · Inherits parent').waitFor()
    const wide = await openAt(1024)
    await heading(wide).waitFor()
    expect(await wide.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  it('shows the status next to the name in the All view', async () => {
    const page = await openAt(1024, '/c/nuk/admin/categories?status=all')
    await item(page, 'Tea').getByText('Archived', { exact: true }).waitFor()
    const name = (await item(page, 'Tea').getByText('Tea', { exact: true }).boundingBox())!
    const badge = (await item(page, 'Tea').getByText('Archived', { exact: true }).boundingBox())!
    expect(Math.abs(badge.y + badge.height / 2 - (name.y + name.height / 2))).toBeLessThan(8)
  })
})
