import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { Modifier, ModifierGroup } from '../../shared/contracts/menu-modifiers'
import { MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

const STAMP = '2026-09-28T00:00:00.000Z'
const addOn = (id: string, name: string, priceDeltaMinor: number, overrides: Partial<Modifier> = {}): Modifier =>
  ({ id, name, priceDeltaMinor, isDefault: false, sortOrder: 1, status: 'active', ...overrides })

function groupOf(id: string, name: string, modifiers: Modifier[], overrides: Partial<ModifierGroup> = {}): ModifierGroup {
  return { id, name, minSelect: 0, maxSelect: null, status: 'active', modifiers, itemCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

const MILK = groupOf('grp-1', 'Milk', [addOn('mod-1', 'Whole', 0, { isDefault: true }), addOn('mod-2', 'Oat', 50), addOn('mod-3', 'Soy', 50)], { minSelect: 1, maxSelect: 1, itemCount: 6 })
const SHOTS = groupOf('grp-2', 'Extra shot', [addOn('mod-4', 'Shot', 75)], { maxSelect: 2 })
const OLD = groupOf('grp-3', 'Toppings (old)', [addOn('mod-5', 'Sprinkles', 25)], { status: 'archived', version: 2 })

async function open(groups: ModifierGroup[] = [MILK, SHOTS, OLD], extra: Parameters<typeof mockApi>[1] = {}) {
  const page = await createPage()
  const api = await mockApi(page, { 'GET /admin/menu/modifier-groups': () => groups, ...extra })
  await page.goto(url('/add-ons'), { waitUntil: 'hydration' })
  return { page, api }
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))

async function openEditor(page: Page, name: string) {
  await card(page, name).getByRole('heading').click()
  const editor = page.getByRole('dialog')
  await editor.getByText('Changes are saved as you make them.').waitFor()
  return editor
}

describe('add-ons list', () => {
  it('shows each group\'s rules in words, its add-ons with prices, and what offers it', async () => {
    const { page } = await open()
    await card(page, 'Milk').getByText('Required · choose 1').waitFor()
    await card(page, 'Milk').getByText('Offered by 6 menu items').waitFor()
    expect(await card(page, 'Milk').getByRole('list', { name: 'Add-ons in Milk' }).getByRole('listitem').allInnerTexts())
      .toEqual(['Whole Free', 'Oat +$0.50', 'Soy +$0.50'].map(text => expect.stringContaining(text.split(' ')[0]!)))
    await card(page, 'Milk').getByText('+$0.50').first().waitFor()
    await card(page, 'Extra shot').getByText('Optional · up to 2').waitFor()
    expect(await card(page, 'Toppings (old)').count()).toBe(0)
    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Toppings (old)').waitFor()
  })

  it('says how many items keep a group before archiving it', async () => {
    const bodies: unknown[] = []
    const { page } = await open(undefined, {
      'POST /admin/menu/modifier-groups/{id}/archive': ({ body }) => {
        bodies.push(body)
        return { ...MILK, status: 'archived', version: 2 }
      },
    })
    await page.getByRole('button', { name: 'Actions for Milk' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('6 menu items offer it and will keep offering it').waitFor()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, 'Add-on group "Milk" archived').waitFor()
    expect(bodies).toEqual([{ version: 1 }])
  })
})

describe('new add-on group', () => {
  it('creates a group with its rules and add-ons, prices in cents, then opens it', async () => {
    const created: unknown[] = []
    const { page } = await open([], {
      'POST /admin/menu/modifier-groups': ({ body }) => {
        created.push(body)
        return groupOf('grp-9', 'Syrups', [addOn('mod-91', 'Vanilla', 60), addOn('mod-92', 'Caramel', 60)])
      },
    })
    await page.getByRole('button', { name: 'New add-on group' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name').fill('Syrups')
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
    await page.getByRole('dialog').getByText('Changes are saved as you make them.').waitFor()
  })

  it('refuses rules the add-ons can\'t meet, with the server\'s own message, before sending', async () => {
    const { page, api } = await open([])
    await page.getByRole('button', { name: 'New add-on group' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name').fill('Milk')
    await form.getByLabel('Add-on 1', { exact: true }).fill('Whole')
    await form.getByLabel('Add-on 2', { exact: true }).fill('Oat')
    await form.getByRole('spinbutton', { name: 'At least' }).fill('3')
    await form.getByRole('spinbutton', { name: 'At least' }).blur()
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Customers must choose 3, but only 2 add-ons are active.').waitFor()
    expect(writes(api.calls)).toEqual([])
  })
})

describe('add-on group editor', () => {
  it('saves rules, prices, pre-selection and new add-ons at once, each with the previous version', async () => {
    let current = MILK
    const bodies: { call: string, body: unknown }[] = []
    const step = (call: string, change: (group: ModifierGroup, body: Record<string, unknown>) => ModifierGroup) => ({ body }: { body: unknown }) => {
      bodies.push({ call, body })
      current = { ...change(current, body as Record<string, unknown>), version: current.version + 1 }
      return current
    }
    const patchModifier = (group: ModifierGroup, id: string, body: Record<string, unknown>) =>
      ({ ...group, modifiers: group.modifiers.map(m => (m.id === id ? { ...m, ...body, version: undefined } as Modifier : m)) })
    const { page } = await open([MILK], {
      'PATCH /admin/menu/modifier-groups/{id}': step('rules', (group, body) => ({ ...group, minSelect: Number(body.minSelect), maxSelect: body.maxSelect as number | null })),
      'PATCH /admin/menu/modifier-groups/{id}/modifiers/{id}': ({ url, body }) =>
        step('add-on', group => patchModifier(group, url.pathname.split('/').pop()!, body as Record<string, unknown>))({ body }),
      'POST /admin/menu/modifier-groups/{id}/modifiers': step('add', (group, body) => ({ ...group, modifiers: [...group.modifiers, addOn('mod-8', String(body.name), Number(body.priceDeltaMinor))] })),
    })
    const editor = await openEditor(page, 'Milk')

    await editor.getByLabel('No limit').click()
    await editor.getByRole('spinbutton', { name: 'At least' }).fill('0')
    await editor.getByRole('spinbutton', { name: 'At least' }).blur()
    await editor.getByText('Optional · any number').waitFor()
    await editor.getByRole('button', { name: 'Save rules' }).click()
    await toast(page, '"Milk" saved').waitFor()

    await editor.getByRole('spinbutton', { name: 'Price of Oat' }).fill('0.75')
    await editor.getByRole('spinbutton', { name: 'Price of Oat' }).blur()
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await toast(page, '"Oat" saved').waitFor()

    await editor.getByLabel('Pre-select Oat').click()
    await expect.poll(() => bodies.length).toBe(3)

    await editor.getByLabel('New add-on', { exact: true }).fill('Almond')
    await editor.getByRole('spinbutton', { name: 'Price of new add-on' }).fill('0.8')
    await editor.getByRole('spinbutton', { name: 'Price of new add-on' }).blur()
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await toast(page, '"Almond" added').waitFor()

    expect(bodies).toEqual([
      { call: 'rules', body: { version: 1, minSelect: 0, maxSelect: null } },
      { call: 'add-on', body: { version: 2, priceDeltaMinor: 75 } },
      { call: 'add-on', body: { version: 3, isDefault: true } },
      { call: 'add', body: { version: 4, name: 'Almond', priceDeltaMinor: 80 } },
    ])
  })

  it('shows the server\'s refusal inside the editor, where toasts can\'t be reached', async () => {
    const { page } = await open([MILK], {
      'PATCH /admin/menu/modifier-groups/{id}/modifiers/{id}': () => {
        throw new MockFailure(422, 'SELECTION_RULES', '2 add-ons are pre-selected, but customers may choose at most 1.', { modifiers: ['2 add-ons are pre-selected, but customers may choose at most 1.'] })
      },
    })
    const editor = await openEditor(page, 'Milk')
    await editor.getByLabel('Pre-select Oat').click()
    await editor.getByText('That change wasn\'t saved').waitFor()
    await editor.getByText('2 add-ons are pre-selected, but customers may choose at most 1.').waitFor()
  })

  it('checks rules against the add-ons before sending them', async () => {
    const { page, api } = await open([SHOTS])
    const editor = await openEditor(page, 'Extra shot')
    await editor.getByRole('spinbutton', { name: 'At least' }).fill('2')
    await editor.getByRole('spinbutton', { name: 'At least' }).blur()
    await editor.getByText('Customers must choose 2, but only 1 add-on is active.').waitFor()
    expect(await editor.getByRole('button', { name: 'Save rules' }).isDisabled()).toBe(true)
    expect(writes(api.calls)).toEqual([])
  })

  it('won\'t archive the last add-on', async () => {
    const { page } = await open([SHOTS])
    const editor = await openEditor(page, 'Extra shot')
    expect(await editor.getByRole('button', { name: 'Archive Shot' }).isDisabled()).toBe(true)
  })
})
