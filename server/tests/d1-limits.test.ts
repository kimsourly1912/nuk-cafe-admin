import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_AVAILABILITY_WINDOWS, MAX_TARGET_RULES } from '#shared/contracts/menu-availability'
import { MAX_ITEM_MODIFIER_GROUPS } from '#shared/contracts/menu-items'
import { MAX_SIBLINGS } from '#shared/contracts/menu-categories'
import { MAX_MODIFIERS } from '#shared/contracts/menu-modifiers'
import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import { MAX_MEMBERSHIPS } from '#shared/contracts/staff'
import { MAX_PAGE_SIZE } from '#shared/contracts/common'
import { member, organization } from '../db/tables'
import type { Actor } from '../features/identity'
import { createStaff, listStaff, updateStaffAccess } from '../features/identity/staff.service'
import { createAvailabilityRule, listAvailabilityRules } from '../features/menu/availability.service'
import { createCategory, listCategories, reorderCategories } from '../features/menu/categories.service'
import { createItem, updateItem } from '../features/menu/items.service'
import { createModifierGroup, listModifierGroups } from '../features/menu/modifiers.service'
import { createOptionSet, listOptionSets } from '../features/menu/options.service'
import type { Db } from '../utils/batch'
import { newId } from '../utils/ids'
import { createAdmin, createTestDb, createUser, D1_MAX_PARAMS } from './support/db'

/**
 * D1 refuses a statement with more than 100 bound parameters (D62); the test database does too.
 * Each test runs a write or read at the largest size the contracts allow.
 */

let db: Db
const actor: Actor = { userId: 'admin-1', role: 'admin', requestId: 'req-1' }

beforeEach(async () => {
  db = await createTestDb()
})

