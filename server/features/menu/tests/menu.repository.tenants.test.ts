import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor, BranchActor } from '#server/features/identity'
import * as availability from '#server/features/menu/availability.repository'
import { createAvailabilityRule } from '#server/features/menu/availability.service'
import * as categories from '#server/features/menu/categories.repository'
import { archiveCategory, createCategory } from '#server/features/menu/categories.service'
import * as items from '#server/features/menu/items.repository'
import { createItem, publishItem } from '#server/features/menu/items.service'
import * as modifiers from '#server/features/menu/modifiers.repository'
import { createModifierGroup } from '#server/features/menu/modifiers.service'
import * as options from '#server/features/menu/options.repository'
import { createOptionSet } from '#server/features/menu/options.service'
import * as promotions from '#server/features/menu/promotions.repository'
import { createPromotion } from '#server/features/menu/promotions.service'
import * as soldout from '#server/features/menu/soldout.repository'
import { setSoldOut } from '#server/features/menu/soldout.service'
import { createTestDb, ensureTenant, insertBranch, insertSoldLine, TEST_TENANT } from '#server/tests/support/db'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite } from '#server/utils/batch'

/**
 * The second layer of tenant isolation (repositories.md → The tenant rule, D194): every menu query
 * names the cafe itself, not only through the service's parent check. Another cafe's real menu,
 * asked for or changed with our cafe's id, is never read or touched. Each case also reads it with
 * its own cafe's id, so an empty answer can't come from a wrong fixture.
 */

const OTHER = 'tenant-2'
const owner: Actor = { userId: 'their-owner', tenantId: OTHER, role: 'owner', requestId: 'req-2' }
const NOW = new Date('2026-10-20T03:00:00Z')

let db: Db
let menu: Awaited<ReturnType<typeof theirMenu>>

/** Their cafe's menu: a published item using every library, sold out at their branch, on promotion. */
async function theirMenu() {
  await insertBranch(db, { id: 'their-branch', name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
  const rule = await createAvailabilityRule(db, owner, { name: 'Mornings', windows: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] })
  const drinks = await createCategory(db, owner, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
  const coffee = await createCategory(db, owner, { name: 'Coffee', description: '', parentId: drinks.id, availabilityRuleIds: [rule.id] })
  const tea = await createCategory(db, owner, { name: 'Tea', description: '', parentId: drinks.id, availabilityRuleIds: [] })
  await archiveCategory(db, owner, tea.id, { version: tea.version })
  const size = await createOptionSet(db, owner, { name: 'Size', values: ['Regular', 'Large'] })
  const milk = await createModifierGroup(db, owner, { name: 'Milk', minSelect: 0, maxSelect: 1, modifiers: [{ name: 'Oat', priceDeltaMinor: 50, isDefault: false }] })
  const oat = milk.modifiers[0]!
  const draft = await createItem(db, owner, {
    categoryId: coffee.id,
    name: 'Latte',
    description: '',
    imageId: null,
    optionSetIds: [size.id],
    variations: size.values.map(v => ({ valueIds: [v.id], priceMinor: 350, status: 'active' as const })),
    modifierGroups: [{ groupId: milk.id, rules: null, prices: [{ modifierId: oat.id, priceDeltaMinor: 75 }] }],
    availabilityRuleIds: [rule.id],
  })
  const item = await publishItem(db, owner, draft.id, { version: draft.version })
  const variation = item.variations[0]!
  const cashier: BranchActor = { ...owner, role: 'member', branchId: 'their-branch', branchRole: 'staff' }
  await setSoldOut(db, cashier, { variationIds: [variation.id], soldOut: true })
  const promotion = await createPromotion(db, owner, {
    name: 'Coffee week',
    description: '',
    discount: { kind: 'percent', percent: 20 },
    scope: 'selected',
    itemIds: [item.id],
    categoryIds: [coffee.id],
    branchIds: ['their-branch'],
    startsOn: '2026-10-15',
    endsOn: '2026-10-21',
    posterId: null,
    publish: true,
  }, NOW)
  return { rule, drinks, coffee, tea, size, milk, oat, item, variation, promotion }
}

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  menu = await theirMenu()
})

const run = (...statements: Statement[]) => db.batch(statements as [Statement, ...Statement[]])
const stopped = (...statements: Statement[]) => expect(run(...statements)).rejects.toSatisfy(isStaleWrite)

