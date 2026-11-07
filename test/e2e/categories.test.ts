import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MenuCategory } from '../../shared/contracts/menu-categories'
import { allowBrowserProblems } from './support/browser-problems'
import type { MockHandler } from './support/mock-api'
import { beforeUnloadPrevented, failures, menuCategoryOf, mockApi, setupE2e, stretchedTarget, toast } from './support/mock-api'

// Categories on the new menu API (D55) as two panels (D270): the main categories, and beside them a
// banner and the subcategories of the one on show; loaded whole, filtered and counted on the client;
// browse, select and reorder modes (D72).
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
  // Like the server (D200): an archived category holding subcategories or items can't be deleted.
  const blockerOf = (r: Row): Row['deleteBlocker'] => r.status !== 'archived' ? null : rows.some(c => c.parentId === r.id) ? 'subcategories' : r.itemCount ? 'items' : null
  const setStatus = (id: string, status: Row['status']) => {
    rows = rows.map(r => (r.id === id || (status === 'archived' && r.parentId === id) ? { ...r, status, version: r.version + 1 } : r))
    rows = rows.map(r => (r.id === id || r.parentId === id ? { ...r, deleteBlocker: blockerOf(r) } : r))
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
const namesIn = (page: Page, list: string) => page.locator(`[role="list"]${list} [role="listitem"]`).evaluateAll(els =>
  els.map(el => el.getAttribute('aria-label')))
/** The main categories' names, in the order shown. */
const shown = (page: Page) => namesIn(page, '[aria-label="Categories"]')
/** The names of the subcategories on show, in order. */
const subs = (page: Page) => namesIn(page, '[aria-label^="Subcategories of"]')
const banner = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
/** Shows a main category's subcategories. */
const showMain = (page: Page, name: string) => item(page, name).getByRole('button', { name, exact: true }).click()
const inUrl = (page: Page, key: string) => new URL(page.url()).searchParams.get(key)
const tab = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Status' }).getByRole('tab', { name })
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

describe('categories tree', () => {
  it('lists the main categories, with the first one\'s active subcategories beside them, in sort order', async () => {
    const { page } = await open()
    await item(page, 'Coffee').waitFor()
    expect(await shown(page)).toEqual(['Drinks', 'Food'])
    expect(await subs(page)).toEqual(['Coffee', 'Juice'])
    await item(page, 'Drinks').getByText('2 subcategories', { exact: true }).waitFor()
    await banner(page, 'Drinks').getByText('Hot and cold').waitFor()
    await page.getByRole('heading', { name: 'Subcategories in Drinks' }).waitFor()
    await expect.poll(() => page.getByRole('group', { name: 'Status' }).innerText()).toMatch(/All\s*6\s*Active\s*5\s*Archived\s*1/)
    expect(await tab(page, /Active/).getAttribute('aria-selected')).toBe('true')
  })

  it('shows another main category from its name, keeps it in the URL and after a reload', async () => {
    const { page } = await open()
    await item(page, 'Coffee').waitFor()
    await showMain(page, 'Food')
    await item(page, 'Toast').waitFor()
    await expect.poll(() => subs(page)).toEqual(['Toast'])
    expect(inUrl(page, 'category')).toBe('cat-2')
    expect(await item(page, 'Food').getByRole('button', { name: 'Food', exact: true }).getAttribute('aria-current')).toBe('true')
    expect(await item(page, 'Drinks').getByRole('button', { name: 'Drinks', exact: true }).getAttribute('aria-current')).toBeNull()
    await page.goto(page.url(), { waitUntil: 'hydration' })
    await item(page, 'Toast').waitFor()
    await banner(page, 'Food').waitFor()
  })

  it('shows the first one when the URL names a category that isn\'t there', async () => {
    const { page } = await open(backend(), '/c/nuk/admin/categories?category=gone')
    await banner(page, 'Drinks').waitFor()
    expect(await subs(page)).toEqual(['Coffee', 'Juice'])
  })

  it('numbers subcategories only where the position means something', async () => {
    const { page } = await open()
    await item(page, 'Juice').getByText('02', { exact: true }).waitFor()
    await page.getByPlaceholder('Search categories…').fill('juice')
    await expect.poll(() => subs(page)).toEqual(['Juice'])
    await expect.poll(() => item(page, 'Juice').getByText('02', { exact: true }).count()).toBe(0)
  })

  it('counts a main category\'s items across its active subcategories, whatever the search shows', async () => {
    const LATTE = sub('cat-14', 'Latte', DRINKS, 4, { itemCount: 5 })
    const { page } = await open(backend([DRINKS, { ...COFFEE, itemCount: 2 }, LATTE, { ...TEA, itemCount: 9 }, { ...DRINKS, id: 'x', name: 'Other', sortOrder: 2, childCount: 0 }]))
    await item(page, 'Drinks').getByText('2 subcategories · 7 items', { exact: true }).waitFor()
    await banner(page, 'Drinks').getByText('7 items across 2 subcategories', { exact: true }).waitFor()
    await page.getByPlaceholder('Search categories…').fill('latte')
    await expect.poll(() => subs(page)).toEqual(['Latte'])
    await item(page, 'Drinks').getByText('2 subcategories · 7 items', { exact: true }).waitFor()
  })

  it('says how availability works: Always, Inherits parent, or the rules (one name +N)', async () => {
    const { page } = await open()
    await item(page, 'Coffee').waitFor()
    // A top-level category without rules is always available; a subcategory follows its parent.
    await banner(page, 'Drinks').getByText('Always', { exact: true }).waitFor()
    await item(page, 'Coffee').getByText('Inherits parent', { exact: true }).filter({ visible: true }).waitFor()
    expect(await item(page, 'Coffee').getByText('Always', { exact: true }).count()).toBe(0)
    await item(page, 'Juice').getByText('Breakfast', { exact: true }).filter({ visible: true }).waitFor()
    await showMain(page, 'Food')
    await banner(page, 'Food').getByText('Breakfast +1', { exact: true }).waitFor()
    // The full list is there for screen readers (and in the tooltip).
    await banner(page, 'Food').getByText('Sold only during: Breakfast, Lunch').first().waitFor()
  })

  it('shows archived ones on their tab, beside their parent for context, with an Archived badge', async () => {
    const { page } = await open()
    await item(page, 'Coffee').waitFor()
    // The Active view doesn't repeat an "Active" badge on every row.
    expect(await item(page, 'Coffee').getByText('Active', { exact: true }).count()).toBe(0)
    await tab(page, /Archived/).click()
    await expect.poll(() => shown(page)).toEqual(['Drinks'])
    await expect.poll(() => subs(page)).toEqual(['Tea'])
    await item(page, 'Tea').getByText('Archived', { exact: true }).waitFor()
    await expect.poll(() => inUrl(page, 'status')).toBe('archived')
    // There only as Tea's parent: nothing to edit from here.
    expect(await button(page, 'Edit details').count()).toBe(0)
  })

  it('searches on the client, keeping a matching subcategory beside its parent', async () => {
    const { page, api } = await open()
    await item(page, 'Coffee').waitFor()
    const loads = api.calls.length
    await showMain(page, 'Food')
    await page.getByPlaceholder('Search categories…').fill('juice')
    // Food doesn't match any more: the first category that does takes its place.
    await expect.poll(() => shown(page)).toEqual(['Drinks'])
    await expect.poll(() => subs(page)).toEqual(['Juice'])
    expect(api.calls.length).toBe(loads)
    await expect.poll(() => inUrl(page, 'search')).toBe('juice')
  })

  it('finds a main category by name without showing subcategories that don\'t match', async () => {
    const { page } = await open()
    await item(page, 'Coffee').waitFor()
    await page.getByPlaceholder('Search categories…').fill('drinks')
    await expect.poll(() => subs(page)).toEqual([])
    await page.getByText('No subcategories to show here.').waitFor()
    await button(page, 'Edit details').waitFor()
  })

  it('opens a category from its name, not from anywhere on the row', async () => {
    const { page } = await open()
    await item(page, 'Coffee').getByText('Inherits parent', { exact: true }).filter({ visible: true }).click()
    expect(await page.getByRole('dialog').count()).toBe(0)
    await item(page, 'Coffee').getByRole('button', { name: 'Coffee', exact: true }).click()
    await page.getByRole('dialog', { name: 'Edit category' }).waitFor()
  })

  it('offers Edit details, Add subcategory and Archive on a main category, Edit, Manage items and Archive on a subcategory; never Delete', async () => {
    const { page } = await open()
    await button(page, 'Edit details').waitFor()
    await page.getByRole('button', { name: 'Actions for Drinks' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Add subcategory', 'Add menu item (it has subcategories)', 'Archive'])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Actions for Coffee' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Edit', 'Add menu item', 'Manage items', 'Archive'])
    expect(await page.getByRole('menuitem', { name: 'Add menu item' }).getAttribute('href')).toBe('/c/nuk/admin/products/new?categoryId=cat-11')
    expect(await page.getByRole('menuitem', { name: 'Manage items' }).getAttribute('href')).toBe('/c/nuk/admin/products?categoryId=cat-11')
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
    await showMain(page, 'Food')
    await page.getByRole('button', { name: 'Add subcategory to Food' }).click()
    const form = page.getByRole('dialog', { name: 'New subcategory' })
    await expect.poll(() => form.getByRole('combobox', { name: 'Parent category', exact: true }).textContent()).toContain('Food')
    await form.getByLabel('Name').fill('Sandwiches')
    await form.getByLabel('Description').fill('Toasted to order')
    await form.getByRole('combobox', { name: 'Availability', exact: true }).click()
    await page.getByRole('option', { name: 'Breakfast' }).click()
    await page.keyboard.press('Escape')
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Category "Sandwiches" created').waitFor()
    expect(body).toEqual({ name: 'Sandwiches', description: 'Toasted to order', parentId: FOOD.id, availabilityRuleIds: ['rule-1'] })
  })

  it('keeps a parent top-level: its parent can\'t change', async () => {
    const { page } = await open()
    await button(page, 'Edit details').click()
    const form = page.getByRole('dialog', { name: 'Edit category' })
    await form.getByText('It has subcategories, so it stays a top-level category.').waitFor()
    expect(await form.getByRole('combobox', { name: 'Parent category', exact: true }).isDisabled()).toBe(true)
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
    await showMain(page, 'Food')
    await button(page, 'Edit details').click()
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
    allowBrowserProblems(/GET \/api\/c\/nuk\/admin\/menu\/categories\?status=all → 500/)
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
    await showMain(page, 'Food')
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('Its 1 active subcategory will be archived too.').waitFor()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, 'Category "Food" archived').waitFor()
    expect(bodies).toEqual([{ version: 2 }])
    await item(page, 'Food').waitFor({ state: 'detached' })
    // Gone from the list: the first category takes its place.
    await banner(page, 'Drinks').waitFor()

    await tab(page, /Archived/).click()
    await page.getByRole('button', { name: 'Actions for Food' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Restore', 'Delete permanently (it has subcategories)'])
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

describe('deleting permanently (D200)', () => {
  it('deletes an empty archived category after asking, from the version read, and the row goes', async () => {
    const bodies: unknown[] = []
    const rows = [TOAST, FOOD, { ...TEA, version: 7 }, JUICE, COFFEE, DRINKS]
    const { page } = await open({
      ...backend(rows),
      'GET /admin/menu/categories': () => rows,
      'DELETE /admin/menu/categories/{id}': ({ url: u, body }) => {
        bodies.push({ id: u.pathname.split('/').pop(), version: u.searchParams.get('version'), body })
        rows.splice(rows.findIndex(r => r.id === TEA.id), 1)
        return null
      },
    }, '/c/nuk/admin/categories?status=archived')
    await page.getByRole('button', { name: 'Actions for Tea' }).click()
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete "Tea" permanently?' })
    await dialog.getByText('It can\'t be restored.', { exact: false }).waitFor()
    await dialog.getByRole('button', { name: 'Delete permanently' }).click()
    await toast(page, 'Category "Tea" deleted').waitFor()
    await item(page, 'Tea').waitFor({ state: 'detached' })
    expect(bodies).toEqual([{ id: TEA.id, version: '7', body: null }])
  })

  it('says why an archived category can\'t go, and active ones have no delete', async () => {
    const OLD = main('cat-4', 'Old', 4, { status: 'archived', deleteBlocker: 'items' })
    const SOLD = main('cat-5', 'Sold', 5, { status: 'archived', deleteBlocker: 'ordered' })
    const { page } = await open(backend([OLD, SOLD, DRINKS, COFFEE]), '/c/nuk/admin/categories?status=all')
    for (const [name, label] of [['Old', 'Delete permanently (it has menu items)'], ['Sold', 'Delete permanently (items were ordered from it)']] as const) {
      await showMain(page, name)
      await page.getByRole('button', { name: `Actions for ${name}` }).click()
      const action = page.getByRole('menuitem', { name: label })
      await action.waitFor()
      expect(await action.getAttribute('data-disabled')).not.toBeNull()
      await page.keyboard.press('Escape')
    }
    await showMain(page, 'Drinks')
    await page.getByRole('button', { name: 'Actions for Coffee' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).waitFor()
    expect(await page.getByRole('menuitem', { name: /Delete/ }).count()).toBe(0)
  })

  it('shows the server\'s refusal and keeps the row', async () => {
    const { page } = await open(backend(undefined, {
      'DELETE /admin/menu/categories/{id}': () => {
        throw failures.conflict('CATEGORY_HAS_HISTORY', 'Menu items were ordered from this category, so it stays archived to keep your reports.')
      },
    }), '/c/nuk/admin/categories?status=archived')
    await page.getByRole('button', { name: 'Actions for Tea' }).click()
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click()
    await toast(page, 'Could not delete "Tea"').waitFor()
    await page.getByText('so it stays archived to keep your reports', { exact: false }).first().waitFor()
    await item(page, 'Tea').waitFor()
  })
})

describe('category contents and follow-ups', () => {
  const withSnacks = (extra: Record<string, MockHandler> = {}) => backend([TOAST, FOOD, TEA, JUICE, COFFEE, DRINKS, SNACKS], extra)
  const visibleText = (page: Page, name: string, text: string) => item(page, name).getByText(text, { exact: true }).filter({ visible: true })

  it('says what each category contains: subcategories, items, or nothing', async () => {
    const { page } = await open(withSnacks())
    await visibleText(page, 'Drinks', '2 subcategories').waitFor()
    await visibleText(page, 'Food', '1 subcategory · 4 items').waitFor()
    await visibleText(page, 'Snacks', '3 items').waitFor()
    await visibleText(page, 'Coffee', 'Empty').waitFor()
    await showMain(page, 'Food')
    await visibleText(page, 'Toast', '4 items').waitFor()
  })

  it('a category holding menu items can\'t get subcategories, and isn\'t offered as a parent', async () => {
    const { page } = await open(withSnacks())
    await showMain(page, 'Snacks')
    await page.getByRole('link', { name: 'Manage items in Snacks' }).waitFor()
    expect(await page.getByRole('link', { name: 'Manage items in Snacks' }).getAttribute('href')).toBe('/c/nuk/admin/products?categoryId=cat-3')
    expect(await page.getByRole('link', { name: 'Add menu item to Snacks' }).getAttribute('href')).toBe('/c/nuk/admin/products/new?categoryId=cat-3')
    await page.getByRole('button', { name: 'Add subcategory to Snacks' }).waitFor()
    await page.getByRole('button', { name: 'Actions for Snacks' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Add subcategory', 'Add menu item', 'Manage items', 'Archive'])
  })

  it('offers either subcategories or items on an empty main category', async () => {
    const { page } = await open(backend([main('cat-5', 'Bakery', 1)]))
    await button(page, 'Add subcategory to Bakery').waitFor()
    await page.getByRole('link', { name: 'Add menu item to Bakery' }).waitFor()
    await page.getByRole('link', { name: 'Manage items in Bakery' }).waitFor()
    await page.getByRole('button', { name: 'Actions for Bakery' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Add subcategory', 'Add menu item', 'Manage items', 'Archive'])
  })

  it('offers no menu items on a main category whose only subcategories are archived: the server would refuse', async () => {
    const { page } = await open(backend([main('cat-5', 'Bakery', 1), sub('cat-51', 'Old', main('cat-5', 'Bakery', 1), 1, { status: 'archived' })]))
    await button(page, 'Add subcategory to Bakery').waitFor()
    await page.getByText('No subcategories to show here.').waitFor()
    expect(await page.getByRole('link', { name: 'Add menu item to Bakery' }).count()).toBe(0)
    await page.getByRole('button', { name: 'Actions for Bakery' }).click()
    const add = page.getByRole('menuitem', { name: 'Add menu item (it has archived subcategories)' })
    await add.waitFor()
    expect(await add.getAttribute('data-disabled')).not.toBeNull()
  })

  it('a new subcategory takes its parent\'s items, after saying so, from the count on screen', async () => {
    let body: Record<string, unknown> | undefined
    const { page } = await open(backend([SNACKS], {
      'POST /admin/menu/categories': (request) => {
        body = request.body as Record<string, unknown>
        return menuCategoryOf('cat-30', 'Crisps', { parentId: SNACKS.id, itemCount: 3 })
      },
    }))
    await button(page, 'Add subcategory to Snacks').click()
    const form = page.getByRole('dialog', { name: 'New subcategory' })
    await form.getByText('3 menu items will move into this subcategory').waitFor()
    await form.getByLabel('Name').fill('Crisps')
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Category "Crisps" created with 3 menu items').waitFor()
    expect(body).toMatchObject({ parentId: SNACKS.id, moveItems: 3 })
  })

  it('choosing a parent holding items says the same, and editing never offers one', async () => {
    const { page } = await open(backend([DRINKS, COFFEE, SNACKS]))
    await page.getByRole('button', { name: 'New category' }).first().click()
    const form = page.getByRole('dialog', { name: 'New category' })
    expect(await form.getByText('will move into this subcategory', { exact: false }).count()).toBe(0)
    await form.getByRole('combobox', { name: 'Parent category', exact: true }).click()
    await page.getByRole('option', { name: 'Snacks' }).click()
    await form.getByText('3 menu items will move into this subcategory').waitFor()
    await form.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Discard' }).click()

    await showMain(page, 'Drinks')
    await item(page, 'Coffee').getByRole('button', { name: 'Coffee', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit category' })
    await edit.getByRole('combobox', { name: 'Parent category', exact: true }).click()
    await page.getByRole('option', { name: 'Drinks' }).waitFor()
    expect(await page.getByRole('option', { name: /Snacks/ }).count()).toBe(0)
  })

  it('when the items changed meanwhile, the form says so, shows the new count and sends it next', async () => {
    const bodies: Record<string, unknown>[] = []
    let snacks = SNACKS
    const { page } = await open(backend(undefined, {
      'GET /admin/menu/categories': () => [snacks],
      'POST /admin/menu/categories': (request) => {
        bodies.push(request.body as Record<string, unknown>)
        if (bodies.length === 1) throw failures.conflict('VERSION_CONFLICT', 'The menu items in that category changed. Check how many will move, then try again.')
        return menuCategoryOf('cat-30', 'Crisps', { parentId: SNACKS.id, itemCount: 4 })
      },
    }))
    await button(page, 'Add subcategory to Snacks').click()
    const form = page.getByRole('dialog', { name: 'New subcategory' })
    await form.getByLabel('Name').fill('Crisps')
    snacks = { ...SNACKS, itemCount: 4 }
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('The menu items in that category changed.', { exact: false }).waitFor()
    await form.getByText('4 menu items will move into this subcategory').waitFor()
    // Not a version to reload: there's no Reload here.
    expect(await form.getByRole('button', { name: 'Reload' }).count()).toBe(0)
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Category "Crisps" created with 4 menu items').waitFor()
    expect(bodies.map(b => b.moveItems)).toEqual([3, 4])
  })

  it('never hides subcategories, even on a main category that also holds items', async () => {
    const { page } = await open(backend([{ ...DRINKS, itemCount: 2 }, COFFEE]))
    await expect.poll(() => subs(page)).toEqual(['Coffee'])
  })

  it('starts a new menu item in the category it was added from, with nothing unsaved', async () => {
    const { page } = await open(backend(), '/c/nuk/admin/products/new?categoryId=cat-21')
    await expect.poll(() => page.getByRole('combobox', { name: 'Category', exact: true }).textContent()).toContain('Toast')
    expect(await beforeUnloadPrevented(page)).toBe(false)
  })

  it('shows the banner photo of the color mode', async () => {
    const photo = (page: Page) => banner(page, 'Drinks').locator('img').filter({ visible: true })
    const light = await open()
    await expect.poll(() => photo(light.page).count()).toBe(1)
    expect(await photo(light.page).getAttribute('src')).not.toContain('dark')

    const page = await createPage()
    await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
    await mockApi(page, backend())
    await page.goto(url('/c/nuk/admin/categories'), { waitUntil: 'hydration' })
    await expect.poll(() => photo(page).count()).toBe(1)
    expect(await photo(page).getAttribute('src')).toContain('dark')
  })

  it('warns that archiving hides a category\'s menu items', async () => {
    const { page } = await open(withSnacks())
    await showMain(page, 'Snacks')
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
    await item(page, 'Coffee').waitFor()
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
    await item(page, 'Coffee').waitFor()
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

  it('keeps a selection across main categories, and each card says how many of its subcategories are in it', async () => {
    const { page } = await open()
    await button(page, 'Select').click()
    await page.getByRole('checkbox', { name: 'Select Coffee' }).click()
    await showMain(page, 'Food')
    await page.getByRole('checkbox', { name: 'Select Toast' }).click()
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByText('2 selected').waitFor()
    await item(page, 'Drinks').getByText('2 subcategories · 1 selected', { exact: true }).waitFor()
    // The name still shows the category; only the checkbox selects it.
    expect(await page.getByRole('checkbox', { name: 'Select Food' }).getAttribute('aria-checked')).toBe('false')
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
    await item(page, 'Coffee').waitFor()
    expect(await page.getByRole('button', { name: /^Reorder / }).count()).toBe(0)
    await button(page, 'Reorder').click()
    // The main categories, and the subcategories on show.
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(4)
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
    await expect.poll(() => shown(page)).toEqual(['Food', 'Drinks'])
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
    await expect.poll(() => subs(page)).toEqual(['Juice', 'Coffee'])
    await item(page, 'Juice').getByText('01', { exact: true }).waitFor()
    // The last subcategory can't leave its parent, and the first top-level can't go up.
    expect(await button(page, 'Move Coffee down').isDisabled()).toBe(true)
    expect(await button(page, 'Move Drinks up').isDisabled()).toBe(true)
    await button(page, 'Save order').click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies).toEqual([{ parentId: 'cat-1', items: [{ id: 'cat-13', version: 1 }, { id: 'cat-11', version: 5 }] }])
  })

  it('moves between main categories while an order is unsaved without asking, and saves both', async () => {
    const bodies: { parentId: string | null }[] = []
    const { page } = await open(saving(b => bodies.push(b as { parentId: string | null })))
    await button(page, 'Reorder').click()
    await button(page, 'Move Juice up').click()
    await showMain(page, 'Food')
    await item(page, 'Toast').waitFor()
    expect(await page.getByText('Discard unsaved changes?').count()).toBe(0)
    // The URL waits: every route change asks about unsaved changes.
    expect(inUrl(page, 'category')).toBeNull()
    await showMain(page, 'Drinks')
    await expect.poll(() => subs(page)).toEqual(['Juice', 'Coffee'])
    await showMain(page, 'Food')
    await button(page, 'Move Food up').click()
    await button(page, 'Save order').click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies.map(b => b.parentId)).toEqual([null, 'cat-1'])
    await expect.poll(() => inUrl(page, 'category')).toBe('cat-2')
    expect(await page.getByText('Discard unsaved changes?').count()).toBe(0)
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
    await expect.poll(() => shown(page)).toEqual(['Drinks', 'Food'])
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
    await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).count()).toBe(4)
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
    await item(page, 'Food').waitFor()
    return { page, api }
  }

  it('fits the screen, with New category as its icon alone, still named', async () => {
    const { page } = await openPhone()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const add = page.getByRole('button', { name: 'New category' }).first()
    expect((await add.innerText()).trim()).toBe('')
    await add.click()
    await page.getByRole('dialog', { name: 'New category' }).waitFor()
  })

  it('shows the list first, pushes a category over it, and Back or the back button returns', async () => {
    const { page } = await openPhone()
    await item(page, 'Coffee').waitFor({ state: 'hidden' })
    expect(await page.getByRole('heading', { name: 'Main categories' }).isVisible()).toBe(true)
    await showMain(page, 'Food')
    await item(page, 'Toast').waitFor()
    await page.getByRole('heading', { name: 'Main categories' }).waitFor({ state: 'hidden' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.goBack()
    await page.getByRole('heading', { name: 'Main categories' }).waitFor()
    await item(page, 'Toast').waitFor({ state: 'hidden' })
    await showMain(page, 'Food')
    await button(page, 'Back to main categories').click()
    await page.getByRole('heading', { name: 'Main categories' }).waitFor()
    expect(inUrl(page, 'category')).toBeNull()
  })

  it('changes category from pills where the list isn\'t beside it, and Back still returns to the list', async () => {
    const { page } = await openPhone()
    await showMain(page, 'Food')
    await item(page, 'Toast').waitFor()
    const pills = page.getByRole('navigation', { name: 'Main categories' })
    expect(await pills.getByRole('button', { name: 'Food', exact: true }).getAttribute('aria-current')).toBe('true')
    await pills.getByRole('button', { name: 'Drinks', exact: true }).click()
    await item(page, 'Coffee').waitFor()
    expect(inUrl(page, 'category')).toBe('cat-1')
    await page.goBack()
    await page.getByRole('heading', { name: 'Main categories' }).waitFor()
    expect(inUrl(page, 'category')).toBeNull()
  })

  it('selects one level at a time, starting from the main categories, the ticks carrying over', async () => {
    const { page } = await openPhone(backend([DRINKS, COFFEE, FOOD, TOAST, SNACKS]))
    await showMain(page, 'Food')
    await item(page, 'Toast').waitFor()
    await button(page, 'Select').click()
    // Back at the main categories, the level that can't be reached from a category.
    await page.getByRole('checkbox', { name: 'Select Drinks' }).click()
    await item(page, 'Coffee').waitFor({ state: 'hidden' })
    // A card with subcategories steps into them; only them on screen.
    await showMain(page, 'Food')
    await page.getByRole('checkbox', { name: 'Select Toast' }).click()
    await page.getByRole('heading', { name: 'Main categories' }).waitFor({ state: 'hidden' })
    expect(await banner(page, 'Food').isVisible()).toBe(false)
    expect(await page.getByRole('navigation', { name: 'Main categories' }).count()).toBe(0)
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByText('2 selected').waitFor()
    await button(page, 'Main categories').click()
    await page.getByRole('heading', { name: 'Main categories' }).waitFor()
    await item(page, 'Food').getByText('1 selected', { exact: false }).waitFor()
    // One without subcategories has nowhere to go: its name ticks it.
    await showMain(page, 'Snacks')
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByText('3 selected').waitFor()
    expect(await page.getByRole('checkbox', { name: 'Select Snacks' }).getAttribute('aria-checked')).toBe('true')
    expect(await page.getByRole('heading', { name: 'Main categories' }).isVisible()).toBe(true)
  })

  it('reorders one level at a time, and one Save covers both', async () => {
    const bodies: { parentId: string | null }[] = []
    const { page } = await openPhone(backend(undefined, {
      'PUT /admin/menu/categories/order': ({ body }) => {
        bodies.push(body as { parentId: string | null })
        return []
      },
    }))
    await showMain(page, 'Food')
    await item(page, 'Toast').waitFor()
    await button(page, 'Reorder').click()
    await button(page, 'Move Food up').click()
    await expect.poll(() => shown(page)).toEqual(['Food', 'Drinks'])
    await page.getByText('The new order isn\'t saved yet.').waitFor()
    await showMain(page, 'Drinks')
    await button(page, 'Move Juice up').click()
    await expect.poll(() => subs(page)).toEqual(['Juice', 'Coffee'])
    expect(await page.getByText('Discard unsaved changes?').count()).toBe(0)
    await button(page, 'Main categories').click()
    await expect.poll(() => shown(page)).toEqual(['Food', 'Drinks'])
    await button(page, 'Save order').click()
    await toast(page, 'Category order saved').waitFor()
    expect(bodies.map(b => b.parentId)).toEqual([null, 'cat-1'])
  })

  it('offers the drag handle too, which moves a category', async () => {
    const { page } = await openPhone()
    await button(page, 'Reorder').click()
    await page.getByRole('button', { name: /^Reorder Food/ }).dragTo(page.getByRole('button', { name: /^Reorder Drinks/ }))
    await expect.poll(() => shown(page)).toEqual(['Food', 'Drinks'])
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
  async function openAt(width: number, path = '/c/nuk/admin/categories?category=cat-1') {
    const page = await createPage()
    await page.setViewportSize({ width, height: 844 })
    await mockApi(page, backend())
    await page.goto(url(path), { waitUntil: 'hydration' })
    await item(page, 'Coffee').waitFor()
    return page
  }

  it('opens a category from its name, with the actions beside the name (not inside it)', async () => {
    const page = await openAt(390)
    const target = item(page, 'Coffee').getByRole('button', { name: 'Coffee', exact: true })
    const actions = item(page, 'Coffee').getByRole('button', { name: 'Actions for Coffee' })
    expect(await actions.evaluate(el => el.parentElement?.closest('button, a') === null)).toBe(true)
    const area = await stretchedTarget(target)
    expect(area.height).toBeGreaterThanOrEqual(44)
    expect(area.reaches).toBe(true)
    await target.click()
    await page.getByRole('dialog', { name: 'Edit category' }).waitFor()
  })

  it('lays a subcategory out by its list\'s width: stacked narrow, in line when there is room', async () => {
    const narrow = await openAt(390)
    await item(narrow, 'Coffee').getByText('Empty · Inherits parent').waitFor()
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const wide = await openAt(1440)
    await item(wide, 'Coffee').getByText('Empty', { exact: true }).filter({ visible: true }).waitFor()
    expect(await item(wide, 'Coffee').getByText('Empty · Inherits parent').isVisible()).toBe(false)
    expect(await wide.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  it('scrolls the page as one from 1024px, with the category on show pinned beside a long list', async () => {
    const many = Array.from({ length: 20 }, (_, i) => main(`many-${i}`, `Many ${i}`, i + 3))
    const page = await createPage()
    await page.setViewportSize({ width: 1280, height: 600 })
    await mockApi(page, backend([DRINKS, COFFEE, FOOD, TOAST, ...many]))
    await page.goto(url('/c/nuk/admin/categories?category=many-19'), { waitUntil: 'hydration' })
    await banner(page, 'Many 19').waitFor()
    // No scrolling box in the content: only the page's body scrolls.
    const sizes = await page.locator('[role="list"][aria-label="Categories"]').evaluate((el) => {
      const body = el.closest('[data-slot="body"]')!
      return { list: el.scrollHeight > el.clientHeight, page: body.scrollHeight > body.clientHeight }
    })
    expect(sizes).toEqual({ list: false, page: true })
    // A link to a category far down the list opens with it in view, the banner beside it.
    const inView = async (name: string) => {
      const box = (await name.startsWith('card:') ? item(page, name.slice(5)) : banner(page, name)).boundingBox()
      return box.then(b => b!.y >= 0 && b!.y < 600)
    }
    await expect.poll(() => inView('card:Many 19')).toBe(true)
    expect(await inView('Many 19')).toBe(true)
    // A card clicked down there changes what's on screen.
    await showMain(page, 'Many 18')
    await banner(page, 'Many 18').waitFor()
    expect(await inView('Many 18')).toBe(true)
  })

  it('has the panels side by side from 1024px, one at a time below it', async () => {
    const heading = (page: Page) => page.getByRole('heading', { name: 'Main categories' })
    const below = await openAt(1023)
    expect(await heading(below).isVisible()).toBe(false)
    const from = await openAt(1024)
    await heading(from).waitFor()
    await banner(from, 'Drinks').waitFor()
    expect(await from.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  it('shows the status next to the name in the All view', async () => {
    const page = await openAt(1440, '/c/nuk/admin/categories?status=all')
    await item(page, 'Tea').getByText('Archived', { exact: true }).waitFor()
    const name = (await item(page, 'Tea').getByText('Tea', { exact: true }).boundingBox())!
    const badge = (await item(page, 'Tea').getByText('Archived', { exact: true }).boundingBox())!
    expect(Math.abs(badge.y + badge.height / 2 - (name.y + name.height / 2))).toBeLessThan(8)
  })
})
