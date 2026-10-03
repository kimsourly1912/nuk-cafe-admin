import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateItemInput } from '#shared/contracts/menu-items'
import type { Actor, BranchActor } from '#server/features/identity'
import { assetUrls, countUploads, getAsset, uploadImage } from '#server/features/media/media.service'
import type { ObjectStore } from '#server/features/media/media.service'
import { createAvailabilityRule, getAvailabilityRule, listAvailabilityRules, updateAvailabilityRule } from '#server/features/menu/availability.service'
import { getPublicMenu, loadCatalog } from '#server/features/menu/catalog.service'
import { archiveCategory, createCategory, getCategory, listCategories, reorderCategories, updateCategory } from '#server/features/menu/categories.service'
import { archiveItem, createItem, getItem, listItems, publishItem, reorderItems, updateItem } from '#server/features/menu/items.service'
import { addModifier, createModifierGroup, getModifierGroup, listModifierGroups, updateModifierGroup } from '#server/features/menu/modifiers.service'
import { addOptionValue, createOptionSet, getOptionSet, listOptionSets, renameOptionSet } from '#server/features/menu/options.service'
import { countMenuData, deleteAllMenuStatements } from '#server/features/menu/reset.repository'
import { listSoldOut, setSoldOut } from '#server/features/menu/soldout.service'
import { createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db, Statement } from '#server/utils/batch'

/**
 * Tenant isolation for the menu and its uploads (D136, multi-tenant plan → Rules): another
 * tenant's records can't be read, changed or linked to, and their names don't clash.
 */

const OTHER = 'tenant-2'
const ours: Actor = { userId: 'our-owner', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }
const theirs: Actor = { userId: 'their-owner', tenantId: OTHER, role: 'owner', requestId: 'req-2' }
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array.from({ length: 32 }, (_, i) => i)])
const store: ObjectStore = { put: async () => undefined, del: async () => undefined }

let db: Db
/** Our tenant's menu: a published item using every library, with a photo. */
let menu: Awaited<ReturnType<typeof ourMenu>>

async function ourMenu() {
  await insertBranch(db, { id: 'our-branch', name: 'Ours', timezone: 'Asia/Phnom_Penh' })
  const drinks = await createCategory(db, ours, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
  const rule = await createAvailabilityRule(db, ours, { name: 'Mornings', windows: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] })
  const coffee = await createCategory(db, ours, { name: 'Coffee', description: '', parentId: drinks.id, availabilityRuleIds: [rule.id] })
  const size = await createOptionSet(db, ours, { name: 'Size', values: ['Regular', 'Large'] })
  const milk = await createModifierGroup(db, ours, { name: 'Milk', minSelect: 0, maxSelect: 1, modifiers: [{ name: 'Oat', priceDeltaMinor: 50, isDefault: false }] })
  const image = await uploadImage(db, store, ours, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })
  const created = await createItem(db, ours, {
    categoryId: coffee.id,
    name: 'Latte',
    description: '',
    imageId: image.id,
    optionSetIds: [size.id],
    variations: size.values.map(v => ({ valueIds: [v.id], priceMinor: 350, status: 'active' as const })),
    modifierGroups: [{ groupId: milk.id, rules: null, prices: [] }],
    availabilityRuleIds: [rule.id],
  })
  const item = await publishItem(db, ours, created.id, { version: created.version })
  return { drinks, coffee, rule, size, milk, image, item }
}

/** An item for their tenant, in their own category unless told otherwise. */
async function theirItem(categoryId: string, change: Partial<CreateItemInput> = {}) {
  return createItem(db, theirs, { categoryId, name: 'Tea', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 200, status: 'active' }], modifierGroups: [], availabilityRuleIds: [], ...change })
}

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  menu = await ourMenu()
})

