import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { menuModifierGroups, menuModifiers } from '#server/features/menu/menu.schema'
import { addModifier, archiveModifier, archiveModifierGroup, createModifierGroup, listModifierGroups, reorderModifiers, restoreModifier, restoreModifierGroup, updateModifier, updateModifierGroup } from '#server/features/menu/modifiers.service'
import { selectionProblem } from '#server/features/menu/modifiers.rules'
import { createTestDb, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'

let db: Db
const actor: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }

beforeEach(async () => {
  db = await createTestDb()
})

/** Milk: choose exactly one, Whole pre-selected. */
const milk = () => createModifierGroup(db, actor, {
  name: 'Milk',
  minSelect: 1,
  maxSelect: 1,
  modifiers: [
    { name: 'Whole', priceDeltaMinor: 0, isDefault: true },
    { name: 'Oat', priceDeltaMinor: 50, isDefault: false },
    { name: 'Soy', priceDeltaMinor: 50, isDefault: false },
  ],
})
const extras = () => createModifierGroup(db, actor, {
  name: 'Extras',
  minSelect: 0,
  maxSelect: null,
  modifiers: [{ name: 'Extra shot', priceDeltaMinor: 75, isDefault: false }],
})
const id = (group: ModifierGroup, name: string) => group.modifiers.find(m => m.name === name)!.id
const active = (group: ModifierGroup) => group.modifiers.filter(m => m.status === 'active').map(m => m.name)

describe('groups', () => {
  it('creates a group with its add-ons, prices and rules, audited', async () => {
    const group = await milk()
    expect(group).toMatchObject({ name: 'Milk', minSelect: 1, maxSelect: 1, status: 'active', version: 1 })
    expect(group.modifiers.map(m => [m.name, m.priceDeltaMinor, m.isDefault, m.sortOrder])).toEqual([['Whole', 0, true, 1], ['Oat', 50, false, 2], ['Soy', 50, false, 3]])
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, group.id))
    expect(row).toMatchObject({ action: 'menu.modifier_group.create', actorId: 'admin-1' })
  })

  it('refuses rules the add-ons can\'t meet', async () => {
    const base = { name: 'Syrup', modifiers: [{ name: 'Vanilla', priceDeltaMinor: 50, isDefault: true }, { name: 'Caramel', priceDeltaMinor: 50, isDefault: true }] }
    await expectApiError(() => createModifierGroup(db, actor, { ...base, minSelect: 3, maxSelect: null }), 422, 'SELECTION_RULES')
    await expectApiError(() => createModifierGroup(db, actor, { ...base, minSelect: 0, maxSelect: 1 }), 422, 'SELECTION_RULES')
    await expectApiError(() => createModifierGroup(db, actor, { ...base, minSelect: 2, maxSelect: 1 }), 422, 'SELECTION_RULES')
    expect(await db.select().from(menuModifierGroups)).toEqual([])
  })

  it('keeps active group names unique, ignoring case, even when two creates race', async () => {
    await milk()
    await expectApiError(() => createModifierGroup(db, actor, { name: 'MILK', minSelect: 0, maxSelect: null, modifiers: [{ name: 'A', priceDeltaMinor: 0, isDefault: false }] }), 409, 'MODIFIER_GROUP_NAME_TAKEN')
    const results = await Promise.allSettled([extras(), extras()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await db.select().from(menuModifiers).where(eq(menuModifiers.name, 'Extra shot'))).toHaveLength(1)
  })

  it('changes the rules, checked against the active add-ons', async () => {
    const group = await milk()
    const relaxed = await updateModifierGroup(db, actor, group.id, { version: 1, minSelect: 0, maxSelect: 2 })
    expect(relaxed).toMatchObject({ minSelect: 0, maxSelect: 2, version: 2 })
    await expectApiError(() => updateModifierGroup(db, actor, group.id, { version: 2, minSelect: 4 }), 422, 'SELECTION_RULES')
    const unlimited = await updateModifierGroup(db, actor, group.id, { version: 2, maxSelect: null, name: 'Milk choice' })
    expect(unlimited).toMatchObject({ maxSelect: null, name: 'Milk choice' })
  })

  it('refuses a stale version, also one that arrives between the check and the write', async () => {
    const group = await milk()
    await updateModifierGroup(db, actor, group.id, { version: 1, name: 'Milks' })
    await expectApiError(() => updateModifierGroup(db, actor, group.id, { version: 1, name: 'Milk' }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => db.update(menuModifierGroups).set({ version: 9 }).where(eq(menuModifierGroups.id, group.id)))
    await expectApiError(() => updateModifierGroup(racing, actor, group.id, { version: 2, name: 'Milk' }), 409, 'VERSION_CONFLICT')
  })

  it('archives and restores; an archived group can\'t be edited; a restored name must be free', async () => {
    const group = await milk()
    const archived = await archiveModifierGroup(db, actor, group.id, { version: 1 })
    await expectApiError(() => addModifier(db, actor, group.id, { version: archived.version, name: 'Almond', priceDeltaMinor: 50, isDefault: false }), 409, 'INVALID_STATE')
    const other = await extras()
    await expectApiError(() => restoreModifierGroup(db, actor, other.id, { version: 1 }), 409, 'INVALID_STATE')
    await createModifierGroup(db, actor, { name: 'milk', minSelect: 0, maxSelect: null, modifiers: [{ name: 'Any', priceDeltaMinor: 0, isDefault: false }] })
    await expectApiError(() => restoreModifierGroup(db, actor, group.id, { version: archived.version }), 409, 'MODIFIER_GROUP_NAME_TAKEN')
  })

  it('lists active groups by name, archived on request', async () => {
    const group = await milk()
    await extras()
    await archiveModifierGroup(db, actor, group.id, { version: 1 })
    expect((await listModifierGroups(db, { status: 'active' })).map(g => g.name)).toEqual(['Extras'])
    expect((await listModifierGroups(db, { status: 'archived' })).map(g => g.name)).toEqual(['Milk'])
  })
})

