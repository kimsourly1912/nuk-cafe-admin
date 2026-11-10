import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { auditEvents } from '#server/features/platform/platform.schema'
import type { Actor } from '#server/features/identity'
import { menuCategories, menuCategoryAvailability, menuPromotionCategories } from '#server/features/menu/menu.schema'
import { deleteCategoryStatement } from '#server/features/menu/categories.repository'
import { createAvailabilityRule } from '#server/features/menu/availability.service'
import { createPromotion } from '#server/features/menu/promotions.service'
import { archiveCategory, createCategory, deleteCategory, getCategory, listCategories, reorderCategories, restoreCategory, updateCategory } from '#server/features/menu/categories.service'
import { archiveItem, createItem, deleteItem, updateItem } from '#server/features/menu/items.service'
import { createTestDb, ensureTenant, insertSoldLine, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'

let db: Db
const actor: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
})

const create = (name: string, parentId: string | null = null) => createCategory(db, actor, { name, description: '', parentId, availabilityRuleIds: [] })

const names = (list: MenuCategory[]) => list.map(c => (c.parentId ? `  ${c.name}` : c.name))

describe('creating', () => {
  it('builds a two-level tree, each new category at the end of its level', async () => {
    const coffee = await create('Coffee')
    const tea = await create('Tea')
    await create('Espresso drinks', coffee.id)
    await create('Filter', coffee.id)
    expect([coffee.sortOrder, tea.sortOrder]).toEqual([1, 2])
    expect(names(await listCategories(db, TEST_TENANT, { status: 'active' }))).toEqual(['Coffee', '  Espresso drinks', '  Filter', 'Tea'])
    expect((await listCategories(db, TEST_TENANT, { status: 'active' }))[0]).toMatchObject({ name: 'Coffee', childCount: 2, status: 'active', version: 1 })
  })

  it('refuses a third level', async () => {
    const coffee = await create('Coffee')
    const espresso = await create('Espresso drinks', coffee.id)
    await expectApiError(() => create('Doubles', espresso.id), 422, 'CATEGORY_DEPTH')
  })

  it('refuses an unknown or archived parent', async () => {
    const coffee = await create('Coffee')
    await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    await expectApiError(() => create('Filter', coffee.id), 422, 'PARENT_NOT_AVAILABLE')
    await expectApiError(() => create('Filter', '01a0e2a0-0000-7000-8000-000000000000'), 422, 'PARENT_NOT_AVAILABLE')
  })

  it('keeps names unique per level, ignoring case; archived ones free their name', async () => {
    const coffee = await create('Coffee')
    const tea = await create('Tea')
    await expectApiError(() => create('COFFEE'), 409, 'CATEGORY_NAME_TAKEN')
    await create('Iced', coffee.id)
    await expectApiError(() => create('iced', coffee.id), 409, 'CATEGORY_NAME_TAKEN')
    await expect(create('Iced', tea.id)).resolves.toMatchObject({ name: 'Iced' })

    await archiveCategory(db, actor, tea.id, { version: tea.version })
    await expect(create('Tea')).resolves.toMatchObject({ status: 'active' })
  })

  it('lets only one of two simultaneous creates with the same name through', async () => {
    const results = await Promise.allSettled([create('Coffee'), create('coffee')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409, data: { code: 'CATEGORY_NAME_TAKEN' } })
  })

  it('refuses a sub-category when the parent is archived between the check and the write', async () => {
    const coffee = await create('Coffee')
    const racing = interleaved(db, () => db.update(menuCategories).set({ status: 'archived' }).where(eq(menuCategories.id, coffee.id)))
    await expectApiError(() => createCategory(racing, actor, { name: 'Filter', description: '', parentId: coffee.id, availabilityRuleIds: [] }), 422, 'PARENT_NOT_AVAILABLE')
    expect(await listCategories(db, TEST_TENANT, { status: 'all' })).toHaveLength(1)
  })

  it('writes an audit row with who and which request', async () => {
    const coffee = await create('Coffee')
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, coffee.id))
    expect(row).toMatchObject({ action: 'menu.category.create', actorId: 'admin-1', requestId: 'req-1', targetType: 'menu_category' })
  })
})

