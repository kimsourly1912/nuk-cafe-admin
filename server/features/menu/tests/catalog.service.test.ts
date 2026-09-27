import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateItemInput, MenuItem } from '#shared/contracts/menu-items'
import type { OptionSet } from '#shared/contracts/menu-options'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { organization } from '../../../db/tables'
import type { Actor, BranchActor } from '../../identity'
import { mediaAssets } from '../../media/media.schema'
import { archiveAvailabilityRule, createAvailabilityRule } from '../availability.service'
import { getPublicMenu } from '../catalog.service'
import { archiveCategory, createCategory, updateCategory } from '../categories.service'
import { archiveItem, createItem, publishItem, restoreItem, updateItem } from '../items.service'
import { archiveModifier, archiveModifierGroup, createModifierGroup } from '../modifiers.service'
import { archiveOptionValue, createOptionSet } from '../options.service'
import { setSoldOut } from '../soldout.service'
import { createTestDb } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import type { Db } from '../../../utils/batch'
import { newId } from '../../../utils/ids'

let db: Db
const admin: Actor = { userId: 'admin-1', role: 'admin' }
let branchId: string
let otherBranch: string
let drinks: string
let hot: string
let size: OptionSet

async function addBranch(status = 'active') {
  const id = newId()
  await db.insert(organization).values({ id, name: `Branch ${id.slice(-4)}`, slug: id, timezone: 'Asia/Phnom_Penh', status, createdAt: new Date() })
  return id
}

beforeEach(async () => {
  db = await createTestDb()
  branchId = await addBranch()
  otherBranch = await addBranch()
  drinks = (await createCategory(db, admin, { name: 'Drinks', description: 'All day', parentId: null, availabilityRuleIds: [] })).id
  hot = (await createCategory(db, admin, { name: 'Hot', description: '', parentId: drinks, availabilityRuleIds: [] })).id
  size = await createOptionSet(db, admin, { name: 'Size', values: ['Small', 'Large'] })
})

const v = (set: OptionSet, name: string) => set.values.find(x => x.name === name)!.id

/** A published item (single $2.50 version unless given option sets and a grid). */
async function published(name: string, overrides: Partial<CreateItemInput> = {}): Promise<MenuItem> {
  const draft = await createItem(db, admin, {
    categoryId: hot,
    name,
    description: '',
    imageId: null,
    optionSetIds: [],
    variations: [{ valueIds: [], priceMinor: 250, status: 'active' }],
    modifierGroups: [],
    availabilityRuleIds: [],
    ...overrides,
  })
  return publishItem(db, admin, draft.id, { version: draft.version })
}
const latte = () => published('Latte', {
  optionSetIds: [size.id],
  variations: [{ valueIds: [v(size, 'Small')], priceMinor: 300, status: 'active' }, { valueIds: [v(size, 'Large')], priceMinor: 400, status: 'active' }],
})

/** Monday 2026-09-28, local time in Phnom Penh (UTC+7). */
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
const menu = (at = monday('09:00'), branch = branchId) => getPublicMenu(db, { branchId: branch }, at)
const items = (m: PublicMenu) => m.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)])
const names = (m: PublicMenu) => items(m).map(i => i.name)
const staffAt = (id: string): BranchActor => ({ userId: 'staff-1', role: 'customer', branchId: id, branchRole: 'staff' })

