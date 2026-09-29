import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateItemInput, MenuItem } from '#shared/contracts/menu-items'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { OrderLineInput } from '#shared/contracts/orders'
import { organization } from '../../../db/tables'
import { updateBranchSettings } from '../../branches'
import type { Actor, BranchActor } from '../../identity'
import { archiveModifier, createAvailabilityRule, createCategory, createItem, createModifierGroup, createOptionSet, publishItem, setSoldOut, unpublishItem, updateItem } from '../../menu'
import { getCheckoutQuote } from '../quote.service'
import { createTestDb } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import type { Db } from '../../../utils/batch'
import { newId } from '../../../utils/ids'

// The quote against the real menu services and migrations (step 6.1, D98): prices come from the
// database as it is now, never from the request.

let db: Db
const admin: Actor = { userId: 'admin-1', role: 'admin' }
let branchId: string
let otherBranch: string
let category: string
let milk: ModifierGroup
let latte: MenuItem

async function addBranch(name: string, openAllDay: boolean) {
  const id = newId()
  await db.insert(organization).values({ id, name, slug: id, timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  if (openAllDay) {
    await updateBranchSettings(db, admin, id, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 })) })
  }
  return id
}

async function published(name: string, overrides: Partial<CreateItemInput> = {}): Promise<MenuItem> {
  const draft = await createItem(db, admin, {
    categoryId: category,
    name,
    description: '',
    imageId: null,
    optionSetIds: [],
    variations: [{ valueIds: [], priceMinor: 250, status: 'active' }],
    modifierGroups: [],
    availabilityRuleIds: [],
    ...overrides,
  })
  return publishItem(db, admin, draft.id, { version: draft.version })
}

/** Monday 2026-09-28, local time in Phnom Penh (UTC+7). */
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
const variation = (item: MenuItem, label: string) => item.variations.find(x => x.label === label)!.id
const modifier = (name: string) => milk.modifiers.find(m => m.name === name)!.id
const quote = (lines: OrderLineInput[], at = monday('09:00'), branch = branchId) => getCheckoutQuote(db, { branchId: branch, lines }, at)
const line = (item: MenuItem, variationId: string, over: Partial<OrderLineInput> = {}): OrderLineInput =>
  ({ itemId: item.id, variationId, modifierIds: [], quantity: 1, note: null, ...over })

beforeEach(async () => {
  db = await createTestDb()
  branchId = await addBranch('Riverside', true)
  otherBranch = await addBranch('Zeta Kiosk', true)
  category = (await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })).id
  const size = await createOptionSet(db, admin, { name: 'Size', values: ['Regular', 'Large'] })
  milk = await createModifierGroup(db, admin, { name: 'Milk', minSelect: 1, maxSelect: 1, modifiers: [{ name: 'Whole milk', priceDeltaMinor: 0, isDefault: true }, { name: 'Oat milk', priceDeltaMinor: 50, isDefault: false }] })
  latte = await published('Iced Latte', {
    optionSetIds: [size.id],
    variations: [
      { valueIds: [size.values[0]!.id], priceMinor: 300, status: 'active' },
      { valueIds: [size.values[1]!.id], priceMinor: 325, status: 'active' },
    ],
    // This item charges $0.75 for oat milk instead of the library's $0.50.
    modifierGroups: [{ groupId: milk.id, rules: null, prices: [{ modifierId: modifier('Oat milk'), priceDeltaMinor: 75 }] }],
  })
})

describe('the checkout quote', () => {
  it('prices from the database, with the item\'s own add-on price', async () => {
    const result = await quote([line(latte, variation(latte, 'Large'), { modifierIds: [modifier('Oat milk')], quantity: 2 })])
    expect(result.lines[0]).toMatchObject({ name: 'Iced Latte', detail: 'Large · Oat milk', unitPriceMinor: 400, totalMinor: 800, problem: null })
    expect(result).toMatchObject({ totalMinor: 800, orderable: true, at: '2026-09-28T02:00:00.000Z', expiresAt: '2026-09-28T02:10:00.000Z', branch: { id: branchId, openNow: true } })
  })

  it('a price edit shows in the next quote', async () => {
    const large = variation(latte, 'Large')
    const before = await quote([line(latte, large, { modifierIds: [modifier('Whole milk')] })])
    const current = latte
    await updateItem(db, admin, latte.id, { version: current.version, variations: current.variations.map(x => ({ valueIds: x.valueIds, priceMinor: x.label === 'Large' ? 350 : x.priceMinor, status: 'active' as const })) })
    const after = await quote([line(latte, large, { modifierIds: [modifier('Whole milk')] })])
    expect([before.totalMinor, after.totalMinor]).toEqual([325, 350])
  })

  it('an item outside its hours, or unpublished, isn\'t on the menu', async () => {
    const breakfast = await createAvailabilityRule(db, admin, { name: 'Breakfast', windows: [{ weekday: 1, startMinute: 420, endMinute: 660 }] })
    const eggs = await published('Eggs', { availabilityRuleIds: [breakfast.id] })
    const tea = await published('Tea')
    expect((await quote([line(eggs, eggs.variations[0]!.id)], monday('08:00'))).orderable).toBe(true)
    expect((await quote([line(eggs, eggs.variations[0]!.id)], monday('12:00'))).lines[0]!.problem?.code).toBe('ITEM_UNAVAILABLE')
    await unpublishItem(db, admin, tea.id, { version: tea.version })
    expect((await quote([line(tea, tea.variations[0]!.id)])).lines[0]!.problem?.code).toBe('ITEM_UNAVAILABLE')
  })

  it('sold out at this branch only', async () => {
    const large = variation(latte, 'Large')
    const staff: BranchActor = { userId: 'staff-1', role: 'customer', branchId, branchRole: 'staff' }
    await setSoldOut(db, staff, { variationIds: [large], soldOut: true })
    const order = [line(latte, large, { modifierIds: [modifier('Whole milk')] })]
    expect((await quote(order)).lines[0]!.problem?.code).toBe('SOLD_OUT')
    expect((await quote(order, monday('09:00'), otherBranch)).orderable).toBe(true)
  })

  it('an archived add-on is reported by id', async () => {
    const oat = modifier('Oat milk')
    await archiveModifier(db, admin, milk.id, oat, { version: milk.version })
    const result = await quote([line(latte, variation(latte, 'Large'), { modifierIds: [oat] })])
    expect(result.lines[0]!.problem).toMatchObject({ code: 'ADD_ON_UNAVAILABLE', modifierIds: [oat] })
    expect(result.orderable).toBe(false)
  })

  it('a branch without hours is closed; an unknown branch is 404', async () => {
    const closed = await addBranch('Night Kiosk', false)
    const result = await quote([line(latte, variation(latte, 'Large'), { modifierIds: [modifier('Whole milk')] })], monday('09:00'), closed)
    expect(result.problems).toEqual([{ code: 'BRANCH_CLOSED', message: 'Night Kiosk is closed now.' }])
    expect(result.orderable).toBe(false)
    await expectApiError(() => quote([], monday('09:00'), newId()), 404, 'NOT_FOUND')
  })
})
