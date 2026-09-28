import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { OptionSet, OptionValue } from '../../shared/contracts/menu-options'
import { deferred, failures, MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

const STAMP = '2026-09-27T00:00:00.000Z'
const value = (id: string, name: string, sortOrder: number, status: OptionValue['status'] = 'active'): OptionValue => ({ id, name, sortOrder, status })

function setOf(id: string, name: string, values: OptionValue[], overrides: Partial<OptionSet> = {}): OptionSet {
  return { id, name, status: 'active', values, itemCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

const SIZE = setOf('set-1', 'Size', [value('val-1', 'Small', 1), value('val-2', 'Regular', 2), value('val-3', 'Large', 3), value('val-4', 'Kids', 4, 'archived')], { itemCount: 4 })
const TEMP = setOf('set-2', 'Temperature', [value('val-5', 'Hot', 1), value('val-6', 'Iced', 2)])
const OLD = setOf('set-3', 'Syrup (old)', [value('val-7', 'Vanilla', 1)], { status: 'archived', version: 3 })
const MILK = setOf('set-5', 'Milk', ['Whole', 'Skim', 'Oat', 'Soy', 'Almond', 'Coconut', 'Oat barista'].map((name, i) => value(`milk-${i}`, name, i + 1)), { itemCount: 1 })

async function open(sets: OptionSet[] = [SIZE, TEMP, OLD], extra: Parameters<typeof mockApi>[1] = {}, path = '/options') {
  const page = await createPage()
  const api = await mockApi(page, { 'GET /admin/menu/option-sets': () => sets, ...extra })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))
const visible = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true })
const chips = (page: Page, name: string) => card(page, name).getByRole('list', { name: `Values of ${name}` }).getByRole('listitem').filter({ visible: true }).allInnerTexts()

async function openEditor(page: Page, name: string) {
  await visible(page, `Edit ${name}`).or(visible(page, `View ${name}`)).click()
  const editor = page.getByRole('dialog')
  await editor.getByText('Changes save automatically').waitFor()
  return editor
}

/** The editor's active values, in order. */
const editorValues = (editor: ReturnType<Page['getByRole']>) => editor.getByRole('list', { name: /Values|Reorder values/ }).getByRole('listitem').evaluateAll(items => items.map(i => i.getAttribute('aria-label')))
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))

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

/** The reorder endpoint: puts the active values in the order sent. */
const reordered = (set: OptionSet, body: Record<string, unknown>) => ({
  values: (body.valueIds as string[]).map((id, i) => ({ ...set.values.find(v => v.id === id)!, sortOrder: i + 1 })).concat(set.values.filter(v => v.status === 'archived')),
})