describe('options and add-ons: another cafe\'s with our cafe\'s id', () => {
  it('reads none of their values or add-ons', async () => {
    const { size, milk, oat } = menu
    const value = size.values[0]!
    expect(await options.valuesOf(db, TEST_TENANT, [size.id])).toEqual([])
    expect(await options.valuesOf(db, OTHER, [size.id])).toHaveLength(2)
    expect(await options.findValue(db, TEST_TENANT, size.id, value.id)).toBeUndefined()
    expect(await options.findValue(db, OTHER, size.id, value.id)).toBeDefined()
    expect(await options.nextValueOrder(db, TEST_TENANT, size.id)).toBe(1)
    expect(await options.nextValueOrder(db, OTHER, size.id)).toBe(3)
    expect(await modifiers.modifiersOf(db, TEST_TENANT, [milk.id])).toEqual([])
    expect(await modifiers.modifiersOf(db, OTHER, [milk.id])).toHaveLength(1)
    expect(await modifiers.findModifier(db, TEST_TENANT, milk.id, oat.id)).toBeUndefined()
    expect(await modifiers.findModifier(db, OTHER, milk.id, oat.id)).toBeDefined()
    expect(await modifiers.nextModifierOrder(db, TEST_TENANT, milk.id)).toBe(1)
    expect(await modifiers.nextModifierOrder(db, OTHER, milk.id)).toBe(2)
  })

  it('counts none of them in the guards, and changes none of them', async () => {
    const { size, milk, oat } = menu
    const value = size.values[0]!
    await stopped(options.requireActiveValueCount(db, TEST_TENANT, size.id, 20))
    await run(options.requireActiveValueCount(db, OTHER, size.id, 20))
    await stopped(modifiers.requireSelectionRules(db, TEST_TENANT, milk.id))
    await run(modifiers.requireSelectionRules(db, OTHER, milk.id))

    await run(options.updateValueStatement(db, TEST_TENANT, size.id, value.id, { name: 'Changed' }, NOW))
    await run(modifiers.updateModifierStatement(db, TEST_TENANT, milk.id, oat.id, { name: 'Changed' }, NOW))
    expect((await options.findValue(db, OTHER, size.id, value.id))?.name).toBe(value.name)
    expect((await modifiers.findModifier(db, OTHER, milk.id, oat.id))?.name).toBe('Oat')
  })
})