describe('updating', () => {
  it('renames and re-describes, moving the version on', async () => {
    const coffee = await create('Coffee')
    const updated = await updateCategory(db, actor, coffee.id, { version: 1, name: 'Coffee & espresso', description: 'Hot and iced' })
    expect(updated).toMatchObject({ name: 'Coffee & espresso', description: 'Hot and iced', version: 2 })
  })

  it('refuses a stale version and an archived category', async () => {
    const coffee = await create('Coffee')
    await updateCategory(db, actor, coffee.id, { version: 1, name: 'Coffees' })
    await expectApiError(() => updateCategory(db, actor, coffee.id, { version: 1, name: 'Coffee' }), 409, 'VERSION_CONFLICT')
    const archived = await archiveCategory(db, actor, coffee.id, { version: 2 })
    await expectApiError(() => updateCategory(db, actor, coffee.id, { version: archived.version, name: 'Coffee' }), 409, 'INVALID_STATE')
  })

  it('refuses a stale version that arrives between the check and the write', async () => {
    const coffee = await create('Coffee')
    const racing = interleaved(db, () => db.update(menuCategories).set({ version: 2 }).where(eq(menuCategories.id, coffee.id)))
    await expectApiError(() => updateCategory(racing, actor, coffee.id, { version: 1, name: 'Coffees' }), 409, 'VERSION_CONFLICT')
  })

  it('moves a sub-category to another parent, at the end of its new siblings', async () => {
    const coffee = await create('Coffee')
    const tea = await create('Tea')
    const iced = await create('Iced', coffee.id)
    await create('Green', tea.id)
    const moved = await updateCategory(db, actor, iced.id, { version: iced.version, parentId: tea.id })
    expect(moved).toMatchObject({ parentId: tea.id, sortOrder: 2 })
    expect(names(await listCategories(db, TEST_TENANT, { status: 'active' }))).toEqual(['Coffee', 'Tea', '  Green', '  Iced'])
  })

  it('moves a sub-category up to the top level, and a childless top-level category down', async () => {
    const coffee = await create('Coffee')
    const iced = await create('Iced', coffee.id)
    const top = await updateCategory(db, actor, iced.id, { version: iced.version, parentId: null })
    expect(top).toMatchObject({ parentId: null, sortOrder: 2 })
    const down = await updateCategory(db, actor, iced.id, { version: top.version, parentId: coffee.id })
    expect(down.parentId).toBe(coffee.id)
  })

  it('keeps two levels: a category with sub-categories can\'t move under another, nor under itself', async () => {
    const coffee = await create('Coffee')
    const tea = await create('Tea')
    await create('Iced', coffee.id)
    await expectApiError(() => updateCategory(db, actor, coffee.id, { version: coffee.version, parentId: tea.id }), 422, 'CATEGORY_DEPTH')
    await expectApiError(() => updateCategory(db, actor, tea.id, { version: tea.version, parentId: tea.id }), 422, 'CATEGORY_DEPTH')
  })

  it('refuses the move when the category gets a sub-category between the check and the write', async () => {
    const coffee = await create('Coffee')
    const tea = await create('Tea')
    const racing = interleaved(db, () => create('Green', tea.id))
    await expectApiError(() => updateCategory(racing, actor, tea.id, { version: tea.version, parentId: coffee.id }), 422, 'CATEGORY_DEPTH')
    expect((await listCategories(db, TEST_TENANT, { status: 'active' })).find(c => c.id === tea.id)?.parentId).toBeNull()
  })

  it('refuses a name taken at the new level', async () => {
    const coffee = await create('Coffee')
    const tea = await create('Tea')
    await create('Iced', coffee.id)
    const teaIced = await create('Iced', tea.id)
    await expectApiError(() => updateCategory(db, actor, teaIced.id, { version: teaIced.version, parentId: coffee.id }), 409, 'CATEGORY_NAME_TAKEN')
  })
})

