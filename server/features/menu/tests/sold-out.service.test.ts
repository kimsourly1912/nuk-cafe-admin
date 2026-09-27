import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CounterItem } from '#shared/contracts/menu-sold-out'
import type { OptionSet } from '#shared/contracts/menu-options'
import type { Actor, BranchActor } from '../../identity'
import { auditEvents } from '../../platform/platform.schema'
import { archiveCategory, createCategory } from '../categories.service'
import { archiveItem, createItem, publishItem, unpublishItem, updateItem } from '../items.service'
import { menuCategories, menuItemVariations } from '../menu.schema'
import { archiveOptionValue, createOptionSet, getOptionSet } from '../options.service'
import { listCounterMenu, setSoldOut } from '../sold-out.service'
import { createTestDb } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import type { Db } from '../../../utils/batch'
import { newId } from '../../../utils/ids'

let db: Db
const admin: Actor = { userId: 'admin-1', role: 'admin', requestId: 'req-1' }
const riverside = newId()
const airport = newId()
const staff: BranchActor = { userId: 'staff-1', role: 'customer', branchId: riverside, branchRole: 'staff', requestId: 'req-2' }
const atAirport: BranchActor = { ...staff, branchId: airport }

let drinks: string
let hot: string
let size: OptionSet

beforeEach(async () => {
  db = await createTestDb()
  drinks = (await createCategory(db, admin, { name: 'Drinks', description: '', parentId: null })).id
  hot = (await createCategory(db, admin, { name: 'Hot drinks', description: '', parentId: drinks })).id
  size = await createOptionSet(db, admin, { name: 'Size', values: ['Small', 'Large'] })
})

const v = (set: OptionSet, name: string) => set.values.find(x => x.name === name)!.id

/** A published item: with `sizes`, Small $3.00 and Large $3.50; without, one version at $2.50. */
async function published(name: string, { sizes = false, categoryId = hot } = {}) {
  const variations = sizes
    ? [{ valueIds: [v(size, 'Small')], priceMinor: 300, status: 'active' as const }, { valueIds: [v(size, 'Large')], priceMinor: 350, status: 'active' as const }]
    : [{ valueIds: [], priceMinor: 250, status: 'active' as const }]
  const item = await createItem(db, admin, { categoryId, name, description: '', imageId: null, optionSetIds: sizes ? [size.id] : [], variations, modifierGroups: [] })
  return publishItem(db, admin, item.id, { version: item.version })
}

const menu = (actor: BranchActor = staff, query: { search?: string, soldOut?: 'true' } = {}) => listCounterMenu(db, actor.branchId, query)
const find = (items: CounterItem[], name: string) => items.find(i => i.name === name)
const variationOf = (item: CounterItem, label: string) => item.variations.find(x => x.label === label)!.id
const auditActions = async () => (await db.select().from(auditEvents)).filter(e => e.action.startsWith('menu.item.sold_out') || e.action === 'menu.item.back_in_stock')

