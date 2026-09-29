import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { SampleDataState, SampleMenuStage } from '../../shared/contracts/sample-data'
import type { MockHandler } from './support/mock-api'
import { failures, gotoViaSidebar, MockFailure, mockApi, setupE2e } from './support/mock-api'

await setupE2e()

// The Sample data page (D94): load a sample menu, hours and tables, and reset, a step at a time.

const EMPTY = { categories: 0, optionSets: 0, modifierGroups: 0, availabilityRules: 0, items: { draft: 0, active: 0, archived: 0 }, photos: 0 }
const LOADED = { categories: 8, optionSets: 3, modifierGroups: 4, availabilityRules: 2, items: { draft: 3, active: 35, archived: 2 }, photos: 0 }
const BRANCH = { id: 'branch-1', name: 'Riverside', hoursSet: false, tables: 0 }

function stages(items: number, total = 40): SampleMenuStage[] {
  return [
    { key: 'categories', label: 'Categories', done: 8, total: 8 },
    { key: 'optionSets', label: 'Option sets', done: 3, total: 3 },
    { key: 'modifierGroups', label: 'Add-on groups', done: 4, total: 4 },
    { key: 'availabilityRules', label: 'Availability rules', done: 2, total: 2 },
    { key: 'items', label: 'Menu items', done: items, total },
  ]
}

function stateOf(overrides: Partial<SampleDataState['menu']> = {}, branches = [BRANCH]): SampleDataState {
  return { environment: 'Test', menu: { counts: EMPTY, run: null, ...overrides }, branches }
}

/** A menu load that takes `steps` calls, the server's steps: `fail` answers that call with an error. */
function menuBackend(options: { steps?: number, fail?: number, start?: SampleDataState } = {}) {
  const steps = options.steps ?? 4
  let state = options.start ?? stateOf()
  let calls = 0
  const bodies: unknown[] = []
  const handlers: Record<string, MockHandler> = {
    'GET /admin/sample-data': () => state,
    'POST /admin/sample-data/menu': ({ body }) => {
      calls++
      bodies.push(body)
      if (calls === options.fail) throw new MockFailure(500, 'INTERNAL', 'The server didn\'t answer.')
      const done = Math.min(40, (state.menu.run?.stages.at(-1)?.done ?? 0) + Math.ceil(40 / steps))
      const finished = done >= 40
      state = stateOf({ counts: finished ? LOADED : { ...LOADED, items: { draft: 0, active: done, archived: 0 } }, run: { size: 'standard', finished, stages: stages(done) } })
      return state
    },
  }
  return { handlers, bodies, calls: () => calls }
}

