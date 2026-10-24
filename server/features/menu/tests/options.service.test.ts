import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import type { OptionSet } from '#shared/contracts/menu-options'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { menuItemOptionSets, menuOptionSets, menuOptionValues } from '#server/features/menu/menu.schema'
import { deleteSetStatements, deleteValueStatement } from '#server/features/menu/options.repository'
import { createCategory } from '#server/features/menu/categories.service'
import { archiveItem, createItem, deleteItem, updateItem } from '#server/features/menu/items.service'
import { addOptionValue, archiveOptionSet, archiveOptionValue, createOptionSet, deleteOptionSet, deleteOptionValue, getOptionSet, listOptionSets, renameOptionSet, renameOptionValue, reorderOptionValues, restoreOptionSet, restoreOptionValue } from '#server/features/menu/options.service'
import { createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite } from '#server/utils/batch'

let db: Db
const actor: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
})

const size = () => createOptionSet(db, actor, { name: 'Size', values: ['Small', 'Regular', 'Large'] })
const names = (set: OptionSet, status: 'active' | 'archived' = 'active') => set.values.filter(v => v.status === status).map(v => v.name)
const valueId = (set: OptionSet, name: string) => set.values.find(v => v.name === name)!.id

describe('option sets', () => {
  it('creates a set with its values in order, audited', async () => {
    const set = await size()
    expect(set).toMatchObject({ name: 'Size', status: 'active', version: 1 })
    expect(set.values.map(v => [v.name, v.sortOrder])).toEqual([['Small', 1], ['Regular', 2], ['Large', 3]])
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, set.id))
    expect(row).toMatchObject({ action: 'menu.option_set.create', actorId: 'admin-1', requestId: 'req-1' })
  })

  it('lists active sets by name, archived on request', async () => {
    const s = await size()
    await createOptionSet(db, actor, { name: 'milk type', values: ['Whole'] })
    await createOptionSet(db, actor, { name: 'Temperature', values: ['Hot', 'Iced'] })
    await archiveOptionSet(db, actor, s.id, { version: s.version })
    expect((await listOptionSets(db, TEST_TENANT, { status: 'active' })).map(x => x.name)).toEqual(['milk type', 'Temperature'])
    expect((await listOptionSets(db, TEST_TENANT, { status: 'archived' })).map(x => x.name)).toEqual(['Size'])
    expect(await listOptionSets(db, TEST_TENANT, { status: 'all' })).toHaveLength(3)
  })

  it('keeps active set names unique, ignoring case, even when two creates race', async () => {
    await size()
    await expectApiError(() => createOptionSet(db, actor, { name: 'SIZE', values: ['S'] }), 409, 'OPTION_SET_NAME_TAKEN')
    const results = await Promise.allSettled([
      createOptionSet(db, actor, { name: 'Temperature', values: ['Hot'] }),
      createOptionSet(db, actor, { name: 'temperature', values: ['Iced'] }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    // The losing set left nothing behind: its values were in the same batch.
    expect(await db.select().from(menuOptionValues)).toHaveLength(4)
  })

  it('renames, moving the version on; a stale version changes nothing', async () => {
    const set = await size()
    const renamed = await renameOptionSet(db, actor, set.id, { version: 1, name: 'Cup size' })
    expect(renamed).toMatchObject({ name: 'Cup size', version: 2 })
    await expectApiError(() => renameOptionSet(db, actor, set.id, { version: 1, name: 'Sizes' }), 409, 'VERSION_CONFLICT')
  })

  it('refuses a stale version that arrives between the check and the write', async () => {
    const set = await size()
    const racing = interleaved(db, () => db.update(menuOptionSets).set({ version: 2 }).where(eq(menuOptionSets.id, set.id)))
    await expectApiError(() => renameOptionSet(racing, actor, set.id, { version: 1, name: 'Cup size' }), 409, 'VERSION_CONFLICT')
    expect((await listOptionSets(db, TEST_TENANT, { status: 'active' }))[0]!.name).toBe('Size')
  })

  it('archives and restores; an archived set can\'t be edited; a restored name must be free', async () => {
    const set = await size()
    const archived = await archiveOptionSet(db, actor, set.id, { version: 1 })
    expect(archived.status).toBe('archived')
    await expectApiError(() => renameOptionSet(db, actor, set.id, { version: archived.version, name: 'X' }), 409, 'INVALID_STATE')
    await expectApiError(() => addOptionValue(db, actor, set.id, { version: archived.version, name: 'XL' }), 409, 'INVALID_STATE')

    await createOptionSet(db, actor, { name: 'size', values: ['One'] })
    await expectApiError(() => restoreOptionSet(db, actor, set.id, { version: archived.version }), 409, 'OPTION_SET_NAME_TAKEN')
  })

  it('restores an archived set, and refuses restoring an active one', async () => {
    const set = await size()
    const archived = await archiveOptionSet(db, actor, set.id, { version: 1 })
    await expect(restoreOptionSet(db, actor, set.id, { version: archived.version })).resolves.toMatchObject({ status: 'active' })
    const other = await createOptionSet(db, actor, { name: 'Temperature', values: ['Hot'] })
    await expectApiError(() => restoreOptionSet(db, actor, other.id, { version: other.version }), 409, 'INVALID_STATE')
  })
})

describe('option values', () => {
  it('adds a value at the end, renames it, and keeps names unique in the set', async () => {
    const set = await size()
    const added = await addOptionValue(db, actor, set.id, { version: 1, name: 'Extra large' })
    expect(names(added)).toEqual(['Small', 'Regular', 'Large', 'Extra large'])
    expect(added.version).toBe(2)
    await expectApiError(() => addOptionValue(db, actor, set.id, { version: 2, name: 'large' }), 409, 'OPTION_VALUE_NAME_TAKEN')
    const renamed = await renameOptionValue(db, actor, set.id, valueId(added, 'Extra large'), { version: 2, name: 'XL' })
    expect(names(renamed)).toContain('XL')
    await expectApiError(() => renameOptionValue(db, actor, set.id, valueId(renamed, 'XL'), { version: renamed.version, name: 'SMALL' }), 409, 'OPTION_VALUE_NAME_TAKEN')
  })

  it('allows the same value name in different sets', async () => {
    await size()
    await expect(createOptionSet(db, actor, { name: 'Pastry size', values: ['Small', 'Large'] })).resolves.toMatchObject({ name: 'Pastry size' })
  })

  it('archives a value (listed after the active ones) and restores it at the end', async () => {
    const set = await size()
    const archived = await archiveOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: 1 })
    expect(names(archived)).toEqual(['Regular', 'Large'])
    expect(names(archived, 'archived')).toEqual(['Small'])
    expect(archived.values.at(-1)!.name).toBe('Small')
    const restored = await restoreOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: archived.version })
    expect(names(restored)).toEqual(['Regular', 'Large', 'Small'])
  })

  it('keeps at least one active value', async () => {
    const set = await createOptionSet(db, actor, { name: 'Milk', values: ['Whole', 'Oat'] })
    const one = await archiveOptionValue(db, actor, set.id, valueId(set, 'Whole'), { version: 1 })
    await expectApiError(() => archiveOptionValue(db, actor, set.id, valueId(set, 'Oat'), { version: one.version }), 422, 'LAST_OPTION_VALUE')
  })

  it('keeps at least one active value when the other is archived between the check and the write', async () => {
    const set = await createOptionSet(db, actor, { name: 'Milk', values: ['Whole', 'Oat'] })
    // Another request archives "Whole" without moving the set's version (as a stale write would).
    const racing = interleaved(db, () => db.update(menuOptionValues).set({ status: 'archived' }).where(eq(menuOptionValues.name, 'Whole')))
    await expectApiError(() => archiveOptionValue(racing, actor, set.id, valueId(set, 'Oat'), { version: 1 }), 422, 'LAST_OPTION_VALUE')
    expect((await db.select().from(menuOptionValues).where(eq(menuOptionValues.name, 'Oat')))[0]!.status).toBe('active')
  })

  it('refuses more than the maximum number of active values', async () => {
    const set = await createOptionSet(db, actor, { name: 'Flavour', values: Array.from({ length: MAX_OPTION_VALUES }, (_, i) => `Flavour ${i + 1}`) })
    await expectApiError(() => addOptionValue(db, actor, set.id, { version: 1, name: 'One more' }), 422, 'TOO_MANY_OPTION_VALUES')
    // A value added between the check and the write still can't push it over.
    const archived = await archiveOptionValue(db, actor, set.id, set.values[0]!.id, { version: 1 })
    const racing = interleaved(db, () => db.insert(menuOptionValues).values({ tenantId: TEST_TENANT, setId: set.id, name: 'Sneaked in', sortOrder: 99 }))
    await expectApiError(() => addOptionValue(racing, actor, set.id, { version: archived.version, name: 'One more' }), 422, 'TOO_MANY_OPTION_VALUES')
  })

  it('refuses editing an archived value, restoring an active one, and a value of another set', async () => {
    const set = await size()
    const other = await createOptionSet(db, actor, { name: 'Temperature', values: ['Hot', 'Iced'] })
    const archived = await archiveOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: 1 })
    await expectApiError(() => renameOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: archived.version, name: 'Tiny' }), 409, 'INVALID_STATE')
    await expectApiError(() => restoreOptionValue(db, actor, set.id, valueId(set, 'Large'), { version: archived.version }), 409, 'INVALID_STATE')
    await expectApiError(() => renameOptionValue(db, actor, set.id, valueId(other, 'Hot'), { version: archived.version, name: 'Warm' }), 404, 'NOT_FOUND')
  })

  it('reorders the active values; the list must be exactly them', async () => {
    const set = await size()
    const reordered = await reorderOptionValues(db, actor, set.id, { version: 1, valueIds: ['Large', 'Small', 'Regular'].map(n => valueId(set, n)) })
    expect(names(reordered)).toEqual(['Large', 'Small', 'Regular'])
    await expectApiError(() => reorderOptionValues(db, actor, set.id, { version: reordered.version, valueIds: ['Large', 'Small'].map(n => valueId(set, n)) }), 409, 'VERSION_CONFLICT')
    await expectApiError(() => reorderOptionValues(db, actor, set.id, { version: 1, valueIds: ['Small', 'Regular', 'Large'].map(n => valueId(set, n)) }), 409, 'VERSION_CONFLICT')
  })

  it('lets only one of two simultaneous edits of the same set through', async () => {
    const set = await size()
    const results = await Promise.allSettled([
      addOptionValue(db, actor, set.id, { version: 1, name: 'Extra large' }),
      renameOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: 1, name: 'Short' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
  })
})