describe('the counter\'s menu', () => {
  it('lists what customers can order, in menu order, with each variation\'s label and price', async () => {
    const pastries = (await createCategory(db, admin, { name: 'Pastries', description: '', parentId: null })).id
    await published('Croissant', { categoryId: pastries })
    await published('Latte', { sizes: true })
    const items = await menu()
    expect(items.map(i => i.name)).toEqual(['Latte', 'Croissant'])
    expect(items[0]).toMatchObject({ categoryId: hot, categoryName: 'Hot drinks', soldOut: false })
    expect(items[0]!.variations.map(x => [x.label, x.priceMinor, x.soldOut, x.soldOutChangedAt])).toEqual([['Small', 300, false, null], ['Large', 350, false, null]])
    expect(find(items, 'Croissant')!.variations.map(x => x.label)).toEqual([''])
  })

  it('leaves out drafts, archived items, items in an archived category, and variations that aren\'t on sale', async () => {
    const latte = await published('Latte', { sizes: true })
    await createItem(db, admin, { categoryId: hot, name: 'Draft tea', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 200, status: 'active' }], modifierGroups: [] })
    const gone = await published('Mocha')
    await archiveItem(db, admin, gone.id, { version: gone.version })
    // Large switched off in the grid.
    await updateItem(db, admin, latte.id, { version: latte.version, variations: [{ valueIds: [v(size, 'Small')], priceMinor: 300, status: 'active' }, { valueIds: [v(size, 'Large')], priceMinor: 350, status: 'disabled' }] })
    expect((await menu()).map(i => [i.name, i.variations.map(x => x.label)])).toEqual([['Latte', ['Small']]])

    // A variation using an archived value isn't on sale; an item left with none isn't listed.
    await archiveOptionValue(db, admin, size.id, v(size, 'Small'), { version: (await getOptionSet(db, size.id)).version })
    expect(await menu()).toEqual([])
  })

  it('leaves out items under an archived parent category', async () => {
    await published('Latte')
    const cold = (await createCategory(db, admin, { name: 'Cold', description: '', parentId: null })).id
    await published('Iced tea', { categoryId: cold })
    const [top] = await db.select().from(menuCategories).where(eq(menuCategories.id, drinks))
    await archiveCategory(db, admin, drinks, { version: top!.version })
    expect((await menu()).map(i => i.name)).toEqual(['Iced tea'])
  })

  it('leaves out items in an archived sub-category, and under an archived parent even if the sub-category is active', async () => {
    await published('Latte')
    const [sub] = await db.select().from(menuCategories).where(eq(menuCategories.id, hot))
    await archiveCategory(db, admin, hot, { version: sub!.version })
    expect(await menu()).toEqual([])
    // Archiving a parent archives its sub-categories; this state can only be written directly, but the counter mustn't rely on that.
    await db.update(menuCategories).set({ status: 'active' }).where(eq(menuCategories.id, hot))
    await db.update(menuCategories).set({ status: 'archived' }).where(eq(menuCategories.id, drinks))
    expect(await menu()).toEqual([])
  })

  it('labels a variation in the item\'s option set order, also after the order changes', async () => {
    const temp = await createOptionSet(db, admin, { name: 'Temperature', values: ['Hot', 'Iced'] })
    const grid = (sets: OptionSet[]) => sets[0]!.values.flatMap(a => sets[1]!.values.map(b => ({ valueIds: [a.id, b.id], priceMinor: 300, status: 'active' as const })))
    const item = await createItem(db, admin, { categoryId: hot, name: 'Latte', description: '', imageId: null, optionSetIds: [size.id, temp.id], variations: grid([size, temp]), modifierGroups: [] })
    const live = await publishItem(db, admin, item.id, { version: item.version })
    expect(find(await menu(), 'Latte')!.variations[0]!.label).toBe('Small, Hot')
    await updateItem(db, admin, item.id, { version: live.version, optionSetIds: [temp.id, size.id], variations: grid([temp, size]) })
    expect(find(await menu(), 'Latte')!.variations.map(x => x.label)).toEqual(['Hot, Small', 'Hot, Large', 'Iced, Small', 'Iced, Large'])
  })

  it('searches by name and lists only items with something sold out on request', async () => {
    const latte = await published('Latte', { sizes: true })
    await published('Flat white')
    expect((await menu(staff, { search: 'LATTE' })).map(i => i.name)).toEqual(['Latte'])
    const item = find(await menu(), 'Latte')!
    await setSoldOut(db, staff, latte.id, { soldOut: true, variationIds: [variationOf(item, 'Large')] })
    expect((await menu(staff, { soldOut: 'true' })).map(i => i.name)).toEqual(['Latte'])
  })
})