describe('options library', () => {
  it('shows each active set with its values in order, value counts and what uses it', async () => {
    const { page } = await open()
    await page.getByRole('heading', { name: 'Options', exact: true }).waitFor()
    await page.getByText('Create reusable choices like Size and Temperature. Options create menu-item versions; prices are configured on each menu item.').waitFor()
    await card(page, 'Size').getByText('Used by 4 menu items').waitFor()
    await card(page, 'Size').getByText('3 values · 1 archived').waitFor()
    expect(await chips(page, 'Size')).toEqual(['Small', 'Regular', 'Large'])
    await card(page, 'Temperature').getByText('Unused').waitFor()
    // Active is the default view; the Active badge isn't repeated on cards.
    expect(await card(page, 'Syrup (old)').count()).toBe(0)
    expect(await card(page, 'Size').getByText('Active', { exact: true }).count()).toBe(0)
    expect(page.url()).not.toContain('status=')

    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Syrup (old)').getByText('Archived', { exact: true }).waitFor()
    await visible(page, 'View Syrup (old)').waitFor()
    await expect.poll(() => page.url()).toContain('status=archived')
  })

  it('searches set names and value names, and says which values matched', async () => {
    const { page } = await open([SIZE, TEMP, OLD, MILK])
    await page.getByPlaceholder('Search sets or values…').fill('oat')
    await card(page, 'Milk').getByText('Matches: Oat, Oat barista').waitFor()
    expect(await card(page, 'Size').count()).toBe(0)
    expect(await page.getByRole('tab', { name: /All/ }).innerText()).toContain('1')

    await page.getByPlaceholder('Search sets or values…').fill('size')
    await card(page, 'Size').waitFor()
    expect(await card(page, 'Size').getByText(/Matches/).count()).toBe(0)
    expect(await card(page, 'Milk').count()).toBe(0)
    await expect.poll(() => page.url()).toContain('search=size')

    // Archived values don't match ("Kids" is an archived value of Size).
    await page.getByPlaceholder('Search sets or values…').fill('kids')
    await page.getByText('No option sets match your filters').waitFor()
    // The counts follow the search: "Vanilla" is in an archived set.
    await page.getByPlaceholder('Search sets or values…').fill('vanilla')
    await expect.poll(() => page.getByRole('tab', { name: /Archived/ }).innerText()).toContain('1')
    await page.getByText('No option sets match your filters').waitFor()
  })

  it('shows 5 value chips on wide screens and 3 on phones, then "+N more"', async () => {
    const { page } = await open([MILK])
    await expect.poll(() => chips(page, 'Milk')).toEqual(['Whole', 'Skim', 'Oat', 'Soy', 'Almond'])
    await card(page, 'Milk').getByText('+2 more').waitFor()
    await page.setViewportSize({ width: 375, height: 812 })
    await expect.poll(() => chips(page, 'Milk')).toEqual(['Whole', 'Skim', 'Oat'])
    await card(page, 'Milk').getByText('+4 more').waitFor()
  })

  it('offers only Archive (or Restore) in the card menu, never Delete', async () => {
    const archive = answering(SIZE, () => ({ status: 'archived' }))
    const restore = answering(OLD, () => ({ status: 'active' }))
    const { page } = await open(undefined, {
      'POST /admin/menu/option-sets/{id}/archive': archive.handler,
      'POST /admin/menu/option-sets/{id}/restore': restore.handler,
    })
    await page.getByRole('button', { name: 'Actions for Size' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Archive'])
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('4 menu items use this set and will keep it, but it cannot be added to other items until restored.').waitFor()
    await page.getByRole('button', { name: 'Archive option set' }).click()
    await toast(page, 'Option set "Size" archived').waitFor()
    expect(archive.bodies).toEqual([{ version: 1 }])

    await page.getByRole('tab', { name: /Archived/ }).click()
    await page.getByRole('button', { name: 'Actions for Syrup (old)' }).click()
    expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Restore'])
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    await toast(page, 'Option set "Syrup (old)" restored').waitFor()
    expect(restore.bodies).toEqual([{ version: 3 }])
    expect(await page.getByText('Delete', { exact: true }).count()).toBe(0)
  })

  it('on phones: fits the screen, and the editor fills it', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page, { 'GET /admin/menu/option-sets': () => [SIZE] })
    await page.goto(url('/options'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'New option set' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await visible(page, 'Edit Size').click()
    const editor = page.getByRole('dialog')
    await editor.getByText('Changes save automatically').waitFor()
    // Full screen.
    await expect.poll(async () => Math.round((await editor.boundingBox())!.width)).toBe(375)
  })
})

describe('new option set', () => {
  it('creates a set with its values in the chosen order, then opens it in the editor', async () => {
    const created: unknown[] = []
    const { page } = await open([], {
      'POST /admin/menu/option-sets': ({ body }) => {
        created.push(body)
        return setOf('set-9', 'Milk', [value('val-91', 'Whole', 1), value('val-92', 'Soy', 2), value('val-93', 'Oat', 3)])
      },
    })
    await page.getByRole('button', { name: 'New option set' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByText('Examples: Size, Temperature, Serving style').waitFor()
    await form.getByLabel('Name', { exact: true }).fill('Milk')
    await form.getByLabel('Value 1', { exact: true }).fill('Whole')
    await form.getByLabel('Value 2', { exact: true }).fill('Oat')
    await form.getByLabel('Value 2', { exact: true }).press('Enter')
    await form.getByLabel('Value 3', { exact: true }).fill(' Soy ')
    expect(await form.getByRole('button', { name: 'Move value 1 up' }).isDisabled()).toBe(true)
    expect(await form.getByRole('button', { name: 'Move value 3 down' }).isDisabled()).toBe(true)
    await form.getByRole('button', { name: 'Move value 3 up' }).click()
    await expect.poll(() => focused(page)).toBe('Move value 2 up')
    await form.getByRole('button', { name: 'Create' }).click()
    await toast(page, 'Option set "Milk" created').waitFor()
    expect(created).toEqual([{ name: 'Milk', values: ['Whole', 'Soy', 'Oat'] }])
    await page.getByRole('dialog').getByText('Changes save automatically').waitFor()
  })

  it('refuses a value listed twice before sending anything', async () => {
    const { page, api } = await open([])
    await page.getByRole('button', { name: 'New option set' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name', { exact: true }).fill('Size')
    await form.getByLabel('Value 1', { exact: true }).fill('Small')
    await form.getByLabel('Value 2', { exact: true }).fill('small')
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Each value can be listed only once').waitFor()
    expect(writes(api.calls)).toEqual([])
  })

  it('is full screen on phones', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page, { 'GET /admin/menu/option-sets': () => [] })
    await page.goto(url('/options'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'New option set' }).first().click()
    await expect.poll(async () => Math.round((await page.getByRole('dialog').boundingBox())!.width)).toBe(375)
  })
})

describe('option set editor', () => {
  it('saves each change with the version of the previous answer, and says it saved', async () => {
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
    await editor.getByText('Used by 4 menu items').waitFor()

    // The name is read-only until Edit.
    await editor.getByRole('button', { name: 'Edit name' }).click()
    await editor.getByLabel('Option set name').fill('Cup size')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await toast(page, 'Renamed to "Cup size"').waitFor()
    await editor.getByText('Saved', { exact: true }).waitFor()
    expect(await editor.getByLabel('Option set name').count()).toBe(0)

    // Add value stays open for the next one.
    await editor.getByRole('button', { name: 'Add value' }).click()
    await editor.getByLabel('New value').fill('Extra large')
    await editor.getByLabel('New value').press('Enter')
    await toast(page, '"Extra large" added').waitFor()
    await expect.poll(() => editor.getByLabel('New value').inputValue()).toBe('')
    await editor.getByRole('button', { name: 'Cancel' }).click()

    await editor.getByRole('button', { name: 'Actions for Regular' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await editor.getByLabel('Name of Regular').fill('Medium')
    await editor.getByLabel('Name of Regular').press('Enter')
    await toast(page, 'Renamed to "Medium"').waitFor()

    await editor.getByRole('button', { name: 'Actions for Small' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await page.getByText('Menu-item versions that use this value will be hidden until it is restored.').waitFor()
    await page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Archive “Small”?' })).getByRole('button', { name: 'Archive value' }).click()
    await toast(page, '"Small" archived').waitFor()

    await editor.getByRole('button', { name: 'Archived values (2)' }).click()
    await editor.getByRole('button', { name: 'Restore Kids' }).click()
    await toast(page, '"Kids" restored').waitFor()

    expect(bodies).toEqual([
      { call: 'rename', body: { version: 1, name: 'Cup size' } },
      { call: 'add', body: { version: 2, name: 'Extra large' } },
      { call: 'rename value', body: { version: 3, name: 'Medium' } },
      { call: 'archive value', body: { version: 4 } },
      { call: 'restore value', body: { version: 5 } },
    ])
  })

  it('Escape cancels only the inline edit, and the archived-values list starts collapsed', async () => {
    const { page, api } = await open([SIZE])
    const editor = await openEditor(page, 'Size')
    expect(await editor.getByRole('button', { name: 'Archived values (1)' }).getAttribute('aria-expanded')).toBe('false')
    await editor.getByRole('button', { name: 'Edit name' }).click()
    await editor.getByLabel('Option set name').fill('Cup size')
    await editor.getByLabel('Option set name').press('Escape')
    await expect.poll(() => editor.getByLabel('Option set name').count()).toBe(0)
    // The editor stays open and usable (a closing one would still show during its animation, so
    // keep using it), and the draft was dropped.
    expect(await page.getByText('Discard unsaved changes?').count()).toBe(0)
    await editor.getByRole('button', { name: 'Edit name' }).click()
    expect(await editor.getByLabel('Option set name').inputValue()).toBe('Size')
    await editor.getByLabel('Option set name').press('Escape')
    await editor.getByRole('button', { name: 'Archived values (1)' }).click()
    await editor.getByRole('button', { name: 'Restore Kids' }).waitFor()
    expect(await editor.getAttribute('data-state')).toBe('open')
    // A second Escape closes the editor (nothing typed is left).
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    expect(writes(api.calls)).toEqual([])
  })

  it('won\'t archive the last active value, and says why', async () => {
    const one = setOf('set-4', 'Cup', [value('val-9', 'One size', 1)])
    const { page } = await open([one])
    const editor = await openEditor(page, 'Cup')
    await editor.getByRole('button', { name: 'Actions for One size' }).click()
    const archive = page.getByRole('menuitem', { name: /Archive/ })
    expect(await archive.getAttribute('aria-disabled')).toBe('true')
    await archive.getByText('An option set needs at least one active value.').waitFor()
  })

  it('stops adding and restoring at 20 active values, saying why', async () => {
    const values = Array.from({ length: 20 }, (_, i) => value(`v-${i}`, `Value ${i + 1}`, i + 1)).concat(value('v-old', 'Old', 21, 'archived'))
    const { page } = await open([setOf('set-6', 'Big', values)])
    const editor = await openEditor(page, 'Big')
    await editor.getByText('20 of 20').waitFor()
    expect(await editor.getByRole('button', { name: 'Add value' }).isDisabled()).toBe(true)
    await editor.getByText('A set can have at most 20 active values. Archive one to add another.').waitFor()
    await editor.getByRole('button', { name: 'Archived values (1)' }).click()
    expect(await editor.getByRole('button', { name: 'Restore Old' }).isDisabled()).toBe(true)
    await editor.getByText('A set can have at most 20 active values: archive one to restore another.').waitFor()
  })

  it('archives the set from the danger zone after saying what happens, then shows it read-only', async () => {
    const archive = answering(TEMP, () => ({ status: 'archived' }))
    const restore = answering({ ...TEMP, status: 'archived', version: 2 }, () => ({ status: 'active' }))
    const { page } = await open([TEMP], {
      'POST /admin/menu/option-sets/{id}/archive': archive.handler,
      'POST /admin/menu/option-sets/{id}/restore': restore.handler,
    })
    const editor = await openEditor(page, 'Temperature')
    await editor.getByText('Danger zone').waitFor()
    await editor.getByText('Existing menu items keep this set, but it cannot be added to other items until restored.').waitFor()
    await editor.getByRole('button', { name: 'Archive option set' }).click()
    await page.getByText('This set cannot be added to menu items until restored.').waitFor()
    await page.getByRole('button', { name: 'Archive option set' }).last().click()
    await editor.getByText('This option set is archived. Existing menu items keep it, but it cannot be added to other items.').waitFor()
    expect(await editor.getByRole('button', { name: 'Edit name' }).count()).toBe(0)
    expect(await editor.getByRole('button', { name: 'Add value' }).count()).toBe(0)
    expect(await editor.getByRole('button', { name: 'Reorder' }).count()).toBe(0)
    expect(await editor.getByRole('button', { name: /Actions for/ }).count()).toBe(0)
    expect(await editor.getByText('Danger zone').count()).toBe(0)

    await editor.getByRole('button', { name: 'Restore option set' }).click()
    await editor.getByText('Danger zone').waitFor()
    expect(archive.bodies).toEqual([{ version: 1 }])
    expect(restore.bodies).toEqual([{ version: 2 }])
  })

  it('opens an archived set read-only, with Restore', async () => {
    const { page } = await open([OLD], {}, '/options?status=archived')
    const editor = await openEditor(page, 'Syrup (old)')
    await editor.getByText('Archived', { exact: true }).waitFor()
    await editor.getByRole('button', { name: 'Restore option set' }).waitFor()
    expect(await editor.getByRole('button', { name: 'Edit name' }).count()).toBe(0)
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
    await editor.getByRole('button', { name: 'Add value' }).click()
    await editor.getByLabel('New value').fill('Extra large')
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await editor.getByText('Someone else changed this option set').waitFor()
    await editor.getByText('Couldn\'t save').waitFor()
    await editor.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => editor.getByText('Someone else changed this option set').count()).toBe(0)
    await editor.getByText('Cup size', { exact: true }).first().waitFor()
    // The typed value is still there.
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await toast(page, '"Extra large" added').waitFor()
    expect(bodies).toEqual([{ version: 1, name: 'Extra large' }, { version: 7, name: 'Extra large' }])
  })

  it('shows a refused change inside the editor too, where toasts can\'t be reached', async () => {
    const { page } = await open([SIZE], {
      'POST /admin/menu/option-sets/{id}/values': () => {
        throw new MockFailure(409, 'OPTION_VALUE_NAME_TAKEN', 'This set already has a value named "small".')
      },
    })
    const editor = await openEditor(page, 'Size')
    await editor.getByRole('button', { name: 'Add value' }).click()
    await editor.getByLabel('New value').fill('small')
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await editor.getByText('That change wasn\'t saved').waitFor()
    await editor.getByText('This set already has a value named "small".').waitFor()
    await expect.poll(() => editor.getByLabel('New value').inputValue()).toBe('small')
  })

  it('asks before closing with typed but unsaved text', async () => {
    const { page } = await open([SIZE])
    const editor = await openEditor(page, 'Size')
    await editor.getByRole('button', { name: 'Add value' }).click()
    await editor.getByLabel('New value').fill('Extra large')
    await editor.getByRole('button', { name: 'Close' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })
})

describe('reordering values', () => {
  it('moves with the arrow buttons, keeps focus, announces, and saves once after the moves', async () => {
    const order = answering(SIZE, reordered)
    const { page } = await open([SIZE], { 'PUT /admin/menu/option-sets/{id}/values/order': order.handler })
    const editor = await openEditor(page, 'Size')
    await editor.getByRole('button', { name: 'Reorder' }).click()
    await editor.getByText('Drag values or use the arrow buttons. Every move saves automatically.').waitFor()
    expect(await editor.getByRole('button', { name: 'Move Small up' }).isDisabled()).toBe(true)
    expect(await editor.getByRole('button', { name: 'Move Large down' }).isDisabled()).toBe(true)
    // No other editing while reordering.
    expect(await editor.getByRole('button', { name: /Actions for/ }).count()).toBe(0)
    expect(await editor.getByRole('button', { name: 'Add value' }).count()).toBe(0)

    await editor.getByRole('button', { name: 'Move Small down' }).click()
    await editor.getByRole('button', { name: 'Move Small down' }).click()
    expect(await editorValues(editor)).toEqual(['Regular', 'Large', 'Small'])
    // At the bottom its Move down is disabled: focus moves to Move up on the same row.
    await expect.poll(() => focused(page)).toBe('Move Small up')
    await expect.poll(() => editor.locator('[aria-live="polite"]').innerText()).toBe('Small moved to position 3')
    await expect.poll(() => editor.getByRole('listitem', { name: 'Small' }).getAttribute('class')).toContain('bg-primary')

    await expect.poll(() => order.bodies).toEqual([{ version: 1, valueIds: ['val-2', 'val-3', 'val-1'] }])
    await editor.getByText('Saved', { exact: true }).waitFor()
    expect(order.bodies).toHaveLength(1)

    await editor.getByRole('button', { name: 'Done reordering' }).click()
    await editor.getByRole('button', { name: 'Reorder' }).waitFor()
    expect(await editorValues(editor)).toEqual(['Regular', 'Large', 'Small'])
  })

  it('moves with ↑/↓ on the drag handle and by dragging, sending every active value with the latest version', async () => {
    const order = answering(SIZE, reordered)
    const { page } = await open([SIZE], { 'PUT /admin/menu/option-sets/{id}/values/order': order.handler })
    const editor = await openEditor(page, 'Size')
    await editor.getByRole('button', { name: 'Reorder' }).click()
    await editor.getByRole('button', { name: /Reorder Large/ }).focus()
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => focused(page)).toBe('Reorder Large (drag, or press up or down)')
    await expect.poll(() => order.bodies).toEqual([{ version: 1, valueIds: ['val-1', 'val-3', 'val-2'] }])

    await editor.getByRole('button', { name: /Reorder Regular/ }).dragTo(editor.getByRole('button', { name: /Reorder Small/ }))
    await expect.poll(() => order.bodies.length).toBe(2)
    expect(order.bodies[1]).toEqual({ version: 2, valueIds: ['val-2', 'val-1', 'val-3'] })
    expect(await editorValues(editor)).toEqual(['Regular', 'Small', 'Large'])
  })

  it('puts back the saved order after a refused save and stays in reorder mode, with Reload for a conflict', async () => {
    const put = deferred()
    const fresh = { ...SIZE, version: 5 }
    const { page } = await open([SIZE], {
      'PUT /admin/menu/option-sets/{id}/values/order': put.handler,
      'GET /admin/menu/option-sets/{id}': () => fresh,
    })
    const editor = await openEditor(page, 'Size')
    await editor.getByRole('button', { name: 'Reorder' }).click()
    await editor.getByRole('button', { name: 'Move Large up' }).click()
    await put.started()
    await editor.getByText('Saving…').waitFor()
    put.fail(failures.conflict('VERSION_CONFLICT', 'This option set was changed by someone else. Reload it and try again.'))
    await editor.getByText('Someone else changed this option set').waitFor()
    await expect.poll(() => editorValues(editor)).toEqual(['Small', 'Regular', 'Large'])
    await editor.getByText('Reorder values').waitFor()

    await editor.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => editor.getByText('Someone else changed this option set').count()).toBe(0)
    await editor.getByRole('button', { name: 'Move Large up' }).click()
    await put.started(2)
    put.release({ ...fresh, version: 6 })
    await editor.getByText('Saved', { exact: true }).waitFor()
  })

  it('shows another refused save in the editor and keeps the mode', async () => {
    const { page } = await open([SIZE], {
      'PUT /admin/menu/option-sets/{id}/values/order': () => {
        throw new MockFailure(422, 'VALIDATION_FAILED', 'List every active value once.')
      },
    })
    const editor = await openEditor(page, 'Size')
    await editor.getByRole('button', { name: 'Reorder' }).click()
    await editor.getByRole('button', { name: 'Move Small down' }).click()
    await editor.getByText('List every active value once.').waitFor()
    await expect.poll(() => editorValues(editor)).toEqual(['Small', 'Regular', 'Large'])
    expect(await editor.getByRole('button', { name: 'Reload' }).count()).toBe(0)
    await editor.getByText('Reorder values').waitFor()
  })

  it('on phones: a full-width Done reordering at the bottom', async () => {
    const order = answering(SIZE, reordered)
    const page = await createPage()
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page, { 'GET /admin/menu/option-sets': () => [SIZE], 'PUT /admin/menu/option-sets/{id}/values/order': order.handler })
    await page.goto(url('/options'), { waitUntil: 'hydration' })
    await visible(page, 'Edit Size').click()
    const editor = page.getByRole('dialog')
    await editor.getByRole('button', { name: 'Reorder' }).click()
    const done = visible(page, 'Done reordering')
    const box = (await done.boundingBox())!
    expect(box.width).toBeGreaterThan(300)
    expect(box.y + box.height).toBeGreaterThan(812 - 40)
    await editor.getByRole('button', { name: 'Move Small down' }).click()
    await done.click()
    await expect.poll(() => order.bodies).toEqual([{ version: 1, valueIds: ['val-2', 'val-1', 'val-3'] }])
    await editor.getByRole('button', { name: 'Reorder' }).waitFor()
  })
})
