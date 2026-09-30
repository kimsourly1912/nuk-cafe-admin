import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AvailabilityRule, AvailabilityWindow } from '#shared/contracts/menu-availability'
import type { CreateItemInput } from '#shared/contracts/menu-items'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { archiveAvailabilityRule, createAvailabilityRule, getAvailabilityRule, listAvailabilityRules, restoreAvailabilityRule, updateAvailabilityRule } from '#server/features/menu/availability.service'
import { archiveCategory, createCategory, listCategories, updateCategory } from '#server/features/menu/categories.service'
import { archiveItem, createItem, getItem, restoreItem, updateItem } from '#server/features/menu/items.service'
import { menuAvailabilityRules } from '#server/features/menu/menu.schema'
import { createTestDb } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'

let db: Db
const actor: Actor = { userId: 'admin-1', role: 'admin', requestId: 'req-1' }
let drinks: string
let hot: string

beforeEach(async () => {
  db = await createTestDb()
  drinks = (await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })).id
  hot = (await createCategory(db, actor, { name: 'Hot drinks', description: '', parentId: drinks, availabilityRuleIds: [] })).id
})

const w = (weekday: number, startMinute: number, endMinute: number): AvailabilityWindow => ({ weekday, startMinute, endMinute })
const weekdays = (start: number, end: number) => [1, 2, 3, 4, 5].map(day => w(day, start, end))
const breakfast = () => createAvailabilityRule(db, actor, { name: 'Breakfast', windows: weekdays(420, 660) })
const lateNight = () => createAvailabilityRule(db, actor, { name: 'Late night', windows: [w(5, 1320, 120), w(6, 1320, 120)] })
const latte = (availabilityRuleIds: string[], database: Db = db, overrides: Partial<CreateItemInput> = {}) => createItem(database, actor, {
  categoryId: hot,
  name: 'Latte',
  description: '',
  imageId: null,
  optionSetIds: [],
  variations: [{ valueIds: [], priceMinor: 350, status: 'active' }],
  modifierGroups: [],
  availabilityRuleIds,
  ...overrides,
})
/** Archives the rule behind the service's back (another admin's write). */
const archiveDirectly = (rule: AvailabilityRule) => db.update(menuAvailabilityRules).set({ status: 'archived' }).where(eq(menuAvailabilityRules.id, rule.id))
const ruleNames = (target: { availabilityRules: { name: string }[] }) => target.availabilityRules.map(r => r.name)