async function open(handlers: Record<string, MockHandler>, width = 1440) {
  const page = await createPage()
  await page.setViewportSize({ width, height: 900 })
  const api = await mockApi(page, handlers)
  await page.goto(url('/admin/sample-data'), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Sample menu' }).waitFor()
  return { page, api }
}

const menuCard = (page: Page) => page.getByRole('region', { name: 'Sample menu' })
const branchCard = (page: Page) => page.getByRole('region', { name: 'Branch hours and tables' })
const dangerZone = (page: Page) => page.getByRole('region', { name: 'Reset menu data' })

describe('sample data', () => {
  it('is in the sidebar with a Test badge, and names the environment', async () => {
    const page = await createPage()
    await mockApi(page, menuBackend().handlers)
    await gotoViaSidebar(page, [/Sample data/])
    await page.getByText('You\'re on Test').waitFor()
    expect(await page.getByRole('link', { name: /Sample data/ }).textContent()).toContain('Test')
  })

  it('loads the chosen size step after step until the server says it\'s done', async () => {
    const backend = menuBackend({ steps: 4 })
    const { page } = await open(backend.handlers)
    await menuCard(page).getByText('Current state: menu is empty.').waitFor()
    await menuCard(page).getByRole('radio', { name: /Large/ }).click()
    await menuCard(page).getByRole('radio', { name: /Standard/ }).click()
    await menuCard(page).getByRole('button', { name: 'Load sample menu' }).click()
    await menuCard(page).getByText('Sample menu loaded').waitFor()
    expect(backend.calls()).toBe(4)
    expect(backend.bodies).toEqual(Array.from({ length: 4 }, () => ({ size: 'standard' })))
    await menuCard(page).getByText('8 categories, 3 option sets, 4 add-on groups, 2 rules, 40 items (35 published, 3 drafts, 2 archived)').waitFor()
    await menuCard(page).getByText('The menu already has data. Reset it to load again.').waitFor()
    expect(await menuCard(page).getByRole('button', { name: /Load/ }).count()).toBe(0)
  })

  it('stops on a failed step, says why, and "Try again" continues where it stopped', async () => {
    const backend = menuBackend({ steps: 4, fail: 3 })
    const { page } = await open(backend.handlers)
    await menuCard(page).getByRole('button', { name: 'Load sample menu' }).click()
    await menuCard(page).getByText('Loading stopped').waitFor()
    await menuCard(page).getByText('Sample menu partly loaded (20 of 40 items)').waitFor()
    await menuCard(page).getByRole('button', { name: 'Try again' }).click()
    await menuCard(page).getByText('Sample menu loaded').waitFor()
    // 2 steps, the failed one, then the 2 that were left.
    expect(backend.calls()).toBe(5)
  })

  it('offers "Continue loading" for a load that stopped earlier, at its own size', async () => {
    const start = stateOf({ counts: { ...LOADED, items: { draft: 0, active: 23, archived: 0 } }, run: { size: 'standard', finished: false, stages: stages(23) } })
    const backend = menuBackend({ start })
    const { page } = await open(backend.handlers)
    await menuCard(page).getByText('Sample menu partly loaded (23 of 40 items)').waitFor()
    expect(await menuCard(page).getByRole('radio').count()).toBe(0)
    await menuCard(page).getByRole('button', { name: 'Continue loading' }).click()
    await menuCard(page).getByText('Sample menu loaded').waitFor()
    expect(backend.bodies[0]).toEqual({ size: 'standard' })
  })

  it('asks the owner of a menu with other data to reset first', async () => {
    const { page } = await open({ 'GET /admin/sample-data': () => stateOf({ counts: { ...EMPTY, categories: 2, items: { draft: 1, active: 4, archived: 0 } } }) })
    await menuCard(page).getByText('The menu already has data (5 items). Reset it to load the sample menu.').waitFor()
    expect(await menuCard(page).getByRole('button', { name: /Load/ }).count()).toBe(0)
  })

  it('loads hours and then tables a few at a time; replacing hours asks first', async () => {
    let state = stateOf({}, [{ ...BRANCH, hoursSet: true, tables: 1 }])
    const bodies: unknown[] = []
    const { page } = await open({
      'GET /admin/sample-data': () => state,
      'POST /admin/sample-data/branch': ({ body }) => {
        bodies.push(body)
        const remainingTables = Math.max(0, 11 - 4 * bodies.length)
        state = stateOf({}, [{ ...BRANCH, hoursSet: true, tables: 12 - remainingTables }])
        return { state, remainingTables }
      },
    })
    await branchCard(page).getByText('Riverside: Hours set · 1 table').waitFor()
    await branchCard(page).getByRole('button', { name: 'Load again' }).click()
    await page.getByRole('dialog', { name: 'Replace the opening hours?' }).getByRole('button', { name: 'Replace hours' }).click()
    await branchCard(page).getByText('Riverside: Hours set · 12 tables').waitFor()
    expect(bodies).toEqual([
      { branchId: 'branch-1', tablesOnly: false },
      { branchId: 'branch-1', tablesOnly: true },
      { branchId: 'branch-1', tablesOnly: true },
    ])
  })

  it('resets after RESET is typed, photos a batch at a time, then closes', async () => {
    let state = stateOf({ counts: { ...LOADED, photos: 30 }, run: { size: 'standard', finished: true, stages: stages(40) } })
    let resets = 0
    const { page } = await open({
      'GET /admin/sample-data': () => state,
      'POST /admin/sample-data/reset': ({ body }) => {
        expect(body).toEqual({ confirm: 'RESET' })
        resets++
        state = stateOf({ counts: { ...EMPTY, photos: Math.max(0, 30 - 20 * resets) } })
        return state
      },
    })
    await dangerZone(page).getByRole('button', { name: 'Reset menu data…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reset menu data?' })
    await dialog.getByText('40 menu items').waitFor()
    await dialog.getByText('30 uploaded photos').waitFor()
    const confirm = dialog.getByRole('button', { name: 'Reset menu data', exact: true })
    expect(await confirm.isDisabled()).toBe(true)
    await dialog.getByLabel('Type RESET to confirm').fill('reset')
    expect(await confirm.isDisabled()).toBe(true)
    await dialog.getByLabel('Type RESET to confirm').fill('RESET')
    await confirm.click()
    await expect.poll(() => dialog.count()).toBe(0)
    expect(resets).toBe(2)
    await menuCard(page).getByText('Current state: menu is empty.').waitFor()
    await dangerZone(page).getByText('Nothing to reset').waitFor()
  })

  it('keeps one action at a time: the others wait while the menu loads', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const backend = menuBackend({ steps: 1 })
    const step = backend.handlers['POST /admin/sample-data/menu']!
    const { page } = await open({ ...backend.handlers, 'POST /admin/sample-data/menu': async (request) => {
      await held
      return step(request)
    } })
    await menuCard(page).getByRole('button', { name: 'Load sample menu' }).click()
    await menuCard(page).getByRole('button', { name: 'Loading…' }).waitFor()
    expect(await branchCard(page).getByRole('button', { name: 'Load hours and tables' }).isDisabled()).toBe(true)
    await dangerZone(page).getByText('Available after loading finishes').waitFor()
    release()
    await menuCard(page).getByText('Sample menu loaded').waitFor()
  })

  it('shows a load error on the page, with Retry', async () => {
    let fail = true
    const page = await createPage()
    await mockApi(page, { 'GET /admin/sample-data': () => {
      if (fail) throw failures.server()
      return stateOf()
    } })
    await page.goto(url('/admin/sample-data'), { waitUntil: 'hydration' })
    await page.getByText('Could not load the sample data state').waitFor()
    fail = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await page.getByRole('heading', { name: 'Sample menu' }).waitFor()
  })
})
