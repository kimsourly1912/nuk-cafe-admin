import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ItemModifierGroupsInput, MenuItem } from '#shared/contracts/menu-items'
import { createItemSchema } from '#shared/contracts/menu-items'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { Actor } from '../../identity'
import { createCategory } from '../categories.service'
import { archiveItem, createItem, getItem, updateItem } from '../items.service'
import { menuModifierGroups, menuModifiers } from '../menu.schema'
import { archiveModifier, archiveModifierGroup, createModifierGroup, getModifierGroup, listModifierGroups, restoreModifier, updateModifier } from '../modifiers.service'
import { createTestDb } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import { interleaved } from '../../../tests/support/interleave'
import type { Db } from '../../../utils/batch'

let db: Db
const actor: Actor = { userId: 'admin-1', role: 'admin', requestId: 'req-1' }

let hot: string
let milk: ModifierGroup
let extras: ModifierGroup

beforeEach(async () => {
  db = await createTestDb()
  const drinks = await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
  hot = (await createCategory(db, actor, { name: 'Hot drinks', description: '', parentId: drinks.id, availabilityRuleIds: [] })).id
  // Milk: choose exactly one, Whole pre-selected.
  milk = await createModifierGroup(db, actor, {
    name: 'Milk',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { name: 'Whole', priceDeltaMinor: 0, isDefault: true },
      { name: 'Oat', priceDeltaMinor: 50, isDefault: false },
      { name: 'Soy', priceDeltaMinor: 50, isDefault: false },
    ],
  })
  extras = await createModifierGroup(db, actor, {
    name: 'Extras',
    minSelect: 0,
    maxSelect: null,
    modifiers: [{ name: 'Extra shot', priceDeltaMinor: 75, isDefault: false }, { name: 'Syrup', priceDeltaMinor: 40, isDefault: false }],
  })
})

const m = (group: ModifierGroup, name: string) => group.modifiers.find(x => x.name === name)!.id
const plain = (groupId: string): ItemModifierGroupsInput[number] => ({ groupId, rules: null, prices: [] })

const latte = (modifierGroups: ItemModifierGroupsInput, database: Db = db) => createItem(database, actor, {
  categoryId: hot,
  name: 'Latte',
  description: '',
  imageId: null,
  optionSetIds: [],
  variations: [{ valueIds: [], priceMinor: 350, status: 'active' }],
  modifierGroups,
  availabilityRuleIds: [],
})

const groupOf = (item: MenuItem, name: string) => item.modifierGroups.find(g => g.name === name)!
const priceOf = (item: MenuItem, group: string, name: string) => groupOf(item, group).modifiers.find(x => x.name === name)