describe('availability rules', () => {
  it('creates a rule with its windows in order, audited', async () => {
    const rule = await createAvailabilityRule(db, actor, { name: 'Brunch', windows: [w(7, 600, 840), w(6, 600, 840)] })
    expect(rule).toMatchObject({ name: 'Brunch', status: 'active', version: 1, itemCount: 0, categoryCount: 0 })
    expect(rule.windows).toEqual([w(6, 600, 840), w(7, 600, 840)])
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, rule.id))
    expect(row).toMatchObject({ action: 'menu.availability_rule.create', actorId: 'admin-1', requestId: 'req-1' })
  })

  it('keeps overnight windows as entered', async () => {
    expect((await lateNight()).windows).toEqual([w(5, 1320, 120), w(6, 1320, 120)])
  })

  it('refuses overlapping windows, naming the window', async () => {
    await expectApiError(() => createAvailabilityRule(db, actor, { name: 'Late', windows: [w(2, 60, 180), w(1, 1320, 120)] }), 422, 'AVAILABILITY_WINDOWS', ['windows.1'])
    const rule = await breakfast()
    await expectApiError(() => updateAvailabilityRule(db, actor, rule.id, { version: 1, windows: [w(1, 420, 660), w(1, 600, 700)] }), 422, 'AVAILABILITY_WINDOWS', ['windows.1'])
  })

  it('lists active rules by name, archived on request', async () => {
    const b = await breakfast()
    await lateNight()
    await createAvailabilityRule(db, actor, { name: 'afternoon', windows: [w(1, 840, 1020)] })
    await archiveAvailabilityRule(db, actor, b.id, { version: 1 })
    expect((await listAvailabilityRules(db, { status: 'active' })).map(r => r.name)).toEqual(['afternoon', 'Late night'])
    expect((await listAvailabilityRules(db, { status: 'archived' })).map(r => r.name)).toEqual(['Breakfast'])
    expect(await listAvailabilityRules(db, { status: 'all' })).toHaveLength(3)
  })

  it('keeps active rule names unique, ignoring case, even when two creates race', async () => {
    await breakfast()
    await expectApiError(() => createAvailabilityRule(db, actor, { name: 'BREAKFAST', windows: [w(1, 0, 60)] }), 409, 'AVAILABILITY_RULE_NAME_TAKEN')
    const results = await Promise.allSettled([
      createAvailabilityRule(db, actor, { name: 'Lunch', windows: [w(1, 660, 840)] }),
      createAvailabilityRule(db, actor, { name: 'lunch', windows: [w(2, 660, 840)] }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await listAvailabilityRules(db, { status: 'all' })).toHaveLength(2)
  })

  it('renames and replaces the windows, moving the version on; absent fields keep', async () => {
    const rule = await breakfast()
    const renamed = await updateAvailabilityRule(db, actor, rule.id, { version: 1, name: 'Morning' })
    expect(renamed).toMatchObject({ name: 'Morning', version: 2, windows: rule.windows })
    const moved = await updateAvailabilityRule(db, actor, rule.id, { version: 2, windows: [w(6, 480, 720)] })
    expect(moved).toMatchObject({ name: 'Morning', version: 3, windows: [w(6, 480, 720)] })
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.availability_rule.update'))
    expect(rows.at(-1)!.metadata).toMatchObject({ windows: { from: rule.windows, to: [w(6, 480, 720)] } })
  })

  it('refuses a stale version, also one that arrives between the check and the write', async () => {
    const rule = await breakfast()
    await updateAvailabilityRule(db, actor, rule.id, { version: 1, name: 'Morning' })
    await expectApiError(() => updateAvailabilityRule(db, actor, rule.id, { version: 1, windows: [w(1, 0, 60)] }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => db.update(menuAvailabilityRules).set({ version: 3 }).where(eq(menuAvailabilityRules.id, rule.id)))
    await expectApiError(() => updateAvailabilityRule(racing, actor, rule.id, { version: 2, windows: [w(1, 0, 60)] }), 409, 'VERSION_CONFLICT')
    expect((await getAvailabilityRule(db, rule.id)).windows).toEqual(rule.windows)
  })

  it('archives and restores; an archived rule can\'t be edited; a restored name must be free', async () => {
    const rule = await breakfast()
    const archived = await archiveAvailabilityRule(db, actor, rule.id, { version: 1 })
    expect(archived.status).toBe('archived')
    await expectApiError(() => updateAvailabilityRule(db, actor, rule.id, { version: archived.version, name: 'X' }), 409, 'INVALID_STATE')
    await expectApiError(() => archiveAvailabilityRule(db, actor, rule.id, { version: archived.version }), 409, 'INVALID_STATE')

    const other = await createAvailabilityRule(db, actor, { name: 'breakfast', windows: [w(1, 0, 60)] })
    await expectApiError(() => restoreAvailabilityRule(db, actor, rule.id, { version: archived.version }), 409, 'AVAILABILITY_RULE_NAME_TAKEN')
    await archiveAvailabilityRule(db, actor, other.id, { version: 1 })
    await expect(restoreAvailabilityRule(db, actor, rule.id, { version: archived.version })).resolves.toMatchObject({ status: 'active' })
    await expectApiError(() => restoreAvailabilityRule(db, actor, rule.id, { version: archived.version + 1 }), 409, 'INVALID_STATE')
  })

  it('is not found when it doesn\'t exist', async () => {
    await expectApiError(() => getAvailabilityRule(db, '0192f7a0-0000-7000-8000-000000000000'), 404, 'NOT_FOUND')
  })
})

describe('rules in use', () => {
  it('counts drafts and active items, and active categories, but not archived ones', async () => {
    const rule = await breakfast()
    const item = await latte([rule.id])
    await latte([rule.id], db, { name: 'Mocha' })
    await updateCategory(db, actor, drinks, { version: 1, availabilityRuleIds: [rule.id] })
    expect(await getAvailabilityRule(db, rule.id)).toMatchObject({ itemCount: 2, categoryCount: 1 })

    await archiveItem(db, actor, item.id, { version: item.version })
    await archiveCategory(db, actor, drinks, { version: 2 })
    expect(await getAvailabilityRule(db, rule.id)).toMatchObject({ itemCount: 1, categoryCount: 0 })
  })

  it('can\'t be archived while an item or category uses it', async () => {
    const rule = await breakfast()
    const item = await latte([rule.id])
    await expectApiError(() => archiveAvailabilityRule(db, actor, rule.id, { version: 1 }), 409, 'AVAILABILITY_RULE_IN_USE')
    await updateItem(db, actor, item.id, { version: item.version, availabilityRuleIds: [] })

    const category = await updateCategory(db, actor, drinks, { version: 1, availabilityRuleIds: [rule.id] })
    await expectApiError(() => archiveAvailabilityRule(db, actor, rule.id, { version: 1 }), 409, 'AVAILABILITY_RULE_IN_USE')
    await updateCategory(db, actor, drinks, { version: category.version, availabilityRuleIds: [] })
    await expect(archiveAvailabilityRule(db, actor, rule.id, { version: 1 })).resolves.toMatchObject({ status: 'archived' })
  })

  it('can\'t be archived when an item starts using it between the check and the write', async () => {
    const rule = await breakfast()
    const racing = interleaved(db, () => latte([rule.id]))
    await expectApiError(() => archiveAvailabilityRule(racing, actor, rule.id, { version: 1 }), 409, 'AVAILABILITY_RULE_IN_USE')
    expect((await getAvailabilityRule(db, rule.id)).status).toBe('active')
  })

  it('can\'t be archived when a category starts using it between the check and the write', async () => {
    const rule = await breakfast()
    const racing = interleaved(db, () => updateCategory(db, actor, hot, { version: 1, availabilityRuleIds: [rule.id] }))
    await expectApiError(() => archiveAvailabilityRule(racing, actor, rule.id, { version: 1 }), 409, 'AVAILABILITY_RULE_IN_USE')
  })
})

describe('rules on items', () => {
  it('stores the chosen rules, shown by name; absent keeps, [] removes', async () => {
    const b = await breakfast()
    const n = await lateNight()
    const item = await latte([n.id, b.id])
    expect(ruleNames(item)).toEqual(['Breakfast', 'Late night'])
    const renamed = await updateItem(db, actor, item.id, { version: item.version, name: 'Flat white' })
    expect(ruleNames(renamed)).toEqual(['Breakfast', 'Late night'])
    const one = await updateItem(db, actor, item.id, { version: renamed.version, availabilityRuleIds: [n.id] })
    expect(ruleNames(one)).toEqual(['Late night'])
    const none = await updateItem(db, actor, item.id, { version: one.version, availabilityRuleIds: [] })
    expect(none.availabilityRules).toEqual([])
    const [audit] = (await db.select().from(auditEvents).where(eq(auditEvents.targetId, item.id))).slice(-1)
    expect(audit!.metadata).toMatchObject({ fields: ['availabilityRuleIds'] })
  })

  it('refuses an unknown or archived rule, naming its position', async () => {
    const b = await breakfast()
    const n = await lateNight()
    await archiveAvailabilityRule(db, actor, n.id, { version: 1 })
    await expectApiError(() => latte([b.id, n.id]), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.1'])
    await expectApiError(() => latte(['0192f7a0-0000-7000-8000-000000000000']), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.0'])
    const item = await latte([b.id])
    await expectApiError(() => updateItem(db, actor, item.id, { version: item.version, availabilityRuleIds: [b.id, n.id] }), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.1'])
  })

  it('refuses a rule archived between the check and the write, on create and update', async () => {
    const b = await breakfast()
    await expectApiError(() => latte([b.id], interleaved(db, () => archiveDirectly(b))), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.0'])
    expect(await db.select().from(menuAvailabilityRules)).toHaveLength(1)

    const n = await lateNight()
    const item = await latte([])
    const racing = interleaved(db, () => db.update(menuAvailabilityRules).set({ status: 'archived' }).where(eq(menuAvailabilityRules.id, n.id)))
    await expectApiError(() => updateItem(racing, actor, item.id, { version: item.version, availabilityRuleIds: [n.id] }), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.0'])
    expect((await getItem(db, item.id)).availabilityRules).toEqual([])
  })

  it('keeps an archived rule the item already uses, so the form can send it back', async () => {
    const b = await breakfast()
    const n = await lateNight()
    const item = await latte([b.id])
    const archivedItem = await archiveItem(db, actor, item.id, { version: item.version })
    await archiveAvailabilityRule(db, actor, b.id, { version: 1 })
    const restored = await restoreItem(db, actor, item.id, { version: archivedItem.version })
    expect(restored.availabilityRules).toEqual([{ id: b.id, name: 'Breakfast', status: 'archived' }])
    const updated = await updateItem(db, actor, item.id, { version: restored.version, availabilityRuleIds: [b.id, n.id] })
    expect(updated.availabilityRules.map(r => [r.name, r.status])).toEqual([['Breakfast', 'archived'], ['Late night', 'active']])
  })
})

describe('rules on categories', () => {
  it('stores the chosen rules on create and update, and lists them in the tree', async () => {
    const b = await breakfast()
    const food = await createCategory(db, actor, { name: 'Food', description: '', parentId: null, availabilityRuleIds: [b.id] })
    expect(ruleNames(food)).toEqual(['Breakfast'])
    const tree = await listCategories(db, { status: 'active' })
    expect(tree.map(c => [c.name, ruleNames(c)])).toEqual([['Drinks', []], ['Hot drinks', []], ['Food', ['Breakfast']]])
    const renamed = await updateCategory(db, actor, food.id, { version: food.version, name: 'Kitchen' })
    expect(ruleNames(renamed)).toEqual(['Breakfast'])
    const none = await updateCategory(db, actor, food.id, { version: renamed.version, availabilityRuleIds: [] })
    expect(none.availabilityRules).toEqual([])
  })

  it('refuses an archived rule, also one archived between the check and the write', async () => {
    const b = await breakfast()
    const n = await lateNight()
    await archiveAvailabilityRule(db, actor, n.id, { version: 1 })
    await expectApiError(() => createCategory(db, actor, { name: 'Food', description: '', parentId: null, availabilityRuleIds: [n.id] }), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.0'])

    const racingCreate = interleaved(db, () => archiveDirectly(b))
    await expectApiError(() => createCategory(racingCreate, actor, { name: 'Food', description: '', parentId: null, availabilityRuleIds: [b.id] }), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.0'])
    expect((await listCategories(db, { status: 'all' })).map(c => c.name)).toEqual(['Drinks', 'Hot drinks'])

    const c = await createAvailabilityRule(db, actor, { name: 'Lunch', windows: [w(1, 660, 840)] })
    const racingUpdate = interleaved(db, () => db.update(menuAvailabilityRules).set({ status: 'archived' }).where(eq(menuAvailabilityRules.id, c.id)))
    await expectApiError(() => updateCategory(racingUpdate, actor, hot, { version: 1, availabilityRuleIds: [c.id] }), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE', ['availabilityRuleIds.0'])
  })
})