describe('deleting permanently (D200)', () => {
  const setExists = async (id: string) => (await db.select({ id: menuOptionSets.id }).from(menuOptionSets).where(eq(menuOptionSets.id, id))).length === 1
  const valueExists = async (id: string) => (await db.select({ id: menuOptionValues.id }).from(menuOptionValues).where(eq(menuOptionValues.id, id))).length === 1
  const archive = (set: OptionSet) => archiveOptionSet(db, actor, set.id, { version: set.version })
  /** A draft item whose versions come from `set`'s active values. */
  async function itemWith(set: OptionSet) {
    const top = await createCategory(db, actor, { name: `Drinks ${set.id}`, description: '', parentId: null, availabilityRuleIds: [] })
    return createItem(db, actor, { categoryId: top.id, name: 'Latte', description: '', imageId: null, optionSetIds: [set.id], variations: set.values.filter(v => v.status === 'active').map(v => ({ valueIds: [v.id], priceMinor: 350, status: 'active' as const })), modifierGroups: [], availabilityRuleIds: [] })
  }

  describe('a set', () => {
    it('deletes an unused archived set with its values, and keeps its name in the audit', async () => {
      const set = await archive(await size())
      expect(set.deleteBlocker).toBeNull()
      await deleteOptionSet(db, actor, set.id, { version: set.version })
      expect(await setExists(set.id)).toBe(false)
      expect(await db.select().from(menuOptionValues).where(eq(menuOptionValues.setId, set.id))).toEqual([])
      const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.option_set.delete'))
      expect(audit).toMatchObject({ targetId: set.id, metadata: { name: 'Size' } })
      await expectApiError(() => getOptionSet(db, TEST_TENANT, set.id), 404, 'NOT_FOUND')
    })

    it('refuses an active set, a stale version and an unknown one', async () => {
      const active = await size()
      await expectApiError(() => deleteOptionSet(db, actor, active.id, { version: active.version }), 409, 'INVALID_STATE')
      const set = await archive(active)
      await expectApiError(() => deleteOptionSet(db, actor, set.id, { version: active.version }), 409, 'VERSION_CONFLICT')
      await expectApiError(() => deleteOptionSet(db, actor, 'missing', { version: 1 }), 404, 'NOT_FOUND')
      expect(await setExists(set.id)).toBe(true)
    })

    it('refuses one an archived item uses, until that item is deleted', async () => {
      const active = await size()
      const item = await itemWith(active)
      const gone = await archiveItem(db, actor, item.id, { version: item.version })
      const set = await archive(active)
      expect(set.deleteBlocker).toBe('items')
      await expectApiError(() => deleteOptionSet(db, actor, set.id, { version: set.version }), 409, 'OPTION_IN_USE')
      await deleteItem(db, actor, item.id, { version: gone.version })
      await deleteOptionSet(db, actor, set.id, { version: set.version })
      expect(await setExists(set.id)).toBe(false)
    })

    it('refuses one an item no longer offers but whose retired versions keep its values', async () => {
      const active = await size()
      const item = await itemWith(active)
      await updateItem(db, actor, item.id, { version: item.version, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }] })
      expect(await db.select().from(menuItemOptionSets).where(eq(menuItemOptionSets.setId, active.id))).toEqual([])
      const set = await archive(active)
      expect(set.deleteBlocker).toBe('items')
      await expectApiError(() => deleteOptionSet(db, actor, set.id, { version: set.version }), 409, 'OPTION_IN_USE')
    })

    it('the delete statements themselves refuse an active set, an item link and a version using a value', async () => {
      const run = (set: OptionSet) => db.batch(deleteSetStatements(db, TEST_TENANT, set.id, set.version) as [Statement, ...Statement[]])
      const active = await size()
      await expect(run(active)).rejects.toSatisfy(isStaleWrite)
      const linked = await createOptionSet(db, actor, { name: 'Milk', values: ['Whole'] })
      const used = await createOptionSet(db, actor, { name: 'Temperature', values: ['Hot', 'Iced'] })
      const item = await itemWith(used)
      await db.insert(menuItemOptionSets).values({ tenantId: TEST_TENANT, itemId: item.id, setId: linked.id, sortOrder: 2 })
      await db.delete(menuItemOptionSets).where(eq(menuItemOptionSets.setId, used.id))
      for (const set of [await archive(linked), await archive(used)]) await expect(run(set), set.name).rejects.toSatisfy(isStaleWrite)
      for (const set of [active, linked, used]) expect(await setExists(set.id), set.name).toBe(true)
    })

    it('refuses when an item starts using it meanwhile (the guard in the batch)', async () => {
      const set = await archive(await size())
      const item = await itemWith(await createOptionSet(db, actor, { name: 'Milk', values: ['Whole'] }))
      const racing = interleaved(db, () => db.insert(menuItemOptionSets).values({ tenantId: TEST_TENANT, itemId: item.id, setId: set.id, sortOrder: 2 }))
      await expectApiError(() => deleteOptionSet(racing, actor, set.id, { version: set.version }), 409, 'OPTION_IN_USE')
      expect(await setExists(set.id)).toBe(true)
    })
  })

  describe('a value', () => {
    it('deletes an unused archived value under the set\'s lock, audited', async () => {
      const set = await size()
      const gone = await archiveOptionValue(db, actor, set.id, valueId(set, 'Large'), { version: set.version })
      expect(gone.values.find(v => v.name === 'Large')?.deleteBlocker).toBeNull()
      const after = await deleteOptionValue(db, actor, set.id, valueId(set, 'Large'), { version: gone.version })
      expect(after.version).toBe(gone.version + 1)
      expect(after.values.map(v => v.name)).toEqual(['Small', 'Regular'])
      const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.option_set.value.delete'))
      expect(audit).toMatchObject({ targetId: set.id, metadata: { valueId: valueId(set, 'Large'), name: 'Large' } })
    })

    it('refuses an active value, a stale version, and one an item version uses', async () => {
      const set = await size()
      await expectApiError(() => deleteOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: set.version }), 409, 'INVALID_STATE')
      await itemWith(set)
      const gone = await archiveOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: set.version })
      await expectApiError(() => deleteOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: set.version }), 409, 'VERSION_CONFLICT')
      expect(gone.values.find(v => v.name === 'Small')?.deleteBlocker).toBe('items')
      await expectApiError(() => deleteOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: gone.version }), 409, 'OPTION_IN_USE')
      expect(await valueExists(valueId(set, 'Small'))).toBe(true)
    })

    it('the delete statement itself refuses an active value and one in use', async () => {
      const set = await size()
      await itemWith(set)
      const archived = await archiveOptionValue(db, actor, set.id, valueId(set, 'Small'), { version: set.version })
      // Added after the item: active, and no version uses it.
      const added = await addOptionValue(db, actor, set.id, { version: archived.version, name: 'Extra large' })
      await db.batch([deleteValueStatement(db, TEST_TENANT, set.id, valueId(set, 'Small')), deleteValueStatement(db, TEST_TENANT, set.id, valueId(added, 'Extra large'))])
      expect(await valueExists(valueId(set, 'Small'))).toBe(true)
      expect(await valueExists(valueId(added, 'Extra large'))).toBe(true)
    })
  })
})
