import { beforeEach, describe, expect, it } from 'vitest'
import { auditEvents, menuCategories } from '../../server/db/tables'
import type { Db } from '../../server/db/types'
import type { Actor } from '../../server/features/identity/service'
import { createCategory, deleteCategory, listCategories, reorderCategories, updateCategory } from '../../server/features/menu/categories'
import { createProduct } from '../../server/features/menu/products'
import { createAdmin, createTestDb } from './support/db'
import { failure } from './support/failure'

let db: Db
let actor: Actor
beforeEach(async () => {
  db = await createTestDb()
  actor = await createAdmin(db)
})

const main = (name: string) => createCategory(db, actor, { name, parentId: null, status: 'ACTIVE' })
const sub = (name: string, parentId: string) => createCategory(db, actor, { name, parentId, status: 'ACTIVE' })

describe('create', () => {
  it('appends to its siblings and records an audit event', async () => {
    const tea = await main('Tea')
    const coffee = await main('Coffee')
    const green = await sub('Green', tea.id)
    expect([tea.sortOrder, coffee.sortOrder, green.sortOrder]).toEqual([1, 2, 1])
    expect(green).toMatchObject({ parentId: tea.id, status: 'ACTIVE', version: 1 })
    expect(await db.select().from(auditEvents)).toHaveLength(3)
  })

  it('allows two levels only', async () => {
    const tea = await main('Tea')
    const green = await sub('Green', tea.id)
    expect(await failure(sub('Matcha', green.id))).toEqual({ status: 400, code: 'CATEGORY_DEPTH' })
  })

  it('rejects a parent that does not exist', async () => {
    expect(await failure(sub('Green', crypto.randomUUID()))).toEqual({ status: 400, code: 'REFERENCE_NOT_FOUND' })
  })
})

describe('update', () => {
  it('changes only the fields sent and bumps the version', async () => {
    const tea = await main('Tea')
    const updated = await updateCategory(db, actor, tea.id, { version: 1, status: 'INACTIVE' })
    expect(updated).toMatchObject({ name: 'Tea', status: 'INACTIVE', version: 2 })
  })

  it('rejects a stale version without writing anything', async () => {
    const tea = await main('Tea')
    await updateCategory(db, actor, tea.id, { version: 1, name: 'Teas' })
    const auditBefore = (await db.select().from(auditEvents)).length
    expect(await failure(updateCategory(db, actor, tea.id, { version: 1, name: 'Old' }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' })
    expect((await listCategories(db))[0]!.name).toBe('Teas')
    expect(await db.select().from(auditEvents)).toHaveLength(auditBefore)
  })

  it('of two concurrent saves from one version, exactly one wins', async () => {
    const tea = await main('Tea')
    const results = await Promise.allSettled([
      updateCategory(db, actor, tea.id, { version: 1, name: 'A' }),
      updateCategory(db, actor, tea.id, { version: 1, name: 'B' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((await listCategories(db))[0]!.version).toBe(2)
  })

  it('clears the parent with null, moving the category to the end of the mains', async () => {
    const tea = await main('Tea')
    await main('Coffee')
    const green = await sub('Green', tea.id)
    const moved = await updateCategory(db, actor, green.id, { version: 1, parentId: null })
    expect(moved).toMatchObject({ parentId: null, sortOrder: 3 })
  })

  it('keeps the parent when parentId is absent', async () => {
    const tea = await main('Tea')
    const green = await sub('Green', tea.id)
    expect(await updateCategory(db, actor, green.id, { version: 1, name: 'Greens' })).toMatchObject({ parentId: tea.id })
  })

  it('refuses to make a category with sub-categories a sub-category', async () => {
    const tea = await main('Tea')
    const coffee = await main('Coffee')
    await sub('Green', tea.id)
    expect(await failure(updateCategory(db, actor, tea.id, { version: 1, parentId: coffee.id }))).toEqual({ status: 409, code: 'CATEGORY_DEPTH' })
    expect(await failure(updateCategory(db, actor, tea.id, { version: 1, parentId: tea.id }))).toEqual({ status: 400, code: 'CATEGORY_DEPTH' })
  })
})

describe('delete', () => {
  it('deletes an unused category', async () => {
    const tea = await main('Tea')
    await deleteCategory(db, actor, tea.id, 1)
    expect(await listCategories(db)).toEqual([])
  })

  it('refuses while it has sub-categories or menu items, and on a stale version', async () => {
    const tea = await main('Tea')
    const green = await sub('Green', tea.id)
    expect(await failure(deleteCategory(db, actor, tea.id, 1))).toEqual({ status: 409, code: 'CATEGORY_HAS_CHILDREN' })
    await createProduct(db, actor, { name: 'Sencha', categoryId: green.id, priceMinor: 350, description: '', imageAssetId: null, status: 'ACTIVE', scheduleIds: [], variantGroups: [] })
    expect(await failure(deleteCategory(db, actor, green.id, 1))).toEqual({ status: 409, code: 'CATEGORY_IN_USE' })
    expect(await failure(deleteCategory(db, actor, green.id, 7))).toEqual({ status: 409, code: 'VERSION_CONFLICT' })
    expect(await failure(deleteCategory(db, actor, crypto.randomUUID(), 1))).toEqual({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('reorder', () => {
  it('numbers each list from 1 and keeps versions', async () => {
    const tea = await main('Tea')
    const coffee = await main('Coffee')
    const green = await sub('Green', tea.id)
    const black = await sub('Black', tea.id)
    const result = await reorderCategories(db, actor, { lists: [
      { parentId: null, ids: [coffee.id, tea.id] },
      { parentId: tea.id, ids: [black.id, green.id] },
    ] })
    const byName = Object.fromEntries(result.map(c => [c.name, c]))
    expect([byName.Coffee!.sortOrder, byName.Tea!.sortOrder, byName.Black!.sortOrder, byName.Green!.sortOrder]).toEqual([1, 2, 1, 2])
    expect(result.every(c => c.version === 1)).toBe(true)
  })

  it('rejects a list that does not name every current child', async () => {
    const tea = await main('Tea')
    await main('Coffee')
    expect(await failure(reorderCategories(db, actor, { lists: [{ parentId: null, ids: [tea.id] }] }))).toEqual({ status: 409, code: 'ORDER_STALE' })
  })

  it('applies nothing when a category appears meanwhile (checked inside the write)', async () => {
    const tea = await main('Tea')
    const coffee = await main('Coffee')
    // Simulate a category created between the service's read and its batch.
    const original = db.batch.bind(db)
    db.batch = (async (statements: Parameters<typeof original>[0]) => {
      await db.insert(menuCategories).values({ name: 'Juice', sortOrder: 3 })
      return original(statements)
    }) as typeof db.batch
    expect(await failure(reorderCategories(db, actor, { lists: [{ parentId: null, ids: [coffee.id, tea.id] }] }))).toEqual({ status: 409, code: 'ORDER_STALE' })
    db.batch = original
    const names = (await listCategories(db)).map(c => c.name)
    expect(names).toEqual(['Tea', 'Coffee', 'Juice'])
  })
})
