import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { auditEvents } from '../../platform/platform.schema'
import type { Actor } from '../../identity'
import { menuCategories } from '../menu.schema'
import { archiveCategory, createCategory, listCategories, reorderCategories, restoreCategory, updateCategory } from '../categories.service'
import { createTestDb } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import { interleaved } from '../../../tests/support/interleave'
import type { Db } from '../../../utils/batch'

let db: Db
const actor: Actor = { userId: 'admin-1', role: 'admin', requestId: 'req-1' }

beforeEach(async () => {
  db = await createTestDb()
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
    expect(names(await listCategories(db, { status: 'active' }))).toEqual(['Coffee', '  Espresso drinks', '  Filter', 'Tea'])
    expect((await listCategories(db, { status: 'active' }))[0]).toMatchObject({ name: 'Coffee', childCount: 2, status: 'active', version: 1 })
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
    expect(await listCategories(db, { status: 'all' })).toHaveLength(1)
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
    expect(names(await listCategories(db, { status: 'active' }))).toEqual(['Coffee', 'Tea', '  Green', '  Iced'])
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
    expect((await listCategories(db, { status: 'active' })).find(c => c.id === tea.id)?.parentId).toBeNull()
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
    expect(await listCategories(db, { status: 'active' })).toEqual([])
    expect(names(await listCategories(db, { status: 'archived' }))).toEqual(['Coffee', '  Iced', '  Hot'])
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
    expect(names(await listCategories(db, { status: 'active' }))).toEqual(['Tea', 'Coffee'])
    const archivedIced = (await listCategories(db, { status: 'archived' })).find(c => c.id === iced.id)!
    await expect(restoreCategory(db, actor, iced.id, { version: archivedIced.version })).resolves.toMatchObject({ status: 'active' })
  })

  it('refuses restoring a sub-category whose parent is archived, or a name now taken', async () => {
    const coffee = await create('Coffee')
    const iced = await create('Iced', coffee.id)
    await archiveCategory(db, actor, coffee.id, { version: coffee.version })
    const archivedIced = (await listCategories(db, { status: 'archived' })).find(c => c.id === iced.id)!
    await expectApiError(() => restoreCategory(db, actor, iced.id, { version: archivedIced.version }), 409, 'PARENT_ARCHIVED')

    const archivedCoffee = (await listCategories(db, { status: 'archived' })).find(c => c.id === coffee.id)!
    await create('Coffee')
    await expectApiError(() => restoreCategory(db, actor, coffee.id, { version: archivedCoffee.version }), 409, 'CATEGORY_NAME_TAKEN')
  })

  it('refuses restoring what isn\'t archived', async () => {
    const coffee = await create('Coffee')
    await expectApiError(() => restoreCategory(db, actor, coffee.id, { version: coffee.version }), 409, 'INVALID_STATE')
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
    expect(names(await listCategories(db, { status: 'active' }))).toEqual(['Food', 'Coffee', 'Tea'])
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
    expect(names(await listCategories(db, { status: 'active' }))).toEqual(['Coffee', 'Tea', 'Food', 'Drinks'])
  })

  it('reorders the sub-categories of one parent', async () => {
    const coffee = await create('Coffee')
    const hot = await create('Hot', coffee.id)
    const iced = await create('Iced', coffee.id)
    await reorderCategories(db, actor, { parentId: coffee.id, items: [iced, hot].map(c => ({ id: c.id, version: c.version })) })
    expect(names(await listCategories(db, { status: 'active' }))).toEqual(['Coffee', '  Iced', '  Hot'])
  })
})
