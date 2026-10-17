import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { menuItemOf, menuItemSummaryOf, mockApi, paginatedHandler, setupE2e } from './support/mock-api'

// How many API reads the admin makes while someone works in it (the request-reduction plan in
// docs/progress.md). The expected numbers are today's: a change that lowers them updates them here,
// and a change that raises them has to explain why.
await setupE2e()

const LATTE = menuItemOf('item-1', 'Latte')
const MATCHA = menuItemOf('item-2', 'Matcha')
const ROWS = [menuItemSummaryOf('item-1', 'Latte'), menuItemSummaryOf('item-2', 'Matcha')]

const HANDLERS: Record<string, MockHandler> = {
  'GET /admin/menu/items': paginatedHandler(ROWS),
  'GET /admin/menu/items/{id}': ({ url }) => [LATTE, MATCHA].find(item => item.id === url.pathname.split('/').pop()),
}

/** GET requests since `from`, counted by endpoint ('/admin/menu/items' → 4). The session reads are left out. */
function readsSince(calls: string[], from: number) {
  const counts: Record<string, number> = {}
  for (const call of calls.slice(from)) {
    if (!call.startsWith('GET ')) continue
    const path = call.slice(4)
    counts[path] = (counts[path] ?? 0) + 1
  }
  return counts
}

/** Waits until no API request has started for `quietMs`, so a step's background reads are all counted. */
async function settled(calls: string[], quietMs = 750) {
  let seen = -1
  while (seen !== calls.length) {
    seen = calls.length
    await new Promise(resolve => setTimeout(resolve, quietMs))
  }
}

async function openEdit(page: Page, name: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit menu item' })
  await form.getByLabel('Name', { exact: true }).waitFor()
  return form
}

async function closeEdit(page: Page) {
  const form = page.getByRole('dialog', { name: 'Edit menu item' })
  await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Cancel' }).click()
  await form.waitFor({ state: 'hidden' })
}

async function clickSidebar(page: Page, name: string) {
  const link = page.getByRole('navigation').getByRole('link', { name, exact: true }).first()
  const path = await link.getAttribute('href')
  await link.click()
  await page.waitForURL(address => address.pathname === path)
}

describe('request budget: admin', () => {
  it('editing menu items one after another', async () => {
    const page = await createPage()
    const api = await mockApi(page, HANDLERS)
    await page.goto(url('/c/nuk/admin/products'), { waitUntil: 'hydration' })
    await page.getByRole('article', { name: 'Latte', exact: true }).waitFor()
    await settled(api.calls)

    const steps: Record<string, Record<string, number>> = {}
    async function step(name: string, run: () => Promise<unknown>) {
      const from = api.calls.length
      await run()
      await settled(api.calls)
      steps[name] = readsSince(api.calls, from)
    }

    await step('edit Latte', () => openEdit(page, 'Latte'))
    await step('close', () => closeEdit(page))
    await step('edit Matcha', () => openEdit(page, 'Matcha'))
    await step('close again', () => closeEdit(page))
    await step('to Categories', () => clickSidebar(page, 'Categories'))
    await step('back to Menu items', async () => {
      await clickSidebar(page, 'Menu items')
      await page.getByRole('article', { name: 'Latte', exact: true }).waitFor()
    })
    console.info('[request-budget] menu items', JSON.stringify(steps, null, 2))

    // Every opening reads the item and the three libraries again, though none of them changed, and
    // the add-on library twice: the form and its add-on section both use `modifier-groups:list`, and
    // Nuxt's first fetch for the second one cancels the first one's request and starts another.
    // Back on the list, the page and its three status counts and photo count load again.
    const editor = (id: string) => ({
      [`/admin/menu/items/${id}`]: 1,
      '/admin/menu/modifier-groups': 2,
      '/admin/menu/option-sets': 1,
      '/admin/menu/availability-rules': 1,
    })
    expect(steps).toEqual({
      'edit Latte': editor('item-1'),
      'close': {},
      'edit Matcha': editor('item-2'),
      'close again': {},
      'to Categories': { '/admin/menu/availability-rules': 1 },
      'back to Menu items': { '/admin/menu/items': 5 },
    })
  }, 60_000)

  it('a tour of the admin pages through the sidebar', async () => {
    const page = await createPage()
    const api = await mockApi(page, HANDLERS)
    await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
    await settled(api.calls)
    const firstLoad = readsSince(api.calls, 0)

    const reads: Record<string, Record<string, number>> = {}
    for (const name of ['Menu items', 'Categories', 'Options', 'Add-ons', 'Availability', 'Branch', 'Staff', 'Payments', 'Categories', 'Menu items', 'Dashboard']) {
      const from = api.calls.length
      await clickSidebar(page, name)
      await settled(api.calls)
      reads[name in reads ? `${name} (again)` : name] = readsSince(api.calls, from)
    }
    console.info('[request-budget] tour', JSON.stringify({ firstLoad, ...reads }, null, 2))

    // The dashboard's setup checks (D155) read each feature's endpoint themselves.
    const dashboard = {
      '/admin/branches/options': 1,
      '/admin/menu/items': 3,
      '/admin/exchange-rates': 1,
      '/admin/khqr': 1,
      '/admin/telegram': 1,
      '/admin/staff': 1,
      '/admin/cafe': 1,
      '/admin/reports/branches': 1,
    }
    // The shell: Better Auth's client reads its session twice; the layout and the assistant's panel
    // both use `assistant:status`, and the second one's first fetch restarts the first one's.
    expect(firstLoad).toEqual({
      '/auth/get-session': 2,
      '/admin/me': 1,
      '/cafes/nuk': 1,
      '/me/cafes': 1,
      '/admin/assistant': 2,
      ...dashboard,
    })
    // Every visit reads its page's data again, the libraries and branch options included.
    expect(reads).toEqual({
      'Menu items': { '/admin/menu/items': 5, '/admin/menu/categories': 1 },
      'Categories': { '/admin/menu/availability-rules': 1 },
      'Options': { '/admin/menu/option-sets': 1 },
      'Add-ons': { '/admin/menu/modifier-groups': 1 },
      'Availability': { '/admin/menu/availability-rules': 1 },
      'Branch': { '/admin/branches/options': 1 },
      // One branch-options query for every feature: the Branch page's is still loaded as Staff opens.
      'Staff': { '/admin/staff': 1 },
      'Payments': { '/admin/exchange-rates': 1, '/admin/khqr': 1 },
      'Categories (again)': { '/admin/menu/categories': 1, '/admin/menu/availability-rules': 1 },
      'Menu items (again)': { '/admin/menu/items': 5 },
      'Dashboard': dashboard,
    })
  }, 90_000)
})