describe('categories and items: another cafe\'s with our cafe\'s id', () => {
  it('reads none of their categories\' children or items', async () => {
    const { drinks, coffee } = menu
    expect(await categories.countChildren(db, TEST_TENANT, drinks.id)).toBe(0)
    expect(await categories.countChildren(db, OTHER, drinks.id)).toBe(2)
    expect(await items.countListedItems(db, TEST_TENANT, coffee.id)).toBe(0)
    expect(await items.countListedItems(db, OTHER, coffee.id)).toBe(1)
    expect(await items.listedItemCounts(db, TEST_TENANT)).toEqual(new Map())
    expect(await items.nextItemOrder(db, TEST_TENANT, coffee.id)).toBe(1)
    expect(await items.nextItemOrder(db, OTHER, coffee.id)).toBe(2)
  })

  it('reads none of their item\'s parts', async () => {
    const { item, size, milk } = menu
    expect(await items.itemSetIds(db, TEST_TENANT, item.id)).toEqual([])
    expect(await items.itemSetIds(db, OTHER, item.id)).toEqual([size.id])
    expect(await items.variationsOf(db, TEST_TENANT, item.id)).toEqual([])
    expect(await items.variationsOf(db, OTHER, item.id)).toHaveLength(2)
    expect(await items.countSellable(db, TEST_TENANT, item.id)).toBe(0)
    expect(await items.countSellable(db, OTHER, item.id)).toBe(2)
    expect(await items.itemGroups(db, TEST_TENANT, item.id)).toEqual([])
    expect(await items.itemGroups(db, OTHER, item.id)).toHaveLength(1)
    expect(await items.itemModifierPrices(db, TEST_TENANT, item.id)).toEqual(new Map())
    expect((await items.itemModifierPrices(db, OTHER, item.id)).size).toBe(1)
    expect(await items.itemCountsBySet(db, TEST_TENANT, [size.id])).toEqual(new Map())
    expect(await items.itemCountsBySet(db, OTHER, [size.id])).toEqual(new Map([[size.id, 1]]))
    expect(await items.itemCountsByGroup(db, TEST_TENANT, [milk.id])).toEqual(new Map())
    expect(await items.itemCountsByGroup(db, OTHER, [milk.id])).toEqual(new Map([[milk.id, 1]]))
    expect(await items.setsWithValues(db, TEST_TENANT, [size.id])).toEqual([])
    expect(await items.groupsWithModifiers(db, TEST_TENANT, [milk.id])).toEqual([])
    expect((await items.listItems(db, TEST_TENANT, { page: 1, pageSize: 20 })).total).toBe(0)
    expect((await items.listItems(db, OTHER, { page: 1, pageSize: 20 })).rows).toEqual([expect.objectContaining({ id: item.id, categoryName: 'Coffee', priceMin: 350, priceMax: 350 })])
  })

  it('counts none of them in the guards', async () => {
    const { drinks, coffee, item } = menu
    await run(categories.requireNoChildren(db, TEST_TENANT, drinks.id))
    await stopped(categories.requireNoChildren(db, OTHER, drinks.id))
    await stopped(items.requireLeafCategory(db, TEST_TENANT, coffee.id))
    await run(items.requireLeafCategory(db, OTHER, coffee.id))
    await stopped(items.requireLeafCategory(db, OTHER, drinks.id))
    await stopped(items.requireSellable(db, TEST_TENANT, item.id))
    await run(items.requireSellable(db, OTHER, item.id))
    await run(items.requireListedCount(db, TEST_TENANT, coffee.id, 0))
    await run(items.requireListedCount(db, OTHER, coffee.id, 1))
  })

  it('changes none of them', async () => {
    const { drinks, coffee, tea, item, variation, size } = menu
    await run(
      categories.archiveChildrenStatement(db, TEST_TENANT, drinks.id, NOW),
      categories.restoreChildrenStatement(db, TEST_TENANT, drinks.id, NOW),
      ...items.replaceOptionSetsStatements(db, TEST_TENANT, item.id, []),
      ...items.replaceModifierGroupsStatements(db, TEST_TENANT, item.id, [], []),
      items.updateVariationStatement(db, TEST_TENANT, item.id, variation.id, { priceMinor: 1 }, NOW),
      ...items.retireVariationsStatements(db, TEST_TENANT, item.id, [variation.id], NOW),
    )
    expect((await categories.findCategory(db, OTHER, coffee.id))?.status).toBe('active')
    expect((await categories.findCategory(db, OTHER, tea.id))?.status).toBe('archived')
    expect(await items.itemSetIds(db, OTHER, item.id)).toEqual([size.id])
    expect(await items.itemGroups(db, OTHER, item.id)).toHaveLength(1)
    expect((await items.itemModifierPrices(db, OTHER, item.id)).size).toBe(1)
    expect((await items.variationsOf(db, OTHER, item.id)).find(v => v.id === variation.id)).toEqual(expect.objectContaining({ priceMinor: 350, status: 'active' }))
  })
})

describe('a permanent delete (D200): another cafe\'s with our cafe\'s id', () => {
  const theirDraft = () => createItem(db, owner, { categoryId: menu.coffee.id, name: 'Mocha', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 400, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })

  it('reads none of their items, and counts none of our orders against theirs', async () => {
    const draft = await theirDraft()
    expect(await items.findItemForDelete(db, TEST_TENANT, draft.id)).toBeUndefined()
    // Our cafe's line naming their item's id is not their history.
    await insertSoldLine(db, draft.id, TEST_TENANT)
    expect(await items.findItemForDelete(db, OTHER, draft.id)).toMatchObject({ id: draft.id, deleteBlocker: null })
    await insertSoldLine(db, draft.id, OTHER)
    expect(await items.findItemForDelete(db, OTHER, draft.id)).toMatchObject({ deleteBlocker: 'ordered' })
    expect((await items.findItemForDelete(db, OTHER, menu.item.id))?.deleteBlocker).toBe('promotion')
  })

  it('deletes none of them', async () => {
    const draft = await theirDraft()
    await run(items.deleteItemStatement(db, TEST_TENANT, draft.id, draft.version))
    expect(await items.findItem(db, OTHER, draft.id)).toBeDefined()
    await run(items.deleteItemStatement(db, OTHER, draft.id, draft.version))
    expect(await items.findItem(db, OTHER, draft.id)).toBeUndefined()
  })
})