const names = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix} ${String(i + 1).padStart(3, '0')}`)

it('the test database refuses what D1 refuses', async () => {
  const list = (n: number) => sql.join(Array.from({ length: n }, () => sql`${1}`), sql`, `)
  await expect(db.run(sql`select 1 in (${list(D1_MAX_PARAMS)})`)).resolves.toBeDefined()
  const error = await db.run(sql`select 1 in (${list(D1_MAX_PARAMS + 1)})`).then(() => undefined, (e: Error) => e)
  expect(String((error?.cause as Error | undefined)?.message)).toMatch(/too many SQL variables/)
})

describe('menu at its limits', () => {
  it('creates an option set and an add-on group at their maximum size', async () => {
    expect((await createOptionSet(db, actor, { name: 'Size', values: names(MAX_OPTION_VALUES, 'Size') })).values).toHaveLength(MAX_OPTION_VALUES)
    const group = await createModifierGroup(db, actor, { name: 'Syrups', minSelect: 0, maxSelect: null, modifiers: names(MAX_MODIFIERS, 'Syrup').map(name => ({ name, priceDeltaMinor: 50, isDefault: false })) })
    expect(group.modifiers).toHaveLength(MAX_MODIFIERS)
  })

  it('lists more option sets and add-on groups than fit in one statement', async () => {
    for (const name of names(120, 'Set')) {
      await createOptionSet(db, actor, { name, values: ['A'] })
      await createModifierGroup(db, actor, { name, minSelect: 0, maxSelect: null, modifiers: [{ name: 'A', priceDeltaMinor: 0, isDefault: false }] })
    }
    const sets = await listOptionSets(db, { status: 'active' })
    expect(sets).toHaveLength(120)
    expect(sets.every(s => s.values.length === 1)).toBe(true)
    const groups = await listModifierGroups(db, { status: 'active' })
    expect(groups).toHaveLength(120)
    expect(groups.every(g => g.modifiers.length === 1)).toBe(true)
  })

  it('reorders the maximum number of sibling categories', async () => {
    const created = []
    for (const name of names(MAX_SIBLINGS, 'Category')) created.push(await createCategory(db, actor, { name, description: '', parentId: null, availabilityRuleIds: [] }))
    const reordered = await reorderCategories(db, actor, { parentId: null, items: [...created].reverse().map(c => ({ id: c.id, version: c.version })) })
    expect(reordered.map(c => c.id)).toEqual([...created].reverse().map(c => c.id))
    expect(await listCategories(db, { status: 'active' })).toHaveLength(MAX_SIBLINGS)
  })

  it('writes and retires the largest price grid (20 × 20 versions)', async () => {
    const drinks = await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
    const size = await createOptionSet(db, actor, { name: 'Size', values: names(MAX_OPTION_VALUES, 'Size') })
    const milk = await createOptionSet(db, actor, { name: 'Milk', values: names(MAX_OPTION_VALUES, 'Milk') })
    const variations = size.values.flatMap(s => milk.values.map(m => ({ valueIds: [s.id, m.id], priceMinor: 300, status: 'active' as const })))
    const item = await createItem(db, actor, { categoryId: drinks.id, name: 'Latte', description: '', imageId: null, optionSetIds: [size.id, milk.id], variations, modifierGroups: [], availabilityRuleIds: [] })
    expect(item.variations).toHaveLength(400)
    const single = await updateItem(db, actor, item.id, { version: item.version, optionSetIds: [size.id], variations: size.values.map(s => ({ valueIds: [s.id], priceMinor: 300, status: 'active' as const })) })
    expect(single.variations).toHaveLength(MAX_OPTION_VALUES)
  })

  it('offers the most add-on groups, each with its own price for every add-on', async () => {
    const drinks = await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
    const groups = []
    for (const name of names(MAX_ITEM_MODIFIER_GROUPS, 'Group')) {
      groups.push(await createModifierGroup(db, actor, { name, minSelect: 0, maxSelect: null, modifiers: names(MAX_MODIFIERS, 'Extra').map(n => ({ name: n, priceDeltaMinor: 50, isDefault: false })) }))
    }
    const modifierGroups = groups.map(g => ({ groupId: g.id, rules: null, prices: g.modifiers.map(m => ({ modifierId: m.id, priceDeltaMinor: 60 })) }))
    const item = await createItem(db, actor, { categoryId: drinks.id, name: 'Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    const updated = await updateItem(db, actor, item.id, { version: item.version, modifierGroups })
    expect(updated.modifierGroups.flatMap(g => g.modifiers).filter(m => m.priceOverridden)).toHaveLength(MAX_ITEM_MODIFIER_GROUPS * MAX_MODIFIERS)
  })
})

describe('availability rules at their limits', () => {
  it('creates a rule with the most windows, and gives an item and a category the most rules', async () => {
    const windows = [1, 2, 3, 4, 5, 6, 7].flatMap(weekday => [0, 120, 240].map(start => ({ weekday, startMinute: start, endMinute: start + 60 })))
    expect(windows).toHaveLength(MAX_AVAILABILITY_WINDOWS)
    const rule = await createAvailabilityRule(db, actor, { name: 'Busy', windows })
    expect(rule.windows).toHaveLength(MAX_AVAILABILITY_WINDOWS)
    const ruleIds = [rule.id]
    for (const name of names(MAX_TARGET_RULES - 1, 'Rule')) ruleIds.push((await createAvailabilityRule(db, actor, { name, windows: [{ weekday: 1, startMinute: 0, endMinute: 60 }] })).id)
    const drinks = await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: ruleIds })
    const item = await createItem(db, actor, { categoryId: drinks.id, name: 'Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }], modifierGroups: [], availabilityRuleIds: ruleIds })
    expect([drinks.availabilityRules.length, item.availabilityRules.length]).toEqual([MAX_TARGET_RULES, MAX_TARGET_RULES])
  })

  it('lists more rules than fit in one statement', async () => {
    for (const name of names(120, 'Rule')) await createAvailabilityRule(db, actor, { name, windows: [{ weekday: 1, startMinute: 0, endMinute: 60 }] })
    const rules = await listAvailabilityRules(db, { status: 'active' })
    expect(rules).toHaveLength(120)
    expect(rules.every(r => r.windows.length === 1)).toBe(true)
  })
})

describe('staff at their limits', () => {
  it('gives one person the most branches, and lists a full page of staff', async () => {
    const admin = await createAdmin(db)
    const owner: Actor = { userId: admin.userId, role: 'admin' }
    const branchIds = Array.from({ length: MAX_MEMBERSHIPS }, () => newId())
    for (const [i, id] of branchIds.entries()) await db.insert(organization).values({ id, name: `Branch ${i}`, slug: id, timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
    const memberships = branchIds.map(branchId => ({ branchId, role: 'staff' as const }))
    const created = await createStaff(db, owner, { name: 'Sophea', email: 'sophea@example.com', admin: false, memberships })
    expect(created.staff.memberships).toHaveLength(MAX_MEMBERSHIPS)
    const changed = await updateStaffAccess(db, owner, created.staff.id, { version: created.staff.version, admin: false, memberships: memberships.map(m => ({ ...m, role: 'manager' as const })) })
    expect(changed.memberships.every(m => m.role === 'manager')).toBe(true)

    // Accounts with a membership, written directly: createStaff would hash 100 passwords.
    for (let i = 0; i < MAX_PAGE_SIZE; i++) {
      const account = await createUser(db, `staff${i}@example.com`, `Staff ${i}`)
      await db.insert(member).values({ id: newId(), organizationId: branchIds[0]!, userId: account.id, role: 'staff', createdAt: new Date() })
    }
    const page = await listStaff(db, { page: 1, pageSize: MAX_PAGE_SIZE })
    expect(page.items).toHaveLength(MAX_PAGE_SIZE)
  })
})
