import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MenuItemSummary } from '../../shared/contracts/menu-items'
import type { Modifier, ModifierGroup } from '../../shared/contracts/menu-modifiers'
import type { MockHandler } from './support/mock-api'
import { failures, MockFailure, menuItemOf, menuItemSummaryOf, mockApi, pageOf, setupE2e, toast } from './support/mock-api'

await setupE2e()

const STAMP = '2026-09-28T00:00:00.000Z'
const addOn = (id: string, name: string, priceDeltaMinor: number, overrides: Partial<Modifier> = {}): Modifier =>
  ({ id, name, priceDeltaMinor, isDefault: false, sortOrder: 1, status: 'active', ...overrides })

function groupOf(id: string, name: string, modifiers: Modifier[], overrides: Partial<ModifierGroup> = {}): ModifierGroup {
  return { id, name, minSelect: 0, maxSelect: null, status: 'active', modifiers, itemCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

const MILK = groupOf('grp-1', 'Milk choices', [addOn('mod-1', 'Whole milk', 0, { isDefault: true }), addOn('mod-2', 'Oat milk', 50), addOn('mod-3', 'Almond milk', 75), addOn('mod-9', 'Soy milk', 50, { status: 'archived' })], { minSelect: 1, maxSelect: 1, itemCount: 18 })
const SYRUPS = groupOf('grp-2', 'Syrups', ['Vanilla', 'Caramel', 'Hazelnut', 'Mocha', 'Honey', 'Maple'].map((name, i) => addOn(`syr-${i}`, name, 50)), { maxSelect: 3, itemCount: 1 })
const OLD = groupOf('grp-3', 'Seasonal extras', [addOn('mod-5', 'Gingerbread crumb', 75)], { status: 'archived', version: 2 })

const LATTE = menuItemSummaryOf('item-1', 'Iced latte', { categoryName: 'Coffee', status: 'active' })
const USERS = [LATTE, ...['Cappuccino', 'Matcha latte', 'Mocha', 'Flat white'].map((name, i) => menuItemSummaryOf(`item-${i + 2}`, name, { status: 'active' }))]

/** Groups as the server last answered them (`answering` writes here), so refetches see changes. */
const latest = new Map<string, ModifierGroup>()
const current = (group: ModifierGroup) => latest.get(group.id) ?? group

/** The add-on library and group pages' server: groups by id, the items that offer a group. */
function backend(groups: ModifierGroup[] = [MILK, SYRUPS, OLD], extra: Record<string, MockHandler> = {}): Record<string, MockHandler> {
  latest.clear()
  return {
    'GET /admin/menu/modifier-groups': () => groups.map(current),
    'GET /admin/menu/modifier-groups/{id}': ({ url }) => {
      const group = groups.map(current).find(g => g.id === url.pathname.split('/').pop())
      if (!group) throw failures.notFound('This add-on group was not found.')
      return group
    },
    'GET /admin/menu/items': ({ url }) => pageOf(url.searchParams.get('modifierGroupId') === 'grp-1' ? USERS : [], 1, Number(url.searchParams.get('pageSize') ?? 20)),
    ...extra,
  }
}

async function open(handlers: Record<string, MockHandler> = backend(), path = '/add-ons', width?: number) {
  const page = await createPage()
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

/** A group's page, loaded. */
async function openGroup(handlers: Record<string, MockHandler> = backend(), id = 'grp-1', width?: number) {
  const opened = await open(handlers, `/add-ons/${id}`, width)
  await opened.page.getByRole('heading', { level: 2 }).first().waitFor()
  return opened
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))
const row = (page: Page, name: string) => page.getByRole('list', { name: 'Active add-ons' }).getByRole('listitem', { name, exact: true })
const rowsShown = (page: Page) => page.getByRole('list', { name: 'Active add-ons' }).getByRole('listitem').evaluateAll(items => items.map(i => i.getAttribute('aria-label')))
const orderShown = (page: Page) => page.getByRole('list', { name: 'Add-ons in order' }).getByRole('listitem').evaluateAll(items => items.map(i => i.getAttribute('aria-label')))
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))

/** A handler that records bodies and answers with the group moved to the next version. */
function answering(group: ModifierGroup, change: (group: ModifierGroup, body: Record<string, unknown>) => Partial<ModifierGroup> = () => ({})) {
  const bodies: Record<string, unknown>[] = []
  let current = group
  const handler = ({ body }: { body: unknown }) => {
    bodies.push(body as Record<string, unknown>)
    current = { ...current, ...change(current, body as Record<string, unknown>), version: current.version + 1 }
    latest.set(current.id, current)
    return current
  }
  return { bodies, handler }
}