describe('availability, sold out and promotions: another cafe\'s with our cafe\'s id', () => {
  it('reads none of their rules\' windows, uses or links', async () => {
    const { rule, coffee, item } = menu
    expect(await availability.windowsOf(db, TEST_TENANT, [rule.id])).toEqual(new Map())
    expect((await availability.windowsOf(db, OTHER, [rule.id])).get(rule.id)).toHaveLength(1)
    expect(await availability.usageCounts(db, TEST_TENANT, [rule.id])).toEqual({ items: new Map(), categories: new Map() })
    expect(await availability.usageCounts(db, OTHER, [rule.id])).toEqual({ items: new Map([[rule.id, 1]]), categories: new Map([[rule.id, 1]]) })
    expect(await availability.itemRules(db, TEST_TENANT, item.id)).toEqual([])
    expect(await availability.itemRules(db, OTHER, item.id)).toHaveLength(1)
    expect(await availability.categoryRules(db, TEST_TENANT, [coffee.id])).toEqual(new Map())
    expect((await availability.categoryRules(db, OTHER, [coffee.id])).get(coffee.id)).toHaveLength(1)
    await run(availability.requireRuleUnused(db, TEST_TENANT, rule.id))
    await stopped(availability.requireRuleUnused(db, OTHER, rule.id))
  })

  it('changes none of their rules\' windows or links', async () => {
    const { rule, coffee, item } = menu
    await run(
      ...availability.replaceWindowsStatements(db, TEST_TENANT, rule.id, []),
      ...availability.replaceItemRulesStatements(db, TEST_TENANT, item.id, []),
      ...availability.replaceCategoryRulesStatements(db, TEST_TENANT, coffee.id, []),
    )
    expect((await availability.windowsOf(db, OTHER, [rule.id])).get(rule.id)).toHaveLength(1)
    expect(await availability.itemRules(db, OTHER, item.id)).toHaveLength(1)
    expect((await availability.categoryRules(db, OTHER, [coffee.id])).get(coffee.id)).toHaveLength(1)
  })

  it('reads and changes none of their branch\'s sold-out versions', async () => {
    const { variation } = menu
    expect(await soldout.listSoldOut(db, TEST_TENANT, 'their-branch')).toEqual([])
    expect(await soldout.listSoldOut(db, OTHER, 'their-branch')).toHaveLength(1)
    expect(await soldout.listSoldOutIds(db, TEST_TENANT, 'their-branch')).toEqual(new Set())
    expect(await soldout.labelsOf(db, TEST_TENANT, [variation.id])).toEqual(new Map())
    expect((await soldout.labelsOf(db, OTHER, [variation.id])).get(variation.id)).toBe('Regular')
    expect(await soldout.findVariations(db, TEST_TENANT, [variation.id])).toEqual([])
    await run(...soldout.markOnSaleStatements(db, TEST_TENANT, 'their-branch', [variation.id], 'someone', NOW))
    expect(await soldout.listSoldOutIds(db, OTHER, 'their-branch')).toEqual(new Set([variation.id]))
  })

  it('reads none of their promotions or what they name', async () => {
    const { promotion, item } = menu
    expect(await promotions.linksOf(db, TEST_TENANT, [promotion.id])).toEqual({ items: new Map(), categories: new Map(), branches: new Map() })
    const theirs = await promotions.linksOf(db, OTHER, [promotion.id])
    expect([theirs.items.size, theirs.categories.size, theirs.branches.size]).toEqual([1, 1, 1])
    expect(await promotions.targetIdsOf(db, TEST_TENANT, [promotion.id])).toEqual({ items: new Map(), categories: new Map() })
    expect(await promotions.runningPromotions(db, TEST_TENANT, 'their-branch', '2026-10-20')).toEqual([])
    expect(await promotions.runningPromotions(db, OTHER, 'their-branch', '2026-10-20')).toHaveLength(1)
    expect(await promotions.liveItemIds(db, TEST_TENANT, [item.id])).toEqual(new Set())
    expect(await promotions.liveItemIds(db, OTHER, [item.id])).toEqual(new Set([item.id]))
  })
})