describe('add-ons', () => {
  it('adds, reprices and renames add-ons; names stay unique in the group', async () => {
    const group = await milk()
    const added = await addModifier(db, actor, group.id, { version: 1, name: 'Almond', priceDeltaMinor: 60, isDefault: false })
    expect(active(added)).toEqual(['Whole', 'Oat', 'Soy', 'Almond'])
    await expectApiError(() => addModifier(db, actor, group.id, { version: 2, name: 'oat', priceDeltaMinor: 0, isDefault: false }), 409, 'MODIFIER_NAME_TAKEN')
    const repriced = await updateModifier(db, actor, group.id, id(added, 'Oat'), { version: 2, priceDeltaMinor: 75, name: 'Oat milk' })
    expect(repriced.modifiers.find(m => m.name === 'Oat milk')).toMatchObject({ priceDeltaMinor: 75 })
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.modifier_group.modifier.update'))
    expect(audit!.metadata).toMatchObject({ from: 50, to: 75 })
  })

  it('keeps pre-selected add-ons within the maximum', async () => {
    const group = await milk()
    await expectApiError(() => updateModifier(db, actor, group.id, id(group, 'Oat'), { version: 1, isDefault: true }), 422, 'SELECTION_RULES')
    await expectApiError(() => addModifier(db, actor, group.id, { version: 1, name: 'Almond', priceDeltaMinor: 0, isDefault: true }), 422, 'SELECTION_RULES')
    // Moving the default: unset it first, then set another.
    const none = await updateModifier(db, actor, group.id, id(group, 'Whole'), { version: 1, isDefault: false })
    const oat = await updateModifier(db, actor, group.id, id(group, 'Oat'), { version: none.version, isDefault: true })
    expect(oat.modifiers.filter(m => m.isDefault).map(m => m.name)).toEqual(['Oat'])
  })

  it('keeps pre-selected add-ons within the maximum when another becomes pre-selected meanwhile', async () => {
    const group = await createModifierGroup(db, actor, { name: 'Size shot', minSelect: 0, maxSelect: 1, modifiers: [{ name: 'Single', priceDeltaMinor: 0, isDefault: false }, { name: 'Double', priceDeltaMinor: 75, isDefault: false }] })
    const racing = interleaved(db, () => db.update(menuModifiers).set({ isDefault: true }).where(eq(menuModifiers.name, 'Double')))
    await expectApiError(() => updateModifier(racing, actor, group.id, id(group, 'Single'), { version: 1, isDefault: true }), 422, 'SELECTION_RULES')
    expect((await db.select().from(menuModifiers).where(eq(menuModifiers.name, 'Single')))[0]!.isDefault).toBe(false)
  })

  it('keeps enough active add-ons for the minimum, and at least one', async () => {
    const group = await createModifierGroup(db, actor, { name: 'Sauce', minSelect: 2, maxSelect: null, modifiers: [{ name: 'Chili', priceDeltaMinor: 0, isDefault: false }, { name: 'Soy', priceDeltaMinor: 0, isDefault: false }] })
    await expectApiError(() => archiveModifier(db, actor, group.id, id(group, 'Chili'), { version: 1 }), 422, 'SELECTION_RULES')
    const single = await extras()
    await expectApiError(() => archiveModifier(db, actor, single.id, id(single, 'Extra shot'), { version: 1 }), 422, 'SELECTION_RULES')
  })

  it('still keeps the minimum when another add-on is archived between the check and the write', async () => {
    const group = await createModifierGroup(db, actor, { name: 'Sauce', minSelect: 2, maxSelect: null, modifiers: [{ name: 'Chili', priceDeltaMinor: 0, isDefault: false }, { name: 'Soy', priceDeltaMinor: 0, isDefault: false }, { name: 'Mayo', priceDeltaMinor: 0, isDefault: false }] })
    const racing = interleaved(db, () => db.update(menuModifiers).set({ status: 'archived' }).where(eq(menuModifiers.name, 'Soy')))
    await expectApiError(() => archiveModifier(racing, actor, group.id, id(group, 'Chili'), { version: 1 }), 422, 'SELECTION_RULES')
    expect((await db.select().from(menuModifiers).where(eq(menuModifiers.name, 'Chili')))[0]!.status).toBe('active')
  })

  it('archives an add-on (listed after the active ones) and restores it at the end', async () => {
    const group = await milk()
    const archived = await archiveModifier(db, actor, group.id, id(group, 'Soy'), { version: 1 })
    expect(active(archived)).toEqual(['Whole', 'Oat'])
    expect(archived.modifiers.at(-1)).toMatchObject({ name: 'Soy', status: 'archived' })
    await expectApiError(() => updateModifier(db, actor, group.id, id(group, 'Soy'), { version: archived.version, priceDeltaMinor: 10 }), 409, 'INVALID_STATE')
    const restored = await restoreModifier(db, actor, group.id, id(group, 'Soy'), { version: archived.version })
    expect(active(restored)).toEqual(['Whole', 'Oat', 'Soy'])
    await expectApiError(() => restoreModifier(db, actor, group.id, id(group, 'Soy'), { version: restored.version }), 409, 'INVALID_STATE')
  })

  it('reorders the active add-ons; the list must be exactly them', async () => {
    const group = await milk()
    const reordered = await reorderModifiers(db, actor, group.id, { version: 1, modifierIds: ['Soy', 'Whole', 'Oat'].map(n => id(group, n)) })
    expect(active(reordered)).toEqual(['Soy', 'Whole', 'Oat'])
    await expectApiError(() => reorderModifiers(db, actor, group.id, { version: reordered.version, modifierIds: [id(group, 'Soy')] }), 409, 'VERSION_CONFLICT')
  })

  it('answers 404 for an add-on of another group', async () => {
    const group = await milk()
    const other = await extras()
    await expectApiError(() => updateModifier(db, actor, group.id, id(other, 'Extra shot'), { version: 1, priceDeltaMinor: 0 }), 404, 'NOT_FOUND')
  })

  it('lets only one of two simultaneous edits of the same group through', async () => {
    const group = await milk()
    const results = await Promise.allSettled([
      addModifier(db, actor, group.id, { version: 1, name: 'Almond', priceDeltaMinor: 60, isDefault: false }),
      updateModifier(db, actor, group.id, id(group, 'Oat'), { version: 1, priceDeltaMinor: 70 }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
  })
})

describe('selection rules', () => {
  it('say what\'s wrong, one thing at a time', () => {
    expect(selectionProblem({ minSelect: 0, maxSelect: null, active: 3, defaults: 3 })).toBeUndefined()
    expect(selectionProblem({ minSelect: 2, maxSelect: 1, active: 3, defaults: 0 })?.field).toBe('maxSelect')
    expect(selectionProblem({ minSelect: 0, maxSelect: null, active: 0, defaults: 0 })?.message).toMatch(/at least one active add-on/)
    expect(selectionProblem({ minSelect: 0, maxSelect: null, active: 31, defaults: 0 })?.message).toMatch(/at most 30/)
    expect(selectionProblem({ minSelect: 2, maxSelect: null, active: 1, defaults: 0 })?.message).toBe('Customers must choose 2, but only 1 add-on is active.')
    expect(selectionProblem({ minSelect: 0, maxSelect: 1, active: 3, defaults: 2 })?.message).toBe('2 add-ons are pre-selected, but customers may choose at most 1.')
  })
})