describe('menu tenants', () => {
  it('lists none of another tenant\'s records, and reads none of them by id', async () => {
    expect(await listCategories(db, OTHER, { status: 'all' })).toEqual([])
    expect(await listOptionSets(db, OTHER, { status: 'all' })).toEqual([])
    expect(await listModifierGroups(db, OTHER, { status: 'all' })).toEqual([])
    expect(await listAvailabilityRules(db, OTHER, { status: 'all' })).toEqual([])
    expect((await listItems(db, OTHER, { page: 1, pageSize: 20, status: 'all' })).total).toBe(0)
    // A filter naming our records still lists only theirs.
    expect((await listItems(db, OTHER, { page: 1, pageSize: 20, categoryId: menu.coffee.id })).total).toBe(0)
    expect((await listItems(db, OTHER, { page: 1, pageSize: 20, modifierGroupId: menu.milk.id })).total).toBe(0)

    await expectApiError(() => getCategory(db, OTHER, menu.coffee.id), 404, 'NOT_FOUND')
    await expectApiError(() => getOptionSet(db, OTHER, menu.size.id), 404, 'NOT_FOUND')
    await expectApiError(() => getModifierGroup(db, OTHER, menu.milk.id), 404, 'NOT_FOUND')
    await expectApiError(() => getAvailabilityRule(db, OTHER, menu.rule.id), 404, 'NOT_FOUND')
    await expectApiError(() => getItem(db, OTHER, menu.item.id), 404, 'NOT_FOUND')

    // Ours are all there, with their counts.
    expect((await listCategories(db, TEST_TENANT, { status: 'all' })).map(c => [c.name, c.childCount, c.itemCount])).toEqual([['Drinks', 1, 0], ['Coffee', 0, 1]])
    expect((await getItem(db, TEST_TENANT, menu.item.id)).image?.url).toBe(menu.image.url)
  })

  it('refuses every write to another tenant\'s records, changing nothing', async () => {
    await expectApiError(() => updateCategory(db, theirs, menu.coffee.id, { version: menu.coffee.version, name: 'Mine' }), 404, 'NOT_FOUND')
    await expectApiError(() => archiveCategory(db, theirs, menu.drinks.id, { version: menu.drinks.version }), 404, 'NOT_FOUND')
    await expectApiError(() => renameOptionSet(db, theirs, menu.size.id, { version: menu.size.version, name: 'Mine' }), 404, 'NOT_FOUND')
    await expectApiError(() => addOptionValue(db, theirs, menu.size.id, { version: menu.size.version, name: 'Huge' }), 404, 'NOT_FOUND')
    await expectApiError(() => updateModifierGroup(db, theirs, menu.milk.id, { version: menu.milk.version, name: 'Mine' }), 404, 'NOT_FOUND')
    await expectApiError(() => addModifier(db, theirs, menu.milk.id, { version: menu.milk.version, name: 'Soy', priceDeltaMinor: 0, isDefault: false }), 404, 'NOT_FOUND')
    await expectApiError(() => updateAvailabilityRule(db, theirs, menu.rule.id, { version: menu.rule.version, name: 'Mine' }), 404, 'NOT_FOUND')
    await expectApiError(() => updateItem(db, theirs, menu.item.id, { version: menu.item.version, name: 'Mine' }), 404, 'NOT_FOUND')
    await expectApiError(() => archiveItem(db, theirs, menu.item.id, { version: menu.item.version }), 404, 'NOT_FOUND')

    expect((await getCategory(db, TEST_TENANT, menu.coffee.id)).version).toBe(menu.coffee.version)
    expect((await getOptionSet(db, TEST_TENANT, menu.size.id)).version).toBe(menu.size.version)
    expect((await getModifierGroup(db, TEST_TENANT, menu.milk.id)).version).toBe(menu.milk.version)
    expect((await getAvailabilityRule(db, TEST_TENANT, menu.rule.id)).version).toBe(menu.rule.version)
    expect(await getItem(db, TEST_TENANT, menu.item.id)).toMatchObject({ name: 'Latte', status: 'active', version: menu.item.version })
  })

  it('refuses links from their records to ours: category, parent, option set, add-on group, rule, photo', async () => {
    const their = await createCategory(db, theirs, { name: 'Hot', description: '', parentId: null, availabilityRuleIds: [] })
    await expectApiError(() => theirItem(menu.coffee.id), 422, 'CATEGORY_NOT_AVAILABLE')
    await expectApiError(() => createCategory(db, theirs, { name: 'Tea', description: '', parentId: menu.drinks.id, availabilityRuleIds: [] }), 422, 'PARENT_NOT_AVAILABLE')
    await expectApiError(() => updateCategory(db, theirs, their.id, { version: their.version, parentId: menu.drinks.id }), 422, 'PARENT_NOT_AVAILABLE')
    await expectApiError(() => createCategory(db, theirs, { name: 'Tea', description: '', parentId: null, availabilityRuleIds: [menu.rule.id] }), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE')
    await expectApiError(() => theirItem(their.id, { optionSetIds: [menu.size.id], variations: [{ valueIds: [menu.size.values[0]!.id], priceMinor: 200, status: 'active' }] }), 422, 'OPTION_SET_NOT_AVAILABLE')
    await expectApiError(() => theirItem(their.id, { modifierGroups: [{ groupId: menu.milk.id, rules: null, prices: [] }] }), 422, 'MODIFIER_GROUP_NOT_AVAILABLE')
    await expectApiError(() => theirItem(their.id, { availabilityRuleIds: [menu.rule.id] }), 422, 'AVAILABILITY_RULE_NOT_AVAILABLE')
    // Our photo is temporary again once we drop it; it's still not theirs to use.
    const fresh = await uploadImage(db, store, ours, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })
    await expectApiError(() => theirItem(their.id, { imageId: fresh.id }), 422, 'MEDIA_NOT_AVAILABLE')
    expect((await listItems(db, OTHER, { page: 1, pageSize: 20, status: 'all' })).total).toBe(0)
  })

  it('reorders only the tenant\'s own records', async () => {
    await expectApiError(() => reorderItems(db, theirs, { categoryId: menu.coffee.id, items: [{ id: menu.item.id, version: menu.item.version }] }), 409, 'VERSION_CONFLICT')
    await expectApiError(() => reorderCategories(db, theirs, { parentId: null, items: [{ id: menu.drinks.id, version: menu.drinks.version }] }), 409, 'VERSION_CONFLICT')
    await expectApiError(() => reorderCategories(db, theirs, { parentId: menu.drinks.id, items: [{ id: menu.coffee.id, version: menu.coffee.version }] }), 409, 'VERSION_CONFLICT')
    expect((await getItem(db, TEST_TENANT, menu.item.id)).version).toBe(menu.item.version)
    expect((await getCategory(db, TEST_TENANT, menu.drinks.id)).version).toBe(menu.drinks.version)
  })

  it('lets each tenant use the same names', async () => {
    const drinks = await createCategory(db, theirs, { name: 'drinks', description: '', parentId: null, availabilityRuleIds: [] })
    // Their top level is their own: the first category comes first, after none of ours.
    expect(drinks.sortOrder).toBe(1)
    await createCategory(db, theirs, { name: 'Coffee', description: '', parentId: drinks.id, availabilityRuleIds: [] })
    await createOptionSet(db, theirs, { name: 'Size', values: ['Regular'] })
    await createModifierGroup(db, theirs, { name: 'Milk', minSelect: 0, maxSelect: null, modifiers: [{ name: 'Oat', priceDeltaMinor: 0, isDefault: false }] })
    await createAvailabilityRule(db, theirs, { name: 'Mornings', windows: [{ weekday: 1, startMinute: 0, endMinute: 600 }] })
    // Within one tenant a name still clashes.
    await expectApiError(() => createOptionSet(db, theirs, { name: 'size', values: ['Small'] }), 409, 'OPTION_SET_NAME_TAKEN')
  })

  it('shows customers only the tenant\'s own menu', async () => {
    await insertBranch(db, { id: 'their-branch', name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
    const monday = new Date('2026-10-05T03:00:00Z')
    const names = (m: Awaited<ReturnType<typeof getPublicMenu>>) => m.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).map(i => i.name)
    expect(names(await getPublicMenu(db, TEST_TENANT, { branchId: 'our-branch' }, monday))).toEqual(['Latte'])
    expect((await getPublicMenu(db, OTHER, { branchId: 'their-branch' }, monday)).categories).toEqual([])
    expect(await loadCatalog(db, OTHER)).toEqual({ categories: [], items: [], rules: {} })
  })

  it('switches only the tenant\'s own versions sold out', async () => {
    await insertBranch(db, { id: 'their-branch', name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
    const atTheirs: BranchActor = { ...theirs, branchId: 'their-branch' }
    await expectApiError(() => setSoldOut(db, atTheirs, { variationIds: [menu.item.variations[0]!.id], soldOut: true }), 422, 'VARIATION_NOT_AVAILABLE')
    expect((await listSoldOut(db, atTheirs)).variations).toEqual([])
  })

  it('keeps uploads to their tenant: reads, URLs, counts and the reset', async () => {
    expect(await getAsset(db, OTHER, menu.image.id)).toBeUndefined()
    expect(await assetUrls(db, OTHER, [menu.image.id])).toEqual(new Map())
    expect(menu.image.url).toMatch(new RegExp(`^/media/t/${TEST_TENANT}/menu/`))
    expect([await countUploads(db, TEST_TENANT), await countUploads(db, OTHER)]).toEqual([1, 0])

    // Their menu reset deletes nothing of ours.
    await createCategory(db, theirs, { name: 'Hot', description: '', parentId: null, availabilityRuleIds: [] })
    await db.batch(deleteAllMenuStatements(db, OTHER) as [Statement, ...Statement[]])
    expect((await countMenuData(db, OTHER)).categories).toBe(0)
    expect(await countMenuData(db, TEST_TENANT)).toEqual({ categories: 2, optionSets: 1, modifierGroups: 1, availabilityRules: 1, items: { draft: 0, active: 1, archived: 0 } })
  })
})