describe('the public menu', () => {
  it('lists active categories and items with their versions, option sets, add-ons and image', async () => {
    const image = newId()
    await db.insert(mediaAssets).values({ id: image, objectKey: `menu/${image}.png`, mimeType: 'image/png', byteSize: 10, sha256: 'x' })
    const milk = await createModifierGroup(db, admin, { name: 'Milk', minSelect: 0, maxSelect: 1, modifiers: [{ name: 'Whole', priceDeltaMinor: 0, isDefault: true }, { name: 'Oat', priceDeltaMinor: 50, isDefault: false }] })
    const oat = milk.modifiers.find(m => m.name === 'Oat')!.id
    await published('Latte', {
      imageId: image,
      optionSetIds: [size.id],
      variations: [{ valueIds: [v(size, 'Small')], priceMinor: 300, status: 'active' }, { valueIds: [v(size, 'Large')], priceMinor: 400, status: 'active' }],
      modifierGroups: [{ groupId: milk.id, rules: { minSelect: 1, maxSelect: 1 }, prices: [{ modifierId: oat, priceDeltaMinor: 75 }] }],
    })

    const result = await menu()
    expect(result).toMatchObject({ branch: { id: branchId }, currency: 'USD', at: '2026-09-28T02:00:00.000Z' })
    expect(result.categories).toMatchObject([{ name: 'Drinks', description: 'All day', items: [], categories: [{ name: 'Hot' }] }])
    const [shown] = items(result)
    expect(shown).toEqual({
      id: expect.any(String),
      name: 'Latte',
      description: '',
      imageUrl: `/media/menu/${image}.png`,
      optionSets: [{ id: size.id, name: 'Size', values: [{ id: v(size, 'Small'), name: 'Small' }, { id: v(size, 'Large'), name: 'Large' }] }],
      variations: [
        { id: expect.any(String), valueIds: [v(size, 'Small')], label: 'Small', priceMinor: 300 },
        { id: expect.any(String), valueIds: [v(size, 'Large')], label: 'Large', priceMinor: 400 },
      ],
      modifierGroups: [{ id: milk.id, name: 'Milk', minSelect: 1, maxSelect: 1, modifiers: [
        { id: expect.any(String), name: 'Whole', priceDeltaMinor: 0, isDefault: true },
        { id: oat, name: 'Oat', priceDeltaMinor: 75, isDefault: false },
      ] }],
    })
  })

  it('orders each version\'s values and label by the item\'s option sets', async () => {
    const temp = await createOptionSet(db, admin, { name: 'Temperature', values: ['Hot', 'Iced'] })
    await published('Latte', {
      optionSetIds: [temp.id, size.id],
      variations: [temp, size].reduce<string[][]>((rows, set) => rows.flatMap(row => set.values.map(x => [...row, x.id])), [[]])
        .map(valueIds => ({ valueIds, priceMinor: 300, status: 'active' as const })),
    })
    const [item] = items(await menu())
    const iced = item!.variations.find(x => x.valueIds.includes(v(temp, 'Iced')) && x.valueIds.includes(v(size, 'Large')))!
    expect(iced).toMatchObject({ valueIds: [v(temp, 'Iced'), v(size, 'Large')], label: 'Iced, Large' })
    expect(item!.optionSets.map(set => set.name)).toEqual(['Temperature', 'Size'])
  })

  it('leaves out drafts, archived items and archived categories', async () => {
    await published('Tea')
    await createItem(db, admin, { categoryId: hot, name: 'Draft', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 100, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    const gone = await published('Gone')
    await archiveItem(db, admin, gone.id, { version: gone.version })
    const food = await createCategory(db, admin, { name: 'Food', description: '', parentId: null, availabilityRuleIds: [] })
    const toast = await createItem(db, admin, { categoryId: food.id, name: 'Toast', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 100, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    await publishItem(db, admin, toast.id, { version: toast.version })
    expect(names(await menu())).toEqual(['Tea', 'Toast'])
    await archiveCategory(db, admin, food.id, { version: food.version })
    expect(names(await menu())).toEqual(['Tea'])
  })

  it('leaves out versions that are switched off, and those using an archived option value', async () => {
    const item = await published('Latte', {
      optionSetIds: [size.id],
      variations: [{ valueIds: [v(size, 'Small')], priceMinor: 300, status: 'active' }, { valueIds: [v(size, 'Large')], priceMinor: null, status: 'disabled' }],
    })
    expect(items(await menu())[0]!.variations.map(x => x.label)).toEqual(['Small'])
    expect(items(await menu())[0]!.optionSets[0]!.values.map(x => x.name)).toEqual(['Small'])
    await updateItem(db, admin, item.id, { version: item.version, variations: [{ valueIds: [v(size, 'Small')], priceMinor: 300, status: 'active' }, { valueIds: [v(size, 'Large')], priceMinor: 400, status: 'active' }] })
    await archiveOptionValue(db, admin, size.id, v(size, 'Small'), { version: size.version })
    expect(items(await menu())[0]!.variations.map(x => x.label)).toEqual(['Large'])
  })

  it('leaves out archived add-on groups and add-ons, capping an item\'s own minimum', async () => {
    const milk = await createModifierGroup(db, admin, { name: 'Milk', minSelect: 0, maxSelect: null, modifiers: [{ name: 'Whole', priceDeltaMinor: 0, isDefault: false }, { name: 'Oat', priceDeltaMinor: 50, isDefault: false }] })
    const shots = await createModifierGroup(db, admin, { name: 'Shots', minSelect: 0, maxSelect: null, modifiers: [{ name: 'Extra', priceDeltaMinor: 75, isDefault: false }] })
    await published('Latte', { modifierGroups: [{ groupId: milk.id, rules: { minSelect: 2, maxSelect: null }, prices: [] }, { groupId: shots.id, rules: null, prices: [] }] })
    await archiveModifier(db, admin, milk.id, milk.modifiers[0]!.id, { version: milk.version })
    await archiveModifierGroup(db, admin, shots.id, { version: shots.version })
    expect(items(await menu())[0]!.modifierGroups).toMatchObject([{ name: 'Milk', minSelect: 1, modifiers: [{ name: 'Oat' }] }])
  })

  it('shows what\'s available at that moment in the branch\'s time zone', async () => {
    const breakfast = await createAvailabilityRule(db, admin, { name: 'Breakfast', windows: [{ weekday: 1, startMinute: 420, endMinute: 660 }] })
    await published('Eggs', { availabilityRuleIds: [breakfast.id] })
    await published('Tea')
    // 07:00 in Phnom Penh is 00:00 UTC: only the branch's clock puts it inside the window.
    expect(names(await menu(monday('07:00')))).toEqual(['Eggs', 'Tea'])
    expect(names(await menu(monday('11:00')))).toEqual(['Tea'])
    expect(names(await menu(monday('06:59')))).toEqual(['Tea'])
  })

  it('applies the category\'s and the parent\'s rules to the items', async () => {
    const mornings = await createAvailabilityRule(db, admin, { name: 'Mornings', windows: [{ weekday: 1, startMinute: 360, endMinute: 720 }] })
    await published('Tea')
    await updateCategory(db, admin, drinks, { version: 1, availabilityRuleIds: [mornings.id] })
    expect(names(await menu(monday('09:00')))).toEqual(['Tea'])
    expect((await menu(monday('13:00'))).categories).toEqual([])
  })

  it('hides items whose only rule was archived (while they were archived)', async () => {
    const rule = await createAvailabilityRule(db, admin, { name: 'Always', windows: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] })
    const tea = await published('Tea', { availabilityRuleIds: [rule.id] })
    expect(names(await menu())).toEqual(['Tea'])
    const archived = await archiveItem(db, admin, tea.id, { version: tea.version })
    await archiveAvailabilityRule(db, admin, rule.id, { version: rule.version })
    const draft = await restoreItem(db, admin, tea.id, { version: archived.version })
    await publishItem(db, admin, tea.id, { version: draft.version })
    expect(names(await menu())).toEqual([])
  })

  it('leaves out versions sold out at this branch only, and items with nothing left', async () => {
    const item = await latte()
    const tea = await published('Tea')
    await setSoldOut(db, staffAt(branchId), { variationIds: [item.variations.find(x => x.label === 'Large')!.id, tea.variations[0]!.id], soldOut: true })
    const here = items(await menu())
    expect(here.map(i => [i.name, i.variations.map(x => x.label)])).toEqual([['Latte', ['Small']]])
    expect(names(await menu(monday('09:00'), otherBranch))).toEqual(['Latte', 'Tea'])
  })

  it('is 404 for an unknown or archived branch', async () => {
    await expectApiError(() => menu(monday('09:00'), newId()), 404, 'NOT_FOUND')
    const archived = await addBranch('archived')
    await expectApiError(() => menu(monday('09:00'), archived), 404, 'NOT_FOUND')
  })
})
