import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreatePromotionInput } from '#shared/contracts/menu-promotions'
import { PROMOTION_TARGETS_MAX } from '#shared/contracts/menu-promotions'
import type { MenuItem } from '#shared/contracts/menu-items'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor } from '#server/features/identity'
import { getAsset, uploadImage } from '#server/features/media/media.service'
import type { ObjectStore } from '#server/features/media/media.service'
import { getPublicMenu } from '#server/features/menu/catalog.service'
import { archiveCategory, createCategory } from '#server/features/menu/categories.service'
import { archiveItem, createItem, publishItem } from '#server/features/menu/items.service'
import { menuItems, menuPromotions } from '#server/features/menu/menu.schema'
import { createPromotion, deletePromotion, endPromotion, getPromotion, listPromotions, publishPromotion, updatePromotion } from '#server/features/menu/promotions.service'
import { countMenuData, deleteAllMenuStatements } from '#server/features/menu/reset.repository'
import { orders } from '#server/features/orders/orders.schema'
import { getOrder, placeOrder } from '#server/features/orders/orders.service'
import { getCheckoutQuote } from '#server/features/orders/quote.service'
import { promotionResults } from '#server/features/orders/reports.service'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// Promotions (M1, D163) against the real menu, branches, media and orders services and the
// migrations: phases, prices on the menu, the quote and the order, the guards, and isolation.

const OTHER = 'tenant-2'
const admin: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner' }
const theirs: Actor = { userId: 'their-owner', tenantId: OTHER, role: 'owner' }
const store: ObjectStore = { put: async () => undefined, del: async () => undefined }
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array.from({ length: 32 }, (_, i) => i)])

/** Thursday 2026-10-15, noon in Phnom Penh (UTC+7). */
const at = (date: string, hhmm = '12:00') => new Date(`${date}T${hhmm}:00+07:00`)
const NOW = at('2026-10-15')

let db: Db
let riverside: string
let kiosk: string
let coffee: string
let bakery: string
let latte: MenuItem
let bread: MenuItem