describe('add-ons library', () => {
  it('shows each group\'s rule, add-on rows with prices, preselection and usage', async () => {
    const { page } = await open()
    const milk = card(page, 'Milk choices')
    await milk.getByText('Required', { exact: true }).waitFor()
    await milk.getByText('Choose exactly 1').waitFor()
    await milk.getByText('Offered by 18 menu items').waitFor()
    const rows = await milk.getByRole('list', { name: 'Add-ons in Milk choices' }).getByRole('listitem').allInnerTexts()
    expect(rows.map(r => r.replace(/\s+/g, ' ').trim())).toEqual(['Whole milk Preselected Free', 'Oat milk +$0.50', 'Almond milk +$0.75'])
    await card(page, 'Syrups').getByText('Optional', { exact: true }).waitFor()
    await card(page, 'Syrups').getByText('Up to 3').waitFor()
    await card(page, 'Syrups').getByText('Offered by 1 menu item').waitFor()
    // Active is the default view.
    expect(await card(page, 'Seasonal extras').count()).toBe(0)
    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Seasonal extras').getByText('Archived', { exact: true }).waitFor()
    await card(page, 'Seasonal extras').getByRole('link', { name: 'View Seasonal extras' }).waitFor()
    expect(await page.getByRole('checkbox').count()).toBe(0)
  })

  it('searches group names and add-on names, and says which add-ons matched', async () => {
    const { page } = await open()
    const search = page.getByPlaceholder('Search groups or add-ons…')
    await search.fill('oat')
    await card(page, 'Milk choices').getByText('Matches: Oat milk').waitFor()
    expect(await card(page, 'Syrups').count()).toBe(0)
    await expect.poll(() => page.getByRole('tab', { name: /All/ }).innerText()).toContain('1')
    await search.fill('syr')
    await card(page, 'Syrups').waitFor()
    expect(await card(page, 'Syrups').getByText(/Matches/).count()).toBe(0)
    await expect.poll(() => page.url()).toContain('search=syr')
    // Archived add-ons don't match.
    await search.fill('soy')
    await page.getByText('No add-on groups match your filters').waitFor()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await card(page, 'Milk choices').waitFor()
  })

  it('previews 4 add-ons on wide screens and 3 on phones, then "+N more"', async () => {
    const { page } = await open(backend([SYRUPS]))
    const shown = () => card(page, 'Syrups').getByRole('listitem').filter({ visible: true }).count()
    await expect.poll(shown).toBe(4)
    await card(page, 'Syrups').getByText('+2 more').waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(shown).toBe(3)
    await card(page, 'Syrups').getByText('+3 more').waitFor()
  })

  it('counts rows by the card\'s width, not the screen\'s (D88)', async () => {
    const { page } = await open(backend([SYRUPS]))
    const shown = () => card(page, 'Syrups').getByRole('listitem').filter({ visible: true }).count()
    // Two columns from lg: at 1024px a card is narrow, so it shows the phone count
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect.poll(shown).toBe(3)
    await card(page, 'Syrups').getByText('+3 more').waitFor()
    // One column below lg: at 768px the card is wide again
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect.poll(shown).toBe(4)
    await card(page, 'Syrups').getByText('+2 more').waitFor()
  })

  it('offers only Archive (or Restore) in the card menu, saying what archiving does, never Delete', async () => {
    const archive = answering(MILK, () => ({ status: 'archived' }))
    const restore = answering(OLD, () => ({ status: 'active' }))
    const { page } = await open(backend(undefined, {
      'POST /admin/menu/modifier-groups/{id}/archive': archive.handler,
      'POST /admin/menu/modifier-groups/{id}/restore': restore.handler,
    }))
    await page.getByRole('button', { name: 'Actions for Milk choices' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Archive'])
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('18 menu items offer this group and will keep offering it, but it can\'t be added to other items until restored.').waitFor()
    await page.getByRole('button', { name: 'Archive group' }).click()
    await toast(page, 'Add-on group "Milk choices" archived').waitFor()
    expect(archive.bodies).toEqual([{ version: 1 }])

    await page.getByRole('tab', { name: /Archived/ }).click()
    await page.getByRole('button', { name: 'Actions for Seasonal extras' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Restore'])
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    await toast(page, 'Add-on group "Seasonal extras" restored').waitFor()
    expect(await page.getByText('Delete', { exact: true }).count()).toBe(0)
  })

  it('says when every group is archived, and shows them on request', async () => {
    const { page } = await open(backend([OLD]))
    await page.getByText('Every add-on group is archived').waitFor()
    await page.getByRole('button', { name: 'Show archived' }).click()
    await card(page, 'Seasonal extras').waitFor()
  })

  it('shows a load error with Retry', async () => {
    let fail = true
    const { page } = await open(backend(undefined, {
      'GET /admin/menu/modifier-groups': () => {
        if (fail) {
          fail = false
          throw failures.server()
        }
        return [MILK]
      },
    }))
    await page.getByText('Could not load add-on groups').waitFor()
    await page.getByRole('button', { name: 'Retry' }).click()
    await card(page, 'Milk choices').waitFor()
  })

  it('opens a group on its own page, and Back returns to the library', async () => {
    const { page } = await open()
    await card(page, 'Milk choices').getByRole('link', { name: 'Manage Milk choices' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/add-ons/grp-1')
    await page.getByRole('heading', { level: 2, name: 'Milk choices' }).waitFor()
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Add-ons' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/add-ons')
  })
})

describe('new add-on group', () => {
  it('creates a group with its rules and add-ons, prices in cents, then opens its page', async () => {
    const created: unknown[] = []
    const syrups = groupOf('grp-9', 'Syrups', [addOn('mod-91', 'Vanilla', 60, { isDefault: true }), addOn('mod-92', 'Caramel', 60)], { maxSelect: 2 })
    const { page } = await open(backend([syrups], {
      'GET /admin/menu/modifier-groups': () => (created.length ? [syrups] : []),
      'POST /admin/menu/modifier-groups': ({ body }) => {
        created.push(body)
        return syrups
      },
    }))
    await page.getByRole('button', { name: 'New add-on group' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name', { exact: true }).fill('Syrups')
    await form.getByLabel('No limit').click()
    await form.getByRole('spinbutton', { name: 'At most' }).fill('2')
    await form.getByRole('spinbutton', { name: 'At most' }).blur()
    await form.getByLabel('Add-on 1', { exact: true }).fill('Vanilla')
    await form.getByRole('spinbutton', { name: 'Price of add-on 1' }).fill('0.6')
    await form.getByRole('spinbutton', { name: 'Price of add-on 1' }).blur()
    await form.getByLabel('Add-on 2', { exact: true }).fill('Caramel')
    await form.getByRole('spinbutton', { name: 'Price of add-on 2' }).fill('0.6')
    await form.getByRole('spinbutton', { name: 'Price of add-on 2' }).blur()
    await form.getByLabel('Pre-select add-on 1').check()
    await form.getByText('Optional · up to 2').waitFor()
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Add-on group "Syrups" created').waitFor()
    expect(created).toEqual([{
      name: 'Syrups',
      minSelect: 0,
      maxSelect: 2,
      modifiers: [{ name: 'Vanilla', priceDeltaMinor: 60, isDefault: true }, { name: 'Caramel', priceDeltaMinor: 60, isDefault: false }],
    }])
    await expect.poll(() => new URL(page.url()).pathname).toBe('/add-ons/grp-9')
    await page.getByRole('heading', { level: 2, name: 'Syrups' }).waitFor()
  })

  it('refuses rules the add-ons can\'t meet, with the server\'s own message, before sending', async () => {
    const { page, api } = await open(backend([]))
    await page.getByRole('button', { name: 'New add-on group' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name', { exact: true }).fill('Milk')
    await form.getByLabel('Add-on 1', { exact: true }).fill('Whole')
    await form.getByLabel('Add-on 2', { exact: true }).fill('Oat')
    await form.getByRole('spinbutton', { name: 'At least' }).fill('3')
    await form.getByRole('spinbutton', { name: 'At least' }).blur()
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Customers must choose 3, but only 2 add-ons are active.').waitFor()
    expect(writes(api.calls)).toEqual([])
  })
})

describe('add-on group page', () => {
  it('shows the group, its add-ons in a table, and the menu items that use it', async () => {
    const { page, api } = await openGroup()
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Milk choices').waitFor()
    await page.getByText('Required · choose exactly 1').first().waitFor()
    await page.getByText('3 active add-ons').waitFor()
    expect(await rowsShown(page)).toEqual(['Whole milk', 'Oat milk', 'Almond milk'])
    expect(await row(page, 'Whole milk').getByRole('checkbox').isChecked()).toBe(true)
    await page.getByText('Default prices can be overridden on individual menu items.').waitFor()
    // Usage: the first 5, each opening the item, and View all.
    await page.getByRole('heading', { name: 'Used by 5 menu items' }).waitFor()
    expect(api.calls).toContain('GET /admin/menu/items')
    await page.getByRole('link', { name: /Iced latte/ }).waitFor()
    expect(await page.getByRole('link', { name: /Iced latte/ }).getAttribute('href')).toBe('/products?item=item-1')
    // Settings: derived rule, status, last updated.
    await page.getByText('Customers must choose exactly 1. Menu items can override these rules.').waitFor()
    await page.getByText('Last updated Sep 28, 2026').waitFor()
    expect(await page.getByRole('button', { name: 'Save changes' }).isDisabled()).toBe(true)
  })

  it('adds and edits add-ons in one dialog, checking names and prices before sending', async () => {
    const add = answering(MILK, (group, body) => ({ modifiers: [...group.modifiers, addOn('mod-10', String(body.name), Number(body.priceDeltaMinor))] }))
    const edit = answering(MILK, group => ({ modifiers: group.modifiers.map(m => (m.id === 'mod-2' ? { ...m, name: 'Oat', priceDeltaMinor: 60 } : m)) }))
    const { page, api } = await openGroup(backend(undefined, {
      'POST /admin/menu/modifier-groups/{id}/modifiers': add.handler,
      'PATCH /admin/menu/modifier-groups/{id}/modifiers/{id}': edit.handler,
    }))
    await page.getByRole('button', { name: 'Add add-on' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add add-on' })
    await dialog.getByLabel('Name').fill('oat milk')
    await dialog.getByRole('spinbutton', { name: 'Default price' }).fill('150')
    await dialog.getByRole('spinbutton', { name: 'Default price' }).blur()
    await dialog.getByRole('button', { name: 'Add add-on' }).click()
    await dialog.getByText('Already used in this group').waitFor()
    await dialog.getByText('At most $100').waitFor()
    expect(writes(api.calls)).toEqual([])
    // An archived add-on's name is free; pre-selecting a second one breaks "exactly 1".
    await dialog.getByLabel('Name').fill('Soy milk')
    await dialog.getByRole('spinbutton', { name: 'Default price' }).fill('0.5')
    await dialog.getByRole('spinbutton', { name: 'Default price' }).blur()
    await dialog.getByLabel('Preselected').check()
    await dialog.getByText('2 add-ons are pre-selected, but customers may choose at most 1.').waitFor()
    await dialog.getByLabel('Preselected').uncheck()
    await dialog.getByRole('button', { name: 'Add add-on' }).click()
    await toast(page, '"Soy milk" added').waitFor()
    expect(add.bodies).toEqual([{ version: 1, name: 'Soy milk', priceDeltaMinor: 50, isDefault: false }])
    await row(page, 'Soy milk').waitFor()

    await row(page, 'Oat milk').getByRole('button', { name: 'Oat milk', exact: true }).click()
    const editDialog = page.getByRole('dialog', { name: 'Edit add-on' })
    expect(await editDialog.getByLabel('Name').inputValue()).toBe('Oat milk')
    await editDialog.getByLabel('Name').fill('Oat')
    await editDialog.getByRole('spinbutton', { name: 'Default price' }).fill('0.6')
    await editDialog.getByRole('spinbutton', { name: 'Default price' }).blur()
    await editDialog.getByRole('button', { name: 'Save' }).click()
    await toast(page, '"Oat" saved').waitFor()
    expect(edit.bodies).toEqual([{ version: 2, name: 'Oat', priceDeltaMinor: 60, isDefault: false }])
  })

  it('keeps the dialog open with the server\'s field error, input kept', async () => {
    const { page } = await openGroup(backend(undefined, {
      'POST /admin/menu/modifier-groups/{id}/modifiers': () => {
        throw new MockFailure(409, 'MODIFIER_NAME_TAKEN', 'This group already has an add-on named "Rice milk".', { name: ['Already used in this group'] })
      },
    }))
    await page.getByRole('button', { name: 'Add add-on' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add add-on' })
    await dialog.getByLabel('Name').fill('Rice milk')
    await dialog.getByRole('button', { name: 'Add add-on' }).click()
    await dialog.getByText('Already used in this group').waitFor()
    expect(await dialog.getByLabel('Name').inputValue()).toBe('Rice milk')
  })

  it('pre-selects with the checkbox, but not past the group\'s maximum', async () => {
    const toggle = answering(SYRUPS, (group, body) => ({ modifiers: group.modifiers.map(m => (m.id === 'syr-1' ? { ...m, isDefault: Boolean(body.isDefault) } : m)) }))
    const { page } = await openGroup(backend(undefined, { 'PATCH /admin/menu/modifier-groups/{id}/modifiers/{id}': toggle.handler }), 'grp-2')
    await row(page, 'Caramel').getByRole('checkbox').click()
    await expect.poll(() => row(page, 'Caramel').getByRole('checkbox').isChecked()).toBe(true)
    expect(toggle.bodies).toEqual([{ version: 1, isDefault: true }])

    // Milk: exactly 1, Whole milk is pre-selected: the others can't be.
    const { page: milk } = await openGroup()
    expect(await row(milk, 'Oat milk').getByRole('checkbox').isDisabled()).toBe(true)
    await row(milk, 'Oat milk').getByRole('button', { name: 'Actions for Oat milk' }).click()
    const set = milk.getByRole('menuitem', { name: /Set as preselected/ })
    expect(await set.getAttribute('aria-disabled')).toBe('true')
    await set.getByText('2 add-ons are pre-selected, but customers may choose at most 1.').waitFor()
  })

  it('archives an add-on after saying what customers stop seeing, and restores it', async () => {
    const archive = answering(MILK, group => ({ modifiers: group.modifiers.map(m => (m.id === 'mod-3' ? { ...m, status: 'archived' as const } : m)) }))
    const restore = answering({ ...MILK, version: 2 }, group => ({ modifiers: group.modifiers.map(m => (m.id === 'mod-9' ? { ...m, status: 'active' as const } : m)) }))
    const { page } = await openGroup(backend(undefined, {
      'POST /admin/menu/modifier-groups/{id}/modifiers/{id}/archive': archive.handler,
      'POST /admin/menu/modifier-groups/{id}/modifiers/{id}/restore': restore.handler,
    }))
    await row(page, 'Almond milk').getByRole('button', { name: 'Actions for Almond milk' }).click()
    await page.getByRole('menuitem', { name: 'Archive add-on' }).click()
    await page.getByText('Customers stop seeing it on the 18 menu items that offer “Milk choices”. You can restore it later.').waitFor()
    await page.getByRole('button', { name: 'Archive add-on' }).click()
    await toast(page, '"Almond milk" archived').waitFor()
    await expect.poll(() => rowsShown(page)).toEqual(['Whole milk', 'Oat milk'])

    await page.getByRole('button', { name: 'Archived add-ons (2)' }).click()
    await page.getByRole('button', { name: 'Restore Soy milk' }).click()
    await toast(page, '"Soy milk" restored').waitFor()
    expect(archive.bodies).toEqual([{ version: 1 }])
    expect(restore.bodies).toEqual([{ version: 2 }])
  })

  it('won\'t archive the add-on the group needs, and says why', async () => {
    const one = groupOf('grp-4', 'Cup', [addOn('c-1', 'Paper cup', 0)], { minSelect: 1, maxSelect: 1 })
    const { page } = await openGroup(backend([one]), 'grp-4')
    await row(page, 'Paper cup').getByRole('button', { name: 'Actions for Paper cup' }).click()
    const archive = page.getByRole('menuitem', { name: /Archive add-on/ })
    expect(await archive.getAttribute('aria-disabled')).toBe('true')
    await archive.getByText('A group needs at least one active add-on. Archive the group instead.').waitFor()
  })

  it('searches the group\'s add-ons', async () => {
    const { page } = await openGroup()
    await page.getByRole('textbox', { name: 'Search add-ons' }).fill('alm')
    await expect.poll(() => rowsShown(page)).toEqual(['Almond milk'])
    await page.getByRole('textbox', { name: 'Search add-ons' }).fill('rice')
    await page.getByText('No add-ons match “rice”.').waitFor()
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.poll(() => rowsShown(page)).toEqual(['Whole milk', 'Oat milk', 'Almond milk'])
  })
})

describe('group settings', () => {
  it('saves name and rules together in one call, only what changed', async () => {
    const update = answering(MILK, (_, body) => ({ ...(body.name ? { name: String(body.name) } : {}), minSelect: Number(body.minSelect ?? 1), maxSelect: (body.maxSelect ?? 1) as number | null }))
    const { page } = await openGroup(backend(undefined, { 'PATCH /admin/menu/modifier-groups/{id}': update.handler }))
    await page.getByLabel('Group name').fill('Milk')
    await page.getByRole('radio', { name: 'Optional' }).click()
    await page.getByRole('spinbutton', { name: 'Maximum selections' }).fill('2')
    await page.getByRole('spinbutton', { name: 'Maximum selections' }).blur()
    await page.getByText('Optional · up to 2').waitFor()
    await page.getByText('Customers may choose up to 2, or none. Menu items can override these rules.').waitFor()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await toast(page, '"Milk" saved').waitFor()
    expect(update.bodies).toEqual([{ version: 1, name: 'Milk', minSelect: 0, maxSelect: 2 }])
    await expect.poll(() => page.getByRole('button', { name: 'Save changes' }).isDisabled()).toBe(true)
  })

  it('checks the rules next to their fields before sending', async () => {
    const { page, api } = await openGroup()
    await page.getByRole('spinbutton', { name: 'Minimum selections' }).fill('2')
    await page.getByRole('spinbutton', { name: 'Minimum selections' }).blur()
    await page.getByText('Can\'t be less than the minimum').waitFor()
    await page.getByLabel('No maximum').check()
    await page.getByRole('spinbutton', { name: 'Minimum selections' }).fill('4')
    await page.getByRole('spinbutton', { name: 'Minimum selections' }).blur()
    await page.getByText('Customers must choose 4, but only 3 add-ons are active.').waitFor()
    await page.getByLabel('Group name').fill('')
    await page.getByText('Name is required').waitFor()
    await page.getByRole('button', { name: 'Save changes' }).click()
    expect(writes(api.calls)).toEqual([])
  })

  it('shows a taken name on its field', async () => {
    const { page } = await openGroup(backend(undefined, {
      'PATCH /admin/menu/modifier-groups/{id}': () => {
        throw new MockFailure(409, 'MODIFIER_GROUP_NAME_TAKEN', 'There is already an add-on group named "Syrups".', { name: ['Already used by another add-on group'] })
      },
    }))
    await page.getByLabel('Group name').fill('Syrups')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByText('Already used by another add-on group').waitFor()
    expect(await page.getByLabel('Group name').inputValue()).toBe('Syrups')
  })

  it('won\'t overwrite settings someone else changed while the draft was open', async () => {
    // Someone renamed the group meanwhile: the next answer (a pre-selection) carries their name.
    const toggle = answering(SYRUPS, (group, body) => ({ name: 'Flavours', modifiers: group.modifiers.map(m => (m.id === 'syr-1' ? { ...m, isDefault: Boolean(body.isDefault) } : m)) }))
    const { page, api } = await openGroup(backend(undefined, { 'PATCH /admin/menu/modifier-groups/{id}/modifiers/{id}': toggle.handler }), 'grp-2')
    await page.getByLabel('Group name').fill('Sweeteners')
    await row(page, 'Caramel').getByRole('checkbox').click()
    await page.getByRole('heading', { level: 2, name: 'Flavours' }).waitFor()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByText('Someone else changed this add-on group').waitFor()
    expect(api.calls.filter(c => c === 'PATCH /admin/menu/modifier-groups/grp-2')).toEqual([])
    await page.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => page.getByLabel('Group name').inputValue()).toBe('Flavours')
  })

  it('asks before leaving with unsaved settings', async () => {
    const { page } = await openGroup()
    await page.getByLabel('Group name').fill('Dairy')
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Add-ons' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('archives the group from its page, then shows it read-only with Restore', async () => {
    const archive = answering(MILK, () => ({ status: 'archived' }))
    const restore = answering({ ...MILK, status: 'archived', version: 2 }, () => ({ status: 'active' }))
    const { page } = await openGroup(backend(undefined, {
      'POST /admin/menu/modifier-groups/{id}/archive': archive.handler,
      'POST /admin/menu/modifier-groups/{id}/restore': restore.handler,
    }))
    await page.getByRole('button', { name: 'Archive group' }).click()
    await page.getByText('18 menu items offer this group and will keep offering it').waitFor()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Archive group' }).click()
    await page.getByText('This add-on group is archived').waitFor()
    expect(await page.getByRole('button', { name: 'Add add-on' }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /Actions for/ }).count()).toBe(0)
    expect(await page.getByLabel('Group name').isDisabled()).toBe(true)
    await page.getByRole('button', { name: 'Restore group' }).first().click()
    await page.getByRole('button', { name: 'Add add-on' }).waitFor()
    expect(archive.bodies).toEqual([{ version: 1 }])
    expect(restore.bodies).toEqual([{ version: 2 }])
  })

  it('says when a group doesn\'t exist', async () => {
    const { page } = await open(backend(), '/add-ons/grp-404')
    await page.getByText('This add-on group doesn\'t exist').waitFor()
    await page.getByRole('link', { name: 'Back to Add-ons' }).first().waitFor()
  })
})

describe('reordering add-ons', () => {
  it('moves with buttons and keys, keeps focus, announces, and saves once with Save order', async () => {
    const order = answering(MILK, (group, body) => ({ modifiers: (body.modifierIds as string[]).map((id, i) => ({ ...group.modifiers.find(m => m.id === id)!, sortOrder: i + 1 })).concat(group.modifiers.filter(m => m.status === 'archived')) }))
    const { page } = await openGroup(backend(undefined, { 'PUT /admin/menu/modifier-groups/{id}/modifiers/order': order.handler }))
    await page.getByRole('button', { name: 'Reorder', exact: true }).click()
    await page.getByRole('heading', { name: 'Reorder add-ons' }).waitFor()
    expect(await page.getByRole('button', { name: 'Move Whole milk up' }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: 'Move Whole milk down' }).click()
    await page.getByRole('button', { name: 'Move Whole milk down' }).click()
    expect(await orderShown(page)).toEqual(['Oat milk', 'Almond milk', 'Whole milk'])
    await expect.poll(() => focused(page)).toBe('Move Whole milk up')
    await expect.poll(() => page.locator('[aria-live="polite"]').filter({ hasText: 'moved' }).innerText()).toBe('Whole milk moved to position 3 of 3')
    await page.getByRole('button', { name: /Reorder Almond milk/ }).focus()
    await page.keyboard.press('ArrowUp')
    expect(await orderShown(page)).toEqual(['Almond milk', 'Oat milk', 'Whole milk'])
    await expect.poll(() => focused(page)).toBe('Reorder Almond milk (drag, or press up or down)')
    // Nothing is sent until Save order.
    expect(order.bodies).toEqual([])
    await page.getByRole('button', { name: 'Save order' }).click()
    await page.getByRole('button', { name: 'Reorder', exact: true }).waitFor()
    expect(order.bodies).toEqual([{ version: 1, modifierIds: ['mod-3', 'mod-2', 'mod-1'] }])
    expect(await rowsShown(page)).toEqual(['Almond milk', 'Oat milk', 'Whole milk'])
  })

  it('drags by the handle, and Cancel drops the moves without saving', async () => {
    const { page, api } = await openGroup()
    await page.getByRole('button', { name: 'Reorder', exact: true }).click()
    await page.getByRole('button', { name: /Reorder Almond milk/ }).dragTo(page.getByRole('button', { name: /Reorder Whole milk/ }))
    await expect.poll(() => orderShown(page)).toEqual(['Almond milk', 'Whole milk', 'Oat milk'])
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(await rowsShown(page)).toEqual(['Whole milk', 'Oat milk', 'Almond milk'])
    expect(writes(api.calls)).toEqual([])
  })

  it('keeps the new order after a refused save, and Reload after a conflict', async () => {
    let tries = 0
    const fresh = { ...MILK, version: 5 }
    const { page } = await openGroup(backend([MILK], {
      'GET /admin/menu/modifier-groups/{id}': () => (tries ? fresh : MILK),
      'PUT /admin/menu/modifier-groups/{id}/modifiers/order': () => {
        tries++
        throw failures.conflict('VERSION_CONFLICT', 'This add-on group was changed by someone else. Reload it and try again.')
      },
    }))
    await page.getByRole('button', { name: 'Reorder', exact: true }).click()
    await page.getByRole('button', { name: 'Move Almond milk up' }).click()
    await page.getByRole('button', { name: 'Save order' }).click()
    await page.getByText('Someone else changed this add-on group').waitFor()
    // Still reordering, the moves kept.
    expect(await orderShown(page)).toEqual(['Whole milk', 'Almond milk', 'Oat milk'])
    await page.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => page.getByText('Someone else changed this add-on group').count()).toBe(0)
    expect(await orderShown(page)).toEqual(['Whole milk', 'Oat milk', 'Almond milk'])
  })

  it('asks before leaving with an unsaved order', async () => {
    const { page } = await openGroup()
    await page.getByRole('button', { name: 'Reorder', exact: true }).click()
    await page.getByRole('button', { name: 'Move Almond milk up' }).click()
    await page.getByRole('link', { name: 'Add-ons' }).first().click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})

describe('add-ons on a phone', () => {
  it('fits the library without scrolling sideways', async () => {
    const { page } = await open(backend(), '/add-ons', 390)
    await card(page, 'Milk choices').waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  it('shows Add-ons and Settings as tabs, row actions in a bottom sheet, and Save changes at hand', async () => {
    const toggle = answering(SYRUPS, (group, body) => ({ modifiers: group.modifiers.map(m => (m.id === 'syr-0' ? { ...m, isDefault: Boolean(body.isDefault) } : m)) }))
    const { page } = await openGroup(backend(undefined, { 'PATCH /admin/menu/modifier-groups/{id}/modifiers/{id}': toggle.handler }), 'grp-2', 390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await row(page, 'Vanilla').getByText('Default price $0.50').waitFor()
    await row(page, 'Vanilla').getByRole('button', { name: 'Actions for Vanilla' }).click()
    const sheet = page.getByRole('dialog', { name: 'Vanilla' })
    await sheet.getByRole('button', { name: 'Edit add-on' }).waitFor()
    await sheet.getByRole('button', { name: 'Set as preselected' }).click()
    await expect.poll(() => toggle.bodies).toEqual([{ version: 1, isDefault: true }])
    await row(page, 'Vanilla').getByText('Preselected').waitFor()

    await page.getByRole('tab', { name: /Settings/ }).click()
    await page.getByLabel('Group name').fill('Flavors')
    // While the name field has the keyboard, the bar steps aside; it comes back on blur
    const bar = page.getByRole('toolbar', { name: 'Settings actions' })
    await expect.poll(() => bar.isVisible()).toBe(false)
    await page.getByLabel('Group name').blur()
    const save = bar.getByRole('button', { name: 'Save changes' })
    await save.waitFor()
    const box = (await save.boundingBox())!
    expect(box.y + box.height).toBeGreaterThan(844 - 40)
    await page.getByRole('tab', { name: /Add-ons/ }).click()
    await row(page, 'Vanilla').waitFor()
  })
  it('opens an add-on from its name, with its actions beside the name (not inside it)', async () => {
    const { page } = await openGroup(backend(), 'grp-1', 390)
    const target = row(page, 'Oat milk').getByRole('button', { name: 'Oat milk', exact: true })
    const actions = row(page, 'Oat milk').getByRole('button', { name: 'Actions for Oat milk' })
    expect(await actions.evaluate(el => el.parentElement?.closest('button, a') === null)).toBe(true)
    expect((await actions.boundingBox())!.x).toBeGreaterThanOrEqual((await target.boundingBox())!.x + (await target.boundingBox())!.width)
    await target.click()
    await page.getByRole('dialog', { name: 'Edit add-on' }).waitFor()
  })

  it('puts Cancel and Save order at the bottom of the screen while reordering', async () => {
    const { page } = await openGroup(backend(), 'grp-1', 390)
    await page.getByRole('button', { name: 'Reorder', exact: true }).click()
    const bar = page.getByRole('toolbar', { name: 'Reorder' })
    await bar.getByRole('button', { name: 'Save order' }).waitFor()
    const box = (await bar.boundingBox())!
    expect(Math.round(box.y + box.height)).toBe(844)
    await bar.getByRole('button', { name: 'Cancel' }).click()
    await row(page, 'Oat milk').waitFor()
  })
})

describe('add-on rows by the width of their column', () => {
  // The list is a container (D82): beside the settings column at 1024px it's narrow and stacks;
  // at 1440px it has room for the price and Preselected columns.
  it('stacks beside the settings column at 1024px', async () => {
    const { page } = await openGroup(backend(), 'grp-1', 1024)
    await row(page, 'Oat milk').getByText(/^Default price/).waitFor()
    expect(await page.getByRole('checkbox', { name: 'Oat milk is preselected' }).isVisible()).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  it('shows the price and Preselected columns at 1440px', async () => {
    const { page } = await openGroup(backend(), 'grp-1', 1440)
    await page.getByRole('checkbox', { name: 'Oat milk is preselected' }).waitFor()
    expect(await row(page, 'Oat milk').getByText(/^Default price/).isVisible()).toBe(false)
    const reorderAbove = async () => {
      await page.getByRole('button', { name: 'Reorder', exact: true }).click()
      const bar = page.getByRole('toolbar', { name: 'Reorder' })
      await bar.waitFor()
      return bar.evaluate(el => getComputedStyle(el).position)
    }
    expect(await reorderAbove()).toBe('static')
  })
})

describe('from an add-on group to its menu items', () => {
  const ITEMS_BACKEND = (seen: URLSearchParams[]): Record<string, MockHandler> => ({
    'GET /admin/menu/items': ({ url }) => {
      if (url.searchParams.get('pageSize') !== '1') seen.push(url.searchParams)
      return pageOf<MenuItemSummary>(url.searchParams.get('modifierGroupId') ? [LATTE] : [LATTE, menuItemSummaryOf('item-7', 'Scone')])
    },
    'GET /admin/menu/modifier-groups': () => [MILK],
    'GET /admin/menu/items/{id}': () => menuItemOf('item-1', 'Iced latte'),
    'GET /admin/menu/option-sets': () => [],
    'GET /admin/menu/availability-rules': () => [],
  })

  it('filters Menu items by the group, named and removable', async () => {
    const seen: URLSearchParams[] = []
    const { page } = await open(ITEMS_BACKEND(seen), '/products?modifierGroupId=grp-1')
    await page.getByRole('button', { name: 'Offers Milk choices: remove this filter' }).waitFor()
    expect(seen[0]?.get('modifierGroupId')).toBe('grp-1')
    await page.getByRole('article', { name: 'Iced latte', exact: true }).waitFor()
    expect(await page.getByRole('article', { name: 'Scone', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Offers Milk choices: remove this filter' }).click()
    await page.getByRole('article', { name: 'Scone', exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('modifierGroupId')).toBeNull()
  })

  it('opens the item a link names, and closing it removes only `item` from the URL (D90)', async () => {
    const seen: URLSearchParams[] = []
    const { page, api } = await open(ITEMS_BACKEND(seen), '/products?modifierGroupId=grp-1&item=item-1')
    await expect.poll(() => api.calls).toContain('GET /admin/menu/items/item-1')
    await expect.poll(() => page.getByRole('dialog').getByLabel('Name', { exact: true }).inputValue()).toBe('Iced latte')
    expect(new URL(page.url()).searchParams.get('item')).toBe('item-1')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBeNull()
    expect(new URL(page.url()).searchParams.get('modifierGroupId')).toBe('grp-1')
  })
})