describe('switching sold out', () => {
  it('switches a whole item, in this branch only, and back', async () => {
    const latte = await published('Latte', { sizes: true })
    const out = await setSoldOut(db, staff, latte.id, { soldOut: true })
    expect(out.soldOut).toBe(true)
    expect(out.variations.every(x => x.soldOut && x.soldOutChangedAt)).toBe(true)
    expect(find(await menu(atAirport), 'Latte')!.soldOut).toBe(false)

    const back = await setSoldOut(db, staff, latte.id, { soldOut: false })
    expect(back.soldOut).toBe(false)
    expect(back.variations.every(x => !x.soldOut)).toBe(true)
  })

  it('switches single variations; the item is sold out only when all are', async () => {
    const latte = await published('Latte', { sizes: true })
    const item = find(await menu(), 'Latte')!
    const large = await setSoldOut(db, staff, latte.id, { soldOut: true, variationIds: [variationOf(item, 'Large')] })
    expect(large.variations.map(x => [x.label, x.soldOut])).toEqual([['Small', false], ['Large', true]])
    expect(large.soldOut).toBe(false)
    expect((await setSoldOut(db, staff, latte.id, { soldOut: true, variationIds: [variationOf(item, 'Small')] })).soldOut).toBe(true)
  })

  it('audits each change with the branch, and does nothing when it\'s already so', async () => {
    const latte = await published('Latte', { sizes: true })
    await setSoldOut(db, staff, latte.id, { soldOut: true })
    await setSoldOut(db, staff, latte.id, { soldOut: true })
    await setSoldOut(db, staff, latte.id, { soldOut: false })
    const events = await auditActions()
    expect(events.map(e => [e.action, e.branchId, e.actorId, e.metadata])).toEqual([
      ['menu.item.sold_out', riverside, 'staff-1', { variations: 2, of: 2 }],
      ['menu.item.back_in_stock', riverside, 'staff-1', { variations: 2, of: 2 }],
    ])
  })

  it('refuses items the counter doesn\'t sell, and variations that aren\'t this item\'s or aren\'t on sale', async () => {
    const draft = await createItem(db, admin, { categoryId: hot, name: 'Draft tea', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 200, status: 'active' }], modifierGroups: [] })
    await expectApiError(() => setSoldOut(db, staff, draft.id, { soldOut: true }), 404, 'NOT_FOUND')
    await expectApiError(() => setSoldOut(db, staff, newId(), { soldOut: true }), 404, 'NOT_FOUND')

    const latte = await published('Latte', { sizes: true })
    await published('Croissant')
    const other = find(await menu(), 'Croissant')!.variations[0]!.id
    await expectApiError(() => setSoldOut(db, staff, latte.id, { soldOut: true, variationIds: [other] }), 422, 'VARIATION_NOT_AVAILABLE', ['variationIds.0'])
    const latteNow = find(await menu(), 'Latte')!
    const [small, large] = [variationOf(latteNow, 'Small'), variationOf(latteNow, 'Large')]
    await db.update(menuItemVariations).set({ status: 'disabled' }).where(eq(menuItemVariations.id, large))
    await expectApiError(() => setSoldOut(db, staff, latte.id, { soldOut: true, variationIds: [small, large] }), 422, 'VARIATION_NOT_AVAILABLE', ['variationIds.1'])
  })

  it('keeps the switch while the item is unpublished and its prices change', async () => {
    const latte = await published('Latte', { sizes: true })
    await setSoldOut(db, staff, latte.id, { soldOut: true, variationIds: [variationOf(find(await menu(), 'Latte')!, 'Large')] })
    const draft = await unpublishItem(db, admin, latte.id, { version: latte.version })
    const repriced = await updateItem(db, admin, latte.id, { version: draft.version, variations: [{ valueIds: [v(size, 'Small')], priceMinor: 320, status: 'active' }, { valueIds: [v(size, 'Large')], priceMinor: 380, status: 'active' }] })
    await publishItem(db, admin, latte.id, { version: repriced.version })
    expect(find(await menu(), 'Latte')!.variations.map(x => [x.label, x.priceMinor, x.soldOut])).toEqual([['Small', 320, false], ['Large', 380, true]])
  })
})