async function published(categoryId: string, name: string, priceMinor: number, actor = admin): Promise<MenuItem> {
  const draft = await createItem(db, actor, { categoryId, name, description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  return publishItem(db, actor, draft.id, { version: draft.version })
}

const input = (over: Partial<CreatePromotionInput> = {}): CreatePromotionInput => ({
  name: 'Coffee week',
  description: '',
  discount: { kind: 'percent', percent: 20 },
  scope: 'selected',
  itemIds: [],
  categoryIds: [coffee],
  branchIds: [],
  startsOn: '2026-10-15',
  endsOn: '2026-10-21',
  posterId: null,
  publish: true,
  ...over,
})

/** The menu's price of `item` at `branchId` (or Riverside) at `now`. */
async function priceOf(item: MenuItem, now = NOW, branchId = riverside) {
  const menu = await getPublicMenu(db, TEST_TENANT, { branchId }, now)
  const found = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.id === item.id)!
  return { priceMinor: found.variations[0]!.priceMinor, regularPriceMinor: found.variations[0]!.regularPriceMinor, label: found.promotion?.label ?? null }
}

/** Holds every racer at `db.batch` until all have arrived, then lets them commit (one by one: SQLite). */
function racing(count: number): Db {
  let arrived = 0
  let open!: () => void
  const all = new Promise<void>((resolve) => {
    open = resolve
  })
  const racer = Object.create(db) as Db
  racer.batch = (async (statements: Parameters<Db['batch']>[0]) => {
    if (++arrived === count) open()
    await all
    return db.batch(statements)
  }) as unknown as Db['batch']
  return racer
}

beforeEach(async () => {
  db = await createTestDb()
  riverside = newId()
  kiosk = newId()
  await insertBranch(db, { id: riverside, name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
  await insertBranch(db, { id: kiosk, name: 'Kiosk', timezone: 'Asia/Phnom_Penh' })
  coffee = (await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })).id
  bakery = (await createCategory(db, admin, { name: 'Bakery', description: '', parentId: null, availabilityRuleIds: [] })).id
  latte = await published(coffee, 'Latte', 350)
  bread = await published(bakery, 'Banana Bread', 250)
})

describe('promotions', () => {
  it('a published promotion lowers the price on the menu at once; a draft doesn\'t', async () => {
    const draft = await createPromotion(db, admin, input({ publish: false }), NOW)
    expect(draft).toMatchObject({ status: 'draft', phase: 'draft', label: '20% off', categories: [{ id: coffee, name: 'Coffee', status: 'active' }], branches: [] })
    expect(await priceOf(latte)).toEqual({ priceMinor: 350, regularPriceMinor: null, label: null })

    const live = await publishPromotion(db, admin, draft.id, { version: draft.version }, NOW)
    expect(live).toMatchObject({ status: 'published', phase: 'live', version: 2 })
    expect(await priceOf(latte)).toEqual({ priceMinor: 280, regularPriceMinor: 350, label: '20% off' })
    // Not in the promotion.
    expect(await priceOf(bread)).toEqual({ priceMinor: 250, regularPriceMinor: null, label: null })
    const menu = await getPublicMenu(db, TEST_TENANT, { branchId: riverside }, NOW)
    expect(menu.promotions).toEqual([{ id: live.id, name: 'Coffee week', description: '', label: '20% off', endsOn: '2026-10-21', posterUrl: null, itemIds: [latte.id] }])
  })

  it('runs from its first day to its last, on each branch\'s calendar', async () => {
    const promotion = await createPromotion(db, admin, input({ startsOn: '2026-10-16', endsOn: '2026-10-17' }), NOW)
    expect(promotion.phase).toBe('scheduled')
    expect((await priceOf(latte, at('2026-10-15', '23:59'))).label).toBeNull()
    expect((await priceOf(latte, at('2026-10-16', '00:00'))).label).toBe('20% off')
    expect((await priceOf(latte, at('2026-10-17', '23:59'))).label).toBe('20% off')
    expect((await priceOf(latte, at('2026-10-18', '00:00'))).label).toBeNull()
    expect((await getPromotion(db, TEST_TENANT, promotion.id, at('2026-10-18'))).phase).toBe('ended')
  })

  it('runs at the chosen branches only', async () => {
    await createPromotion(db, admin, input({ branchIds: [kiosk] }), NOW)
    expect((await priceOf(latte, NOW, riverside)).label).toBeNull()
    expect((await priceOf(latte, NOW, kiosk)).label).toBe('20% off')
  })

  it('never adds two promotions: the bigger discount wins', async () => {
    await createPromotion(db, admin, input({ name: 'Small', discount: { kind: 'percent', percent: 10 } }), NOW)
    await createPromotion(db, admin, input({ name: 'Whole menu', scope: 'menu', categoryIds: [], discount: { kind: 'amount', amountMinor: 100 } }), NOW)
    expect(await priceOf(latte)).toEqual({ priceMinor: 250, regularPriceMinor: 350, label: '$1.00 off' })
    expect(await priceOf(bread)).toEqual({ priceMinor: 150, regularPriceMinor: 250, label: '$1.00 off' })
  })

  it('refuses to publish a promotion whose last day has passed', async () => {
    await expectApiError(() => createPromotion(db, admin, input({ startsOn: '2026-10-01', endsOn: '2026-10-14' }), NOW), 422, 'PROMOTION_DATES_PASSED')
    // As a draft, it can be saved and fixed later.
    const draft = await createPromotion(db, admin, input({ startsOn: '2026-10-01', endsOn: '2026-10-14', publish: false }), NOW)
    await expectApiError(() => publishPromotion(db, admin, draft.id, { version: draft.version }, NOW), 422, 'PROMOTION_DATES_PASSED')
  })

  it('refuses archived items and categories, and another cafe\'s', async () => {
    const old = await published(bakery, 'Old cake', 300)
    await archiveItem(db, admin, old.id, { version: old.version })
    await expectApiError(() => createPromotion(db, admin, input({ categoryIds: [], itemIds: [bread.id, old.id] }), NOW), 422, 'PROMOTION_TARGET_NOT_AVAILABLE')

    const gone = await createCategory(db, admin, { name: 'Seasonal', description: '', parentId: null, availabilityRuleIds: [] })
    await archiveCategory(db, admin, gone.id, { version: gone.version })
    await expectApiError(() => createPromotion(db, admin, input({ categoryIds: [gone.id] }), NOW), 422, 'PROMOTION_TARGET_NOT_AVAILABLE')

    await ensureTenant(db, OTHER)
    const theirCategory = await createCategory(db, theirs, { name: 'Tea', description: '', parentId: null, availabilityRuleIds: [] })
    const theirItem = await published(theirCategory.id, 'Tea', 200, theirs)
    await expectApiError(() => createPromotion(db, admin, input({ categoryIds: [], itemIds: [theirItem.id] }), NOW), 422, 'PROMOTION_TARGET_NOT_AVAILABLE')
    await expectApiError(() => createPromotion(db, admin, input({ categoryIds: [theirCategory.id] }), NOW), 422, 'PROMOTION_TARGET_NOT_AVAILABLE')
    const theirBranch = newId()
    await insertBranch(db, { id: theirBranch, name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
    await expectApiError(() => createPromotion(db, admin, input({ branchIds: [theirBranch] }), NOW), 422, 'PROMOTION_TARGET_NOT_AVAILABLE')
  })

  it('keeps an item it already named after the item is archived', async () => {
    const promotion = await createPromotion(db, admin, input({ categoryIds: [], itemIds: [bread.id] }), NOW)
    const fresh = await archiveItem(db, admin, bread.id, { version: bread.version })
    const saved = await updatePromotion(db, admin, promotion.id, { ...input({ categoryIds: [], itemIds: [bread.id], name: 'Renamed' }), version: promotion.version }, NOW)
    expect(saved.items).toEqual([{ id: bread.id, name: 'Banana Bread', status: fresh.status }])
  })

  it('is another cafe\'s to neither read, change, nor apply', async () => {
    await ensureTenant(db, OTHER)
    const ours = await createPromotion(db, admin, input({ scope: 'menu', categoryIds: [] }), NOW)
    expect(await listPromotions(db, OTHER, NOW)).toEqual([])
    await expectApiError(() => getPromotion(db, OTHER, ours.id), 404, 'NOT_FOUND')
    await expectApiError(() => updatePromotion(db, theirs, ours.id, { ...input(), version: ours.version }, NOW), 404, 'NOT_FOUND')
    await expectApiError(() => endPromotion(db, theirs, ours.id, { version: ours.version }), 404, 'NOT_FOUND')
    await expectApiError(() => deletePromotion(db, theirs, ours.id, { version: ours.version }), 404, 'NOT_FOUND')

    // Their whole-menu promotion doesn't touch our prices, and ours doesn't touch theirs.
    const theirCategory = await createCategory(db, theirs, { name: 'Tea', description: '', parentId: null, availabilityRuleIds: [] })
    const tea = await published(theirCategory.id, 'Tea', 200, theirs)
    const theirBranch = newId()
    await insertBranch(db, { id: theirBranch, name: 'Theirs', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
    await createPromotion(db, theirs, input({ scope: 'menu', categoryIds: [], discount: { kind: 'percent', percent: 50 } }), NOW)
    expect(await priceOf(latte)).toEqual({ priceMinor: 280, regularPriceMinor: 350, label: '20% off' })
    const theirMenu = await getPublicMenu(db, OTHER, { branchId: theirBranch }, NOW)
    expect(theirMenu.categories[0]!.items[0]).toMatchObject({ id: tea.id, promotion: { label: '50% off' } })
  })

  it('refuses a save at an old version, and one of two saves at the same version', async () => {
    const promotion = await createPromotion(db, admin, input(), NOW)
    await updatePromotion(db, admin, promotion.id, { ...input({ name: 'First' }), version: promotion.version }, NOW)
    await expectApiError(() => updatePromotion(db, admin, promotion.id, { ...input({ name: 'Late' }), version: promotion.version }, NOW), 409, 'VERSION_CONFLICT')

    const current = await getPromotion(db, TEST_TENANT, promotion.id, NOW)
    const racer = racing(2)
    const results = await Promise.allSettled([
      updatePromotion(racer, admin, promotion.id, { ...input({ name: 'A' }), version: current.version }, NOW),
      updatePromotion(racer, admin, promotion.id, { ...input({ name: 'B', discount: { kind: 'percent', percent: 90 } }), version: current.version }, NOW),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const [lost] = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    expect(lost!.reason).toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
  })

  it('ends a published promotion: prices go back, and it can\'t change anymore', async () => {
    const promotion = await createPromotion(db, admin, input(), NOW)
    const ended = await endPromotion(db, admin, promotion.id, { version: promotion.version }, NOW)
    expect(ended).toMatchObject({ status: 'ended', phase: 'ended', endedAt: NOW.toISOString() })
    expect((await priceOf(latte)).label).toBeNull()
    await expectApiError(() => updatePromotion(db, admin, promotion.id, { ...input(), version: ended.version }, NOW), 409, 'PROMOTION_ENDED')
    await expectApiError(() => endPromotion(db, admin, promotion.id, { version: ended.version }, NOW), 409, 'PROMOTION_ENDED')
    await expectApiError(() => deletePromotion(db, admin, promotion.id, { version: ended.version }), 409, 'PROMOTION_ENDED')
  })

  it('deletes a draft, never a published one', async () => {
    const live = await createPromotion(db, admin, input(), NOW)
    await expectApiError(() => deletePromotion(db, admin, live.id, { version: live.version }), 409, 'INVALID_STATE')
    const draft = await createPromotion(db, admin, input({ publish: false }), NOW)
    await deletePromotion(db, admin, draft.id, { version: draft.version })
    expect((await listPromotions(db, TEST_TENANT, NOW)).map(p => p.id)).toEqual([live.id])
  })

  it('attaches its poster, releases the old one when replaced, and releases it when a draft is deleted', async () => {
    const first = await uploadImage(db, store, admin, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })
    const second = await uploadImage(db, store, admin, { type: 'image/png', data: PNG as Uint8Array<ArrayBuffer> })
    const draft = await createPromotion(db, admin, input({ publish: false, posterId: first.id }), NOW)
    expect(draft.poster).toEqual({ id: first.id, url: first.url })
    expect((await getAsset(db, TEST_TENANT, first.id))).toBeDefined()
    // A poster already in use can't be attached twice.
    await expectApiError(() => createPromotion(db, admin, input({ posterId: first.id }), NOW), 422, 'MEDIA_NOT_AVAILABLE')

    const replaced = await updatePromotion(db, admin, draft.id, { ...input({ publish: false, posterId: second.id }), version: draft.version }, NOW)
    expect(replaced.poster?.id).toBe(second.id)
    // The first is free again: another promotion can use it.
    const other = await createPromotion(db, admin, input({ publish: false, posterId: first.id }), NOW)
    expect(other.poster?.id).toBe(first.id)

    await deletePromotion(db, admin, replaced.id, { version: replaced.version })
    const again = await createPromotion(db, admin, input({ publish: false, posterId: second.id }), NOW)
    expect(again.poster?.id).toBe(second.id)
  })

  it('prices the quote and keeps the promotion on the order as it was', async () => {
    await updateBranchSettings(db, admin, riverside, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 })) })
    const promotion = await createPromotion(db, admin, input(), NOW)
    const lines = [
      { itemId: latte.id, variationId: latte.variations[0]!.id, modifierIds: [], quantity: 2, note: null },
      { itemId: bread.id, variationId: bread.variations[0]!.id, modifierIds: [], quantity: 1, note: null },
    ]
    const quote = await getCheckoutQuote(db, TEST_TENANT, { branchId: riverside, lines }, NOW)
    expect(quote.lines.map(l => [l.unitPriceMinor, l.regularUnitPriceMinor, l.promotion?.label ?? null])).toEqual([[280, 350, '20% off'], [250, null, null]])
    expect(quote).toMatchObject({ subtotalMinor: 810, totalMinor: 810, savingsMinor: 140 })

    const customer: Actor = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' }
    const { orderId } = await placeOrder(db, customer, { branchId: riverside, tableToken: null, lines, expectedTotalMinor: 810 }, crypto.randomUUID(), NOW)
    // The promotion changes afterwards: the order keeps what was sold.
    await updatePromotion(db, admin, promotion.id, { ...input({ name: 'Renamed', discount: { kind: 'percent', percent: 50 } }), version: promotion.version }, NOW)
    const order = await getOrder(db, customer, orderId)
    expect(order.lines.map(l => [l.unitPriceMinor, l.regularUnitPriceMinor, l.promotion])).toEqual([
      [280, 350, { name: 'Coffee week', label: '20% off' }],
      [250, null, null],
    ])
    expect(order.totalMinor).toBe(810)

    // Results count paid orders only.
    expect(await promotionResults(db, TEST_TENANT, promotion.id)).toEqual({ orders: 0, units: 0, discountMinor: 0, salesMinor: 0 })
    await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, orderId))
    expect(await promotionResults(db, TEST_TENANT, promotion.id)).toEqual({ orders: 1, units: 2, discountMinor: 140, salesMinor: 560 })
    // Another cafe asking about the same id gets nothing.
    expect(await promotionResults(db, OTHER, promotion.id)).toEqual({ orders: 0, units: 0, discountMinor: 0, salesMinor: 0 })
  })

  it('names the most items it may in statements D1 accepts', async () => {
    const ids = Array.from({ length: PROMOTION_TARGETS_MAX }, () => newId())
    for (let i = 0; i < ids.length; i += 10) {
      await db.insert(menuItems).values(ids.slice(i, i + 10).map((id, j) => ({ id, tenantId: TEST_TENANT, categoryId: bakery, name: `Cake ${i + j}`, status: 'active' as const })))
    }
    const promotion = await createPromotion(db, admin, input({ categoryIds: [], itemIds: ids }), NOW)
    expect(promotion.items).toHaveLength(PROMOTION_TARGETS_MAX)
    const saved = await updatePromotion(db, admin, promotion.id, { ...input({ categoryIds: [], itemIds: ids }), version: promotion.version }, NOW)
    expect(saved.items).toHaveLength(PROMOTION_TARGETS_MAX)
  })

  it('goes with the menu in a sample-data reset', async () => {
    await createPromotion(db, admin, input(), NOW)
    await db.batch(deleteAllMenuStatements(db, TEST_TENANT) as [Statement, ...Statement[]])
    expect(await db.select().from(menuPromotions)).toEqual([])
    expect((await countMenuData(db, TEST_TENANT)).categories).toBe(0)
  })
})