describe('archiving and restoring', () => {
  it('archives a category with its sub-categories', async () => {
    const coffee = await create('Coffee')
    await create('Iced', coffee.id)
    await create('Hot', coffee.id)
    const archived = await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    expect(archived).toMatchObject({ status: 'archived', childCount: 0 })
    expect(await listCategories(db, TEST_TENANT, { status: 'active' })).toEqual([])
    expect(names(await listCategories(db, TEST_TENANT, { status: 'archived' }))).toEqual(['Coffee', '  Iced', '  Hot'])
  })

  it('refuses archiving twice, and a stale version', async () => {
    const coffee = await create('Coffee')
    const archived = await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    await expectApiError(() => archiveCategory(db, actor, coffee.id, { version: archived.version }), 409, 'INVALID_STATE')
    const tea = await create('Tea')
    await expectApiError(() => archiveCategory(db, actor, tea.id, { version: tea.version + 1 }), 409, 'VERSION_CONFLICT')
  })

  it('restores one category at the end of its level; its sub-categories stay archived', async () => {
    const coffee = await create('Coffee')
    const iced = await create('Iced', coffee.id)
    await create('Tea')
    const archived = await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    const restored = await restoreCategory(db, actor, coffee.id, { version: archived.version })
    // After Tea (2): positions keep their gaps; only the relative order matters.
    expect(restored).toMatchObject({ status: 'active', sortOrder: 3 })
    expect(names(await listCategories(db, TEST_TENANT, { status: 'active' }))).toEqual(['Tea', 'Coffee'])
    const archivedIced = (await listCategories(db, TEST_TENANT, { status: 'archived' })).find(c => c.id === iced.id)!
    await expect(restoreCategory(db, actor, iced.id, { version: archivedIced.version })).resolves.toMatchObject({ status: 'active' })
  })

  it('refuses restoring a sub-category whose parent is archived, or a name now taken', async () => {
    const coffee = await create('Coffee')
    const iced = await create('Iced', coffee.id)
    await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    const archivedIced = (await listCategories(db, TEST_TENANT, { status: 'archived' })).find(c => c.id === iced.id)!
    await expectApiError(() => restoreCategory(db, actor, iced.id, { version: archivedIced.version }), 409, 'PARENT_ARCHIVED')

    const archivedCoffee = (await listCategories(db, TEST_TENANT, { status: 'archived' })).find(c => c.id === coffee.id)!
    await create('Coffee')
    await expectApiError(() => restoreCategory(db, actor, coffee.id, { version: archivedCoffee.version }), 409, 'CATEGORY_NAME_TAKEN')
  })

  it('restores a top-level category with its archived sub-categories when asked, in their order', async () => {
    const coffee = await create('Coffee')
    await create('Iced', coffee.id)
    await create('Hot', coffee.id)
    const archived = await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    const restored = await restoreCategory(db, actor, coffee.id, { version: archived.version, withSubcategories: true })
    expect(restored).toMatchObject({ status: 'active', childCount: 2 })
    expect(names(await listCategories(db, TEST_TENANT, { status: 'active' }))).toEqual(['Coffee', '  Iced', '  Hot'])
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.category.restore'))
    expect(event?.metadata).toEqual({ subCategories: 2 })
  })

  it('restores nothing when the version is stale, sub-categories included', async () => {
    const coffee = await create('Coffee')
    await create('Iced', coffee.id)
    await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    await expectApiError(() => restoreCategory(db, actor, coffee.id, { version: coffee.version, withSubcategories: true }), 409, 'VERSION_CONFLICT')
    expect(await listCategories(db, TEST_TENANT, { status: 'active' })).toEqual([])
  })

  it('refuses restoring what isn\'t archived', async () => {
    const coffee = await create('Coffee')
    await expectApiError(() => restoreCategory(db, actor, coffee.id, { version: coffee.version }), 409, 'INVALID_STATE')
  })
})