describe('offering add-on groups', () => {
  it('creates an item with its add-on groups in order, using the library\'s rules and prices', async () => {
    const item = await latte([plain(extras.id), plain(milk.id)])
    expect(item.modifierGroups.map(g => g.name)).toEqual(['Extras', 'Milk'])
    expect(groupOf(item, 'Milk')).toMatchObject({ minSelect: 1, maxSelect: 1, rulesOverridden: false, status: 'active' })
    expect(groupOf(item, 'Milk').modifiers.map(x => [x.name, x.priceDeltaMinor, x.isDefault, x.priceOverridden])).toEqual([
      ['Whole', 0, true, false],
      ['Oat', 50, false, false],
      ['Soy', 50, false, false],
    ])
    expect((await getItem(db, item.id)).modifierGroups).toEqual(item.modifierGroups)
  })

  it('keeps the item\'s own rules and prices, and shows the library\'s default next to them', async () => {
    const item = await latte([
      { groupId: extras.id, rules: { minSelect: 0, maxSelect: 1 }, prices: [{ modifierId: m(extras, 'Extra shot'), priceDeltaMinor: 100 }] },
    ])
    expect(groupOf(item, 'Extras')).toMatchObject({ minSelect: 0, maxSelect: 1, rulesOverridden: true })
    expect(priceOf(item, 'Extras', 'Extra shot')).toMatchObject({ priceDeltaMinor: 100, defaultPriceDeltaMinor: 75, priceOverridden: true })
    expect(priceOf(item, 'Extras', 'Syrup')).toMatchObject({ priceDeltaMinor: 40, priceOverridden: false })
  })

  it('follows library changes where the item has no price of its own', async () => {
    const item = await latte([{ groupId: extras.id, rules: null, prices: [{ modifierId: m(extras, 'Extra shot'), priceDeltaMinor: 100 }] }])
    await updateModifier(db, actor, extras.id, m(extras, 'Syrup'), { version: extras.version, priceDeltaMinor: 60 })
    const group = await getModifierGroup(db, extras.id)
    await updateModifier(db, actor, extras.id, m(extras, 'Extra shot'), { version: group.version, priceDeltaMinor: 90 })
    const now = await getItem(db, item.id)
    expect(priceOf(now, 'Extras', 'Syrup')?.priceDeltaMinor).toBe(60)
    expect(priceOf(now, 'Extras', 'Extra shot')).toMatchObject({ priceDeltaMinor: 100, defaultPriceDeltaMinor: 90 })
  })

  it('refuses a group that doesn\'t exist or is archived, naming its position', async () => {
    await archiveModifierGroup(db, actor, extras.id, { version: extras.version })
    await expectApiError(() => latte([plain(milk.id), plain(extras.id)]), 422, 'MODIFIER_GROUP_NOT_AVAILABLE', ['modifierGroups.1.groupId'])
    await expectApiError(() => latte([plain('0190a000-0000-7000-8000-000000000000')]), 422, 'MODIFIER_GROUP_NOT_AVAILABLE')
  })

  it('refuses own rules the group\'s add-ons can\'t meet', async () => {
    // Milk has three active add-ons; one is a default.
    await expectApiError(() => latte([{ groupId: milk.id, rules: { minSelect: 4, maxSelect: null }, prices: [] }]), 422, 'ITEM_SELECTION_RULES', ['modifierGroups.0.rules.minSelect'])
    await expectApiError(() => latte([{ groupId: milk.id, rules: { minSelect: 2, maxSelect: 1 }, prices: [] }]), 422, 'ITEM_SELECTION_RULES', ['modifierGroups.0.rules.maxSelect'])
    // Optional on this item, and at most two.
    const item = await latte([{ groupId: milk.id, rules: { minSelect: 0, maxSelect: 2 }, prices: [] }])
    expect(groupOf(item, 'Milk')).toMatchObject({ minSelect: 0, maxSelect: 2, rulesOverridden: true })
  })

  it('refuses a price for an add-on of another group, or an archived one', async () => {
    await expectApiError(() => latte([{ groupId: milk.id, rules: null, prices: [{ modifierId: m(extras, 'Syrup'), priceDeltaMinor: 10 }] }]), 422, 'MODIFIER_NOT_AVAILABLE', ['modifierGroups.0.prices.0.modifierId'])
    await archiveModifier(db, actor, milk.id, m(milk, 'Soy'), { version: milk.version })
    await expectApiError(() => latte([{ groupId: milk.id, rules: null, prices: [{ modifierId: m(milk, 'Soy'), priceDeltaMinor: 10 }] }]), 422, 'MODIFIER_NOT_AVAILABLE')
  })

  it('checks the list\'s shape in the contract: each group once, one price per add-on, at most 10 groups', () => {
    const base = { categoryId: hot, name: 'Latte', variations: [{ valueIds: [], priceMinor: 350, status: 'active' }] }
    expect(v.safeParse(createItemSchema, { ...base, modifierGroups: [plain(milk.id), plain(milk.id)] }).success).toBe(false)
    expect(v.safeParse(createItemSchema, { ...base, modifierGroups: [{ groupId: milk.id, prices: [{ modifierId: m(milk, 'Oat'), priceDeltaMinor: 1 }, { modifierId: m(milk, 'Oat'), priceDeltaMinor: 2 }] }] }).success).toBe(false)
    expect(v.safeParse(createItemSchema, { ...base, modifierGroups: Array.from({ length: 11 }, (_, i) => plain(`0190a000-0000-7000-8000-00000000000${i % 10}`)) }).success).toBe(false)
    expect(v.safeParse(createItemSchema, { ...base, modifierGroups: [{ groupId: milk.id, prices: [{ modifierId: m(milk, 'Oat'), priceDeltaMinor: -1 }] }] }).success).toBe(false)
    const parsed = v.parse(createItemSchema, { ...base, modifierGroups: [{ groupId: milk.id }] })
    expect(parsed.modifierGroups).toEqual([{ groupId: milk.id, rules: null, prices: [] }])
    expect(v.parse(createItemSchema, base).modifierGroups).toEqual([])
  })
})

