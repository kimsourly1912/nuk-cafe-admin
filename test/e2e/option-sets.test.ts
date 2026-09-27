import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { OptionSet, OptionValue } from '../../shared/contracts/menu-options'
import { failures, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

const STAMP = '2026-09-27T00:00:00.000Z'
const value = (id: string, name: string, sortOrder: number, status: OptionValue['status'] = 'active'): OptionValue => ({ id, name, sortOrder, status })

function setOf(id: string, name: string, values: OptionValue[], overrides: Partial<OptionSet> = {}): OptionSet {
  return { id, name, status: 'active', values, itemCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

const SIZE = setOf('set-1', 'Size', [value('val-1', 'Small', 1), value('val-2', 'Regular', 2), value('val-3', 'Large', 3), value('val-4', 'Kids', 4, 'archived')], { itemCount: 4 })
const TEMP = setOf('set-2', 'Temperature', [value('val-5', 'Hot', 1), value('val-6', 'Iced', 2)])
const OLD = setOf('set-3', 'Syrup (old)', [value('val-7', 'Vanilla', 1)], { status: 'archived', version: 3 })

async function open(sets: OptionSet[] = [SIZE, TEMP, OLD], extra: Parameters<typeof mockApi>[1] = {}) {
  const page = await createPage()
  const api = await mockApi(page, { 'GET /admin/menu/option-sets': () => sets, ...extra })
  await page.goto(url('/options'), { waitUntil: 'hydration' })
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

/** A handler that records bodies and answers with the set moved to the next version. */
function answering(set: OptionSet, change: (set: OptionSet, body: Record<string, unknown>) => Partial<OptionSet> = () => ({})) {
  const bodies: Record<string, unknown>[] = []
  let current = set
  const handler = ({ body }: { body: unknown }) => {
    bodies.push(body as Record<string, unknown>)
    current = { ...current, ...change(current, body as Record<string, unknown>), version: current.version + 1 }
    return current
  }
  return { bodies, handler }
}

describe('options list', () => {
  it('shows each set\'s active values in order, archived ones counted, and what uses it', async () => {
    const { page } = await open()
    await card(page, 'Size').getByText('Used by 4 menu items').waitFor()
    await card(page, 'Size').getByText('+ 1 archived').waitFor()
    expect(await card(page, 'Size').getByRole('list', { name: 'Values of Size' }).getByRole('listitem').allInnerTexts()).toEqual(['Small', 'Regular', 'Large'])
    await card(page, 'Temperature').getByText('Not used yet').waitFor()
    expect(await card(page, 'Syrup (old)').count()).toBe(0)
    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Syrup (old)').waitFor()
  })

  it('archives a set after saying how many items keep it, and restores an archived one', async () => {
    const archive = answering(SIZE, () => ({ status: 'archived' }))
    const restore = answering(OLD, () => ({ status: 'active' }))
    const { page } = await open(undefined, {
      'POST /admin/menu/option-sets/{id}/archive': archive.handler,
      'POST /admin/menu/option-sets/{id}/restore': restore.handler,
    })
    await page.getByRole('button', { name: 'Actions for Size' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('4 menu items use it and will keep it').waitFor()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, 'Option set "Size" archived').waitFor()
    expect(archive.bodies).toEqual([{ version: 1 }])

    await page.getByRole('tab', { name: /Archived/ }).click()
    await page.getByRole('button', { name: 'Actions for Syrup (old)' }).click()
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    await toast(page, 'Option set "Syrup (old)" restored').waitFor()
    expect(restore.bodies).toEqual([{ version: 3 }])
  })
})

describe('new option set', () => {
  it('creates a set with its values in the order typed, then opens it in the editor', async () => {
    const created: unknown[] = []
    const { page } = await open([], {
      'POST /admin/menu/option-sets': ({ body }) => {
        created.push(body)
        return setOf('set-9', 'Milk', [value('val-91', 'Whole', 1), value('val-92', 'Oat', 2), value('val-93', 'Soy', 3)])
      },
    })
    await page.getByRole('button', { name: 'New option set' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name').fill('Milk')
    await form.getByLabel('Value 1', { exact: true }).fill('Whole')
    await form.getByLabel('Value 2', { exact: true }).fill('Oat')
    await form.getByLabel('Value 2', { exact: true }).press('Enter')
    await form.getByLabel('Value 3', { exact: true }).fill(' Soy ')
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Option set "Milk" created').waitFor()
    expect(created).toEqual([{ name: 'Milk', values: ['Whole', 'Oat', 'Soy'] }])
    await page.getByRole('dialog').getByText('Changes are saved as you make them.').waitFor()
  })

  it('refuses a value listed twice before sending anything', async () => {
    const { page, api } = await open([])
    await page.getByRole('button', { name: 'New option set' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name').fill('Size')
    await form.getByLabel('Value 1', { exact: true }).fill('Small')
    await form.getByLabel('Value 2', { exact: true }).fill('small')
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Each value can be listed only once').waitFor()
    expect(writes(api.calls)).toEqual([])
  })
})

describe('option set editor', () => {
  it('saves each change at once, sending the version of the previous answer', async () => {
    let current = SIZE
    const bodies: { call: string, body: unknown }[] = []
    const step = (call: string, change: (set: OptionSet, body: Record<string, unknown>) => OptionSet) => ({ body }: { body: unknown }) => {
      bodies.push({ call, body })
      current = { ...change(current, body as Record<string, unknown>), version: current.version + 1 }
      return current
    }
    const { page } = await open([SIZE], {
      'PATCH /admin/menu/option-sets/{id}': step('rename', (set, body) => ({ ...set, name: String(body.name) })),
      'POST /admin/menu/option-sets/{id}/values': step('add', (set, body) => ({ ...set, values: [...set.values, value('val-8', String(body.name), 5)] })),
      'PATCH /admin/menu/option-sets/{id}/values/{id}': step('rename value', set => ({ ...set, values: set.values.map(v => (v.id === 'val-2' ? { ...v, name: 'Medium' } : v)) })),
      'POST /admin/menu/option-sets/{id}/values/{id}/archive': step('archive value', set => ({ ...set, values: set.values.map(v => (v.id === 'val-1' ? { ...v, status: 'archived' as const } : v)) })),
      'POST /admin/menu/option-sets/{id}/values/{id}/restore': step('restore value', set => ({ ...set, values: set.values.map(v => (v.id === 'val-4' ? { ...v, status: 'active' as const, sortOrder: 9 } : v)) })),
    })
    const editor = await openEditor(page, 'Size')

    await editor.getByRole('textbox').first().fill('Cup size')
    await editor.getByRole('button', { name: 'Save name' }).click()
    await toast(page, 'Renamed to "Cup size"').waitFor()

    await editor.getByLabel('New value').fill('Extra large')
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await toast(page, '"Extra large" added').waitFor()

    await editor.getByLabel('Name of Regular').fill('Medium')
    await editor.getByLabel('Name of Regular').press('Enter')
    await toast(page, 'Renamed to "Medium"').waitFor()

    await editor.getByRole('button', { name: 'Archive Small' }).click()
    await toast(page, '"Small" archived').waitFor()

    await editor.getByRole('listitem', { name: 'Kids' }).getByRole('button', { name: 'Restore' }).click()
    await toast(page, '"Kids" restored').waitFor()

    expect(bodies).toEqual([
      { call: 'rename', body: { version: 1, name: 'Cup size' } },
      { call: 'add', body: { version: 2, name: 'Extra large' } },
      { call: 'rename value', body: { version: 3, name: 'Medium' } },
      { call: 'archive value', body: { version: 4 } },
      { call: 'restore value', body: { version: 5 } },
    ])
  })

  it('reorders values with ↑/↓ on the handle, sending every active value', async () => {
    const order = answering(SIZE, (set, body) => ({ values: (body.valueIds as string[]).map((id, i) => ({ ...set.values.find(v => v.id === id)!, sortOrder: i + 1 })).concat(set.values.filter(v => v.status === 'archived')) }))
    const { page } = await open([SIZE], { 'PUT /admin/menu/option-sets/{id}/values/order': order.handler })
    const editor = await openEditor(page, 'Size')
    await editor.getByRole('button', { name: 'Move Large' }).focus()
    await page.keyboard.press('ArrowUp')
    await toast(page, 'Order saved').waitFor()
    expect(order.bodies).toEqual([{ version: 1, valueIds: ['val-1', 'val-3', 'val-2'] }])
    await expect.poll(() => editor.getByRole('list').first().getByRole('listitem').evaluateAll(items => items.map(i => i.getAttribute('aria-label')))).toEqual(['Small', 'Large', 'Regular'])
  })

  it('won\'t archive the last active value', async () => {
    const one = setOf('set-4', 'Cup', [value('val-9', 'One size', 1)])
    const { page } = await open([one])
    const editor = await openEditor(page, 'Cup')
    expect(await editor.getByRole('button', { name: 'Archive One size' }).isDisabled()).toBe(true)
  })

  it('offers Reload when someone else changed the set, and continues from the fresh version', async () => {
    const fresh = { ...SIZE, name: 'Cup size', version: 7 }
    const bodies: unknown[] = []
    let conflict = true
    const { page } = await open([SIZE], {
      'GET /admin/menu/option-sets/{id}': () => fresh,
      'POST /admin/menu/option-sets/{id}/values': ({ body }) => {
        bodies.push(body)
        if (conflict) {
          conflict = false
          throw failures.conflict('VERSION_CONFLICT', 'This option set was changed by someone else. Reload it and try again.')
        }
        return { ...fresh, version: 8 }
      },
    })
    const editor = await openEditor(page, 'Size')
    await editor.getByLabel('New value').fill('Extra large')
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await toast(page, 'Could not add "Extra large"').waitFor()
    await editor.getByText('Someone else changed this option set').waitFor()
    await editor.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => editor.getByText('Someone else changed this option set').count()).toBe(0)
    await expect.poll(() => editor.getByRole('textbox').first().inputValue()).toBe('Cup size')
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await toast(page, '"Extra large" added').waitFor()
    expect(bodies).toEqual([{ version: 1, name: 'Extra large' }, { version: 7, name: 'Extra large' }])
  })

  it('asks before closing with typed but unsaved text', async () => {
    const { page } = await open([SIZE])
    const editor = await openEditor(page, 'Size')
    await editor.getByLabel('New value').fill('Extra large')
    await editor.getByRole('button', { name: 'Done' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})