describe('item counts', () => {
  it('counts each category\'s drafts and published items, not archived ones', async () => {
    const drinks = await create('Drinks')
    const food = await create('Food')
    const item = (name: string) => createItem(db, actor, { categoryId: drinks.id, name, description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    await item('Latte')
    const old = await item('Mocha')
    await archiveItem(db, actor, old.id, { version: old.version })
    const counts = Object.fromEntries((await listCategories(db, TEST_TENANT, { status: 'active' })).map(c => [c.name, c.itemCount]))
    expect(counts).toEqual({ Drinks: 1, Food: 0 })
    // The single-category answers (a write's result) count the same way.
    const renamed = await updateCategory(db, actor, drinks.id, { version: drinks.version, name: 'Beverages' })
    expect(renamed.itemCount).toBe(1)
    expect((await archiveCategory(db, actor, food.id, { version: food.version })).itemCount).toBe(0)
  })
})

describe('reordering', () => {
  async function threeTopLevel() {
    // One after another: concurrent creates may share a position (ties sort by name).
    return [await create('Coffee'), await create('Tea'), await create('Food')]
  }

  it('puts one level in the given order', async () => {
    const [coffee, tea, food] = await threeTopLevel()
    const result = await reorderCategories(db, actor, { parentId: null, items: [food!, coffee!, tea!].map(c => ({ id: c.id, version: c.version })) })
    expect(result.map(c => [c.name, c.sortOrder])).toEqual([['Food', 1], ['Coffee', 2], ['Tea', 3]])
    expect(names(await listCategories(db, TEST_TENANT, { status: 'active' }))).toEqual(['Food', 'Coffee', 'Tea'])
  })

  it('needs every sibling with the version read', async () => {
    const [coffee, tea, food] = await threeTopLevel()
    await expectApiError(() => reorderCategories(db, actor, { parentId: null, items: [coffee!, tea!].map(c => ({ id: c.id, version: c.version })) }), 409, 'VERSION_CONFLICT')
    await expectApiError(() => reorderCategories(db, actor, { parentId: null, items: [coffee!, tea!, food!].map(c => ({ id: c.id, version: c.version + 1 })) }), 409, 'VERSION_CONFLICT')
  })

  it('changes nothing when a sibling is added between the check and the write', async () => {
    const list = await threeTopLevel()
    const racing = interleaved(db, () => create('Drinks'))
    await expectApiError(() => reorderCategories(racing, actor, { parentId: null, items: [...list].reverse().map(c => ({ id: c.id, version: c.version })) }), 409, 'VERSION_CONFLICT')
    expect(names(await listCategories(db, TEST_TENANT, { status: 'active' }))).toEqual(['Coffee', 'Tea', 'Food', 'Drinks'])
  })

  it('reorders the sub-categories of one parent', async () => {
    const coffee = await create('Coffee')
    const hot = await create('Hot', coffee.id)
    const iced = await create('Iced', coffee.id)
    await reorderCategories(db, actor, { parentId: coffee.id, items: [iced, hot].map(c => ({ id: c.id, version: c.version })) })
    expect(names(await listCategories(db, TEST_TENANT, { status: 'active' }))).toEqual(['Coffee', '  Iced', '  Hot'])
  })
})

describe('deleting permanently (D200)', () => {
  const exists = async (id: string) => (await db.select({ id: menuCategories.id }).from(menuCategories).where(eq(menuCategories.id, id))).length === 1
  const archive = (category: MenuCategory) => archiveCategory(db, actor, category.id, { version: category.version })
  const itemIn = (categoryId: string) => createItem(db, actor, { categoryId, name: 'Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 350, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })

  it('deletes an empty archived category with its rule links, and keeps its name in the audit', async () => {
    const rule = await createAvailabilityRule(db, actor, { name: 'Mornings', windows: [{ weekday: 1, startMinute: 0, endMinute: 600 }] })
    const tea = await createCategory(db, actor, { name: 'Tea', description: '', parentId: null, availabilityRuleIds: [rule.id] })
    const archived = await archive(tea)
    expect(archived.deleteBlocker).toBeNull()
    await deleteCategory(db, actor, tea.id, { version: archived.version })
    expect(await exists(tea.id)).toBe(false)
    expect(await db.select().from(menuCategoryAvailability).where(eq(menuCategoryAvailability.categoryId, tea.id))).toEqual([])
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.category.delete'))
    expect(audit).toMatchObject({ targetId: tea.id, metadata: { name: 'Tea', parentId: null } })
    await expectApiError(() => getCategory(db, TEST_TENANT, tea.id), 404, 'NOT_FOUND')
  })

  it('refuses an active category, a stale version and an unknown one', async () => {
    const tea = await create('Tea')
    await expectApiError(() => deleteCategory(db, actor, tea.id, { version: tea.version }), 409, 'INVALID_STATE')
    const archived = await archive(tea)
    await expectApiError(() => deleteCategory(db, actor, tea.id, { version: tea.version }), 409, 'VERSION_CONFLICT')
    await expectApiError(() => deleteCategory(db, actor, 'missing', { version: 1 }), 404, 'NOT_FOUND')
    expect(await exists(archived.id)).toBe(true)
  })

  it('refuses one that holds items, archived ones too, until they are deleted', async () => {
    const tea = await create('Tea')
    const item = await itemIn(tea.id)
    const gone = await archiveItem(db, actor, item.id, { version: item.version })
    const archived = await archive(tea)
    expect(archived.deleteBlocker).toBe('items')
    await expectApiError(() => deleteCategory(db, actor, tea.id, { version: archived.version }), 409, 'CATEGORY_HAS_HISTORY')
    await deleteItem(db, actor, item.id, { version: gone.version })
    await deleteCategory(db, actor, tea.id, { version: archived.version })
    expect(await exists(tea.id)).toBe(false)
  })

  it('refuses a main category with subcategories, archived ones too', async () => {
    const coffee = await create('Coffee')
    const espresso = await create('Espresso', coffee.id)
    const archived = await archiveCategory(db, actor, coffee.id, { version: (await getCategory(db, TEST_TENANT, coffee.id)).version })
    expect(archived.deleteBlocker).toBe('subcategories')
    await expectApiError(() => deleteCategory(db, actor, coffee.id, { version: archived.version }), 409, 'CATEGORY_HAS_HISTORY')
    // The subcategory was archived with it and is empty: it goes, then the main one.
    const sub = await getCategory(db, TEST_TENANT, espresso.id)
    await deleteCategory(db, actor, espresso.id, { version: sub.version })
    await deleteCategory(db, actor, coffee.id, { version: archived.version })
    expect(await exists(coffee.id)).toBe(false)
  })

  it('refuses an empty category something was sold under (the item moved away)', async () => {
    const tea = await create('Tea')
    const other = await create('Other')
    const item = await itemIn(tea.id)
    await insertSoldLine(db, { itemId: item.id, categoryId: tea.id })
    await updateItem(db, actor, item.id, { version: item.version, categoryId: other.id })
    const archived = await archive(tea)
    expect(archived.deleteBlocker).toBe('ordered')
    await expectApiError(() => deleteCategory(db, actor, tea.id, { version: archived.version }), 409, 'CATEGORY_HAS_HISTORY')
  })

  it('refuses one a promotion names, even a draft promotion', async () => {
    const herbal = await create('Herbal')
    const draft = await createPromotion(db, actor, { name: 'Herbal week', description: '', discount: { kind: 'percent', percent: 10 }, scope: 'selected', itemIds: [], categoryIds: [herbal.id], branchIds: [], startsOn: '2026-10-25', endsOn: '2026-10-30', posterId: null, publish: false }, new Date('2026-10-24T03:00:00Z'))
    const archived = await archive(herbal)
    expect(archived.deleteBlocker).toBe('promotion')
    await expectApiError(() => deleteCategory(db, actor, herbal.id, { version: archived.version }), 409, 'CATEGORY_HAS_HISTORY')
    expect(await db.select().from(menuPromotionCategories).where(eq(menuPromotionCategories.promotionId, draft.id))).toHaveLength(1)
  })

  it('the delete statement itself refuses each blocker, and an active category', async () => {
    const run = (category: MenuCategory) => db.batch([deleteCategoryStatement(db, TEST_TENANT, category.id, category.version)])
    const active = await create('Active')
    await run(active)
    const items = await create('Items')
    await itemIn(items.id)
    const main = await create('Main')
    await create('Sub', main.id)
    const sold = await create('Sold')
    await insertSoldLine(db, { itemId: 'gone', categoryId: sold.id })
    const promoted = await create('Promoted')
    await createPromotion(db, actor, { name: 'Week', description: '', discount: { kind: 'percent', percent: 10 }, scope: 'selected', itemIds: [], categoryIds: [promoted.id], branchIds: [], startsOn: '2026-10-25', endsOn: '2026-10-30', posterId: null, publish: false }, new Date('2026-10-24T03:00:00Z'))
    for (const category of [items, main, sold, promoted]) {
      const archived = await getCategory(db, TEST_TENANT, category.id).then(c => c.status === 'archived' ? c : archive(c))
      await run(archived)
    }
    for (const category of [active, items, main, sold, promoted]) expect(await exists(category.id), category.name).toBe(true)
  })

  it('refuses when a promotion names it meanwhile (the guard in the batch)', async () => {
    const tea = await create('Tea')
    const other = await create('Other')
    const draft = await createPromotion(db, actor, { name: 'Week', description: '', discount: { kind: 'percent', percent: 10 }, scope: 'selected', itemIds: [], categoryIds: [other.id], branchIds: [], startsOn: '2026-10-25', endsOn: '2026-10-30', posterId: null, publish: false }, new Date('2026-10-24T03:00:00Z'))
    const archived = await archive(tea)
    const racing = interleaved(db, () => db.insert(menuPromotionCategories).values({ tenantId: TEST_TENANT, promotionId: draft.id, categoryId: tea.id }))
    await expectApiError(() => deleteCategory(racing, actor, tea.id, { version: archived.version }), 409, 'CATEGORY_HAS_HISTORY')
    expect(await exists(tea.id)).toBe(true)
  })
})