describe('changing an item\'s add-ons', () => {
  it('replaces the whole list when sent, and keeps it when not', async () => {
    const item = await latte([plain(milk.id), { groupId: extras.id, rules: null, prices: [{ modifierId: m(extras, 'Syrup'), priceDeltaMinor: 10 }] }])
    const renamed = await updateItem(db, actor, item.id, { version: item.version, name: 'Caffè latte' })
    expect(renamed.modifierGroups).toEqual(item.modifierGroups)
    const swapped = await updateItem(db, actor, item.id, { version: renamed.version, modifierGroups: [plain(extras.id)] })
    expect(swapped.modifierGroups.map(g => g.name)).toEqual(['Extras'])
    expect(priceOf(swapped, 'Extras', 'Syrup')).toMatchObject({ priceDeltaMinor: 40, priceOverridden: false })
    const none = await updateItem(db, actor, item.id, { version: swapped.version, modifierGroups: [] })
    expect(none.modifierGroups).toEqual([])
  })

  it('keeps a group archived in the library on the items that offer it, but won\'t add it anywhere new', async () => {
    const item = await latte([plain(milk.id)])
    await archiveModifierGroup(db, actor, milk.id, { version: milk.version })
    const kept = await getItem(db, item.id)
    expect(groupOf(kept, 'Milk').status).toBe('archived')
    // The form sends back what it read.
    await expect(updateItem(db, actor, item.id, { version: kept.version, modifierGroups: [plain(milk.id), plain(extras.id)] })).resolves.toMatchObject({ version: 2 })
    const other = await createItem(db, actor, { categoryId: hot, name: 'Mocha', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 400, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    await expectApiError(() => updateItem(db, actor, other.id, { version: 1, modifierGroups: [plain(milk.id)] }), 422, 'MODIFIER_GROUP_NOT_AVAILABLE')
  })

  it('keeps the item\'s price for an add-on archived in the library, shown after the active ones, and brings it back on restore', async () => {
    const item = await latte([{ groupId: milk.id, rules: null, prices: [{ modifierId: m(milk, 'Oat'), priceDeltaMinor: 70 }] }])
    const archived = await archiveModifier(db, actor, milk.id, m(milk, 'Oat'), { version: milk.version })
    await archiveModifier(db, actor, milk.id, m(milk, 'Soy'), { version: archived.version })
    const now = await getItem(db, item.id)
    // Soy (archived, no price of its own) is gone; Oat (archived, priced) stays last.
    expect(groupOf(now, 'Milk').modifiers.map(x => [x.name, x.status])).toEqual([['Whole', 'active'], ['Oat', 'archived']])
    await expect(updateItem(db, actor, item.id, { version: now.version, modifierGroups: [{ groupId: milk.id, rules: null, prices: [{ modifierId: m(milk, 'Oat'), priceDeltaMinor: 80 }] }] })).resolves.toMatchObject({ version: 2 })
    const group = await getModifierGroup(db, milk.id)
    await restoreModifier(db, actor, milk.id, m(milk, 'Oat'), { version: group.version })
    expect(priceOf(await getItem(db, item.id), 'Milk', 'Oat')).toMatchObject({ status: 'active', priceDeltaMinor: 80 })
  })

  it('refuses a stale version', async () => {
    const item = await latte([])
    await updateItem(db, actor, item.id, { version: 1, modifierGroups: [plain(milk.id)] })
    await expectApiError(() => updateItem(db, actor, item.id, { version: 1, modifierGroups: [plain(extras.id)] }), 409, 'VERSION_CONFLICT')
  })
})

describe('races with the library', () => {
  it('refuses a group archived between the check and the write, on create and on update', async () => {
    const archiving = () => db.update(menuModifierGroups).set({ status: 'archived' }).where(eq(menuModifierGroups.id, extras.id))
    await expectApiError(() => latte([plain(milk.id), plain(extras.id)], interleaved(db, archiving)), 422, 'MODIFIER_GROUP_NOT_AVAILABLE', ['modifierGroups.1.groupId'])
    await db.update(menuModifierGroups).set({ status: 'active' }).where(eq(menuModifierGroups.id, extras.id))
    const item = await latte([plain(milk.id)])
    await expectApiError(() => updateItem(interleaved(db, archiving), actor, item.id, { version: 1, modifierGroups: [plain(milk.id), plain(extras.id)] }), 422, 'MODIFIER_GROUP_NOT_AVAILABLE')
    expect((await getItem(db, item.id)).modifierGroups.map(g => g.name)).toEqual(['Milk'])
  })

  it('refuses a new price for an add-on archived between the check and the write', async () => {
    const archiving = () => db.update(menuModifiers).set({ status: 'archived' }).where(eq(menuModifiers.id, m(extras, 'Syrup')))
    await expectApiError(
      () => latte([{ groupId: extras.id, rules: null, prices: [{ modifierId: m(extras, 'Syrup'), priceDeltaMinor: 10 }] }], interleaved(db, archiving)),
      422,
      'MODIFIER_NOT_AVAILABLE',
      ['modifierGroups.0.prices.0.modifierId'],
    )
  })
})

describe('"used by N items" in the library', () => {
  it('counts drafts and active items that offer the group, not archived ones', async () => {
    const item = await latte([plain(milk.id)])
    await createItem(db, actor, { categoryId: hot, name: 'Mocha', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 400, status: 'active' }], modifierGroups: [plain(milk.id), plain(extras.id)], availabilityRuleIds: [] })
    expect((await getModifierGroup(db, milk.id)).itemCount).toBe(2)
    await archiveItem(db, actor, item.id, { version: item.version })
    const listed = await listModifierGroups(db, { status: 'active' })
    expect(listed.map(g => [g.name, g.itemCount])).toEqual([['Extras', 1], ['Milk', 1]])
  })
})
