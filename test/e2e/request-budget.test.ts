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
    await step('Published tab', () => page.getByRole('group', { name: 'Status' }).getByRole('tab', { name: /Published/ }).click())
    console.info('[request-budget] menu items', JSON.stringify(steps, null, 2))

    // The first opening reads the item and the three libraries, each once (the form and its add-on
    // section share `modifier-groups:list`; the second joins the first's load, D173). The libraries
    // are kept (D173), so the next opening reads only its item. Back on the list: the page and its
    // counts (status tabs and the "No photo" hint in one read).
    expect(steps).toEqual({
      'edit Latte': {
        '/admin/menu/items/item-1': 1,
        '/admin/menu/modifier-groups': 1,
        '/admin/menu/option-sets': 1,
        '/admin/menu/availability-rules': 1,
      },
      'close': {},
      'edit Matcha': { '/admin/menu/items/item-2': 1 },
      'close again': {},
      'to Categories': {},
      'back to Menu items': { '/admin/menu/items': 1, '/admin/menu/items/counts': 1 },
      // The counts don't depend on the tab: only the page is read.
      'Published tab': { '/admin/menu/items': 1 },
    })
  }, 60_000)

  it('a tour of the admin pages through the sidebar', async () => {
    const page = await createPage()
    const api = await mockApi(page, HANDLERS)
    await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
    await settled(api.calls)
    const firstLoad = readsSince(api.calls, 0)

    const reads: Record<string, Record<string, number>> = {}
    for (const name of ['Menu items', 'Categories', 'Options', 'Add-ons', 'Availability', 'Branch', 'Staff', 'Payments', 'Categories', 'Menu items', 'Overview']) {
      const from = api.calls.length
      await clickSidebar(page, name)
      await settled(api.calls)
      reads[name in reads ? `${name} (again)` : name] = readsSince(api.calls, from)
    }
    console.info('[request-budget] tour', JSON.stringify({ firstLoad, ...reads }, null, 2))

    // The dashboard's setup checks (D155) read each feature's endpoint themselves, outside any query.
    const dashboard = {
      '/admin/branches/options': 1,
      '/admin/menu/items/counts': 2,
      '/admin/exchange-rates': 1,
      '/admin/khqr': 1,
      '/admin/telegram': 1,
      '/admin/staff': 1,
      '/admin/cafe': 1,
      '/admin/reports/branches': 1,
    }
    // The shell: Better Auth's client reads its session twice (its module, not ours).
    expect(firstLoad).toEqual({
      '/auth/get-session': 2,
      '/admin/me': 1,
      '/cafes/nuk': 1,
      '/me/cafes': 1,
      '/admin/assistant': 1,
      ...dashboard,
    })
    // Reference data (categories, the libraries, branch options) is read once and kept (D173);
    // lists and settings are read on every visit.
    expect(reads).toEqual({
      'Menu items': { '/admin/menu/items': 1, '/admin/menu/items/counts': 1, '/admin/menu/categories': 1 },
      'Categories': { '/admin/menu/availability-rules': 1 },
      'Options': { '/admin/menu/option-sets': 1 },
      'Add-ons': { '/admin/menu/modifier-groups': 1 },
      'Availability': {},
      'Branch': { '/admin/branches/options': 1 },
      'Staff': { '/admin/staff': 1 },
      'Payments': { '/admin/exchange-rates': 1, '/admin/khqr': 1 },
      'Categories (again)': {},
      'Menu items (again)': { '/admin/menu/items': 1, '/admin/menu/items/counts': 1 },
      'Overview': dashboard,
    })
  }, 90_000)
})
