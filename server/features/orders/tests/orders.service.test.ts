import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateItemInput, MenuItem } from '#shared/contracts/menu-items'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { OrderLineInput, PlaceOrderInput } from '#shared/contracts/orders'
import { archiveTable, createTable, pauseBranch, resumeBranch, updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { archiveItem, createAvailabilityRule, updateAvailabilityRule, updateModifier, updatePromotion, archiveModifier, archiveOptionValue, createPromotion, endPromotion, createCategory, createItem, createModifierGroup, createOptionSet, publishItem, setSoldOut, updateItem } from '#server/features/menu'
import { orderEvents, orderLines, counterPayments, orders } from '#server/features/orders/orders.schema'
import { getOrder, placeOrder } from '#server/features/orders/orders.service'
import { createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { auditEvents, idempotencyKeys, outboxMessages } from '#server/features/platform/platform.schema'
import { newId } from '#server/utils/ids'

// Placing orders (step 6.2, D99) against the real menu, branch and platform services and the
// migrations: pickup numbers, idempotent retries, the unpaid limit, tables and snapshots.

let db: Db
const admin: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner' }
const qr = { secret: 'test-qr-secret-that-is-long-enough', baseUrl: 'https://cafe.example' }
let branchId: string
let otherBranch: string
let category: string
let milk: ModifierGroup
let latte: MenuItem
let bread: MenuItem
let sokha: Actor
let dara: Actor

/** Monday 2026-09-28, local time in Phnom Penh (UTC+7). */
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
const NOON = monday('12:00')

async function addBranch(name: string, hours: { weekday: number, startMinute: number, endMinute: number }[]) {
  const id = newId()
  await insertBranch(db, { id, name, timezone: 'Asia/Phnom_Penh', status: 'active' })
  if (hours.length) await updateBranchSettings(db, admin, id, { version: 1, hours })
  return id
}
const allWeek = (startMinute: number, endMinute: number) => [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute, endMinute }))

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

const large = () => latte.variations.find(v => v.label === 'Large')!.id
const oat = () => milk.modifiers.find(m => m.name === 'Oat milk')!.id

/** 2 × Iced Latte Large with oat milk ($3.25 + $0.50) and a Banana Bread ($2.50): $10.00. */
const THE_LINES = (): OrderLineInput[] => [
  { itemId: latte.id, variationId: large(), modifierIds: [oat()], quantity: 2, note: 'Less ice' },
  { itemId: bread.id, variationId: bread.variations[0]!.id, modifierIds: [], quantity: 1, note: null },
]
const input = (over: Partial<PlaceOrderInput> = {}): PlaceOrderInput =>
  ({ branchId, tableToken: null, lines: THE_LINES(), expectedTotalMinor: 1000, ...over })

const place = (actor: Actor, over: Partial<PlaceOrderInput> = {}, now = NOON, key: string = crypto.randomUUID(), on: Db = db) =>
  placeOrder(on, actor, input(over), key, now)
const placed = async (actor: Actor, over: Partial<PlaceOrderInput> = {}, now = NOON) =>
  getOrder(db, actor, (await place(actor, over, now)).orderId)

/** Holds every racer at `db.batch` until all have arrived, then lets them commit (one by one: SQLite). */
function racing(count: number): Db {
  let arrived = 0
  let open!: () => void
  const all = new Promise<void>((resolve) => {
    open = resolve
  })
  const racer = Object.create(db) as Db
  racer.batch = (async (statements: Parameters<Db['batch']>[0]) => {
    if (!(statements[0] as unknown as { toSQL: () => { sql: string } }).toSQL().sql.startsWith('insert into "idempotency_keys"')) return db.batch(statements)
    if (++arrived === count) open()
    await all
    return db.batch(statements)
  }) as unknown as Db['batch']
  return racer
}

const orderCount = async () => (await db.select().from(orders)).length

beforeEach(async () => {
  db = await createTestDb()
  branchId = await addBranch('Riverside', allWeek(420, 1260))
  otherBranch = await addBranch('Zeta Kiosk', allWeek(420, 1260))
  category = (await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })).id
  const size = await createOptionSet(db, admin, { name: 'Size', values: ['Regular', 'Large'] })
  milk = await createModifierGroup(db, admin, { name: 'Milk', minSelect: 0, maxSelect: 1, modifiers: [{ name: 'Oat milk', priceDeltaMinor: 50, isDefault: false }, { name: 'Whole milk', priceDeltaMinor: 0, isDefault: false }] })
  latte = await published('Iced Latte', {
    optionSetIds: [size.id],
    variations: [{ valueIds: [size.values[0]!.id], priceMinor: 300, status: 'active' }, { valueIds: [size.values[1]!.id], priceMinor: 325, status: 'active' }],
    modifierGroups: [{ groupId: milk.id, rules: null, prices: [] }],
  })
  bread = await published('Banana Bread')
  sokha = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' }
  dara = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' }
})

describe('placing an order', () => {
  it('keeps a snapshot of every line, the totals, pickup number 1 and 30 minutes to pay', async () => {
    const order = await placed(sokha)
    expect(order).toEqual({
      id: expect.any(String),
      version: 1,
      branch: { id: branchId, name: 'Riverside' },
      pickupNumber: 1,
      businessDate: '2026-09-28',
      status: 'awaiting_payment',
      orderType: 'pickup',
      table: null,
      lines: [
        { itemId: latte.id, variationId: latte.variations[1]!.id, itemName: 'Iced Latte', detail: 'Large · Oat milk', modifiers: [{ id: oat(), name: 'Oat milk', priceDeltaMinor: 50 }], unitPriceMinor: 375, quantity: 2, totalMinor: 750, note: 'Less ice', regularUnitPriceMinor: null, promotion: null },
        { itemId: bread.id, variationId: bread.variations[0]!.id, itemName: 'Banana Bread', detail: '', modifiers: [], unitPriceMinor: 250, quantity: 1, totalMinor: 250, note: null, regularUnitPriceMinor: null, promotion: null },
      ],
      subtotalMinor: 1000,
      totalMinor: 1000,
      currency: 'USD',
      placedAt: '2026-09-28T05:00:00.000Z',
      paymentDueAt: '2026-09-28T05:30:00.000Z',
      paidAt: null,
      readyAt: null,
      completedAt: null,
      cancelledAt: null,
      payment: null,
      cancellation: null,
    })
  })

  it('the largest order (30 lines) fits D1\'s limit of 100 values per statement', async () => {
    const lines = Array.from({ length: 30 }, (_, i): OrderLineInput => ({ itemId: bread.id, variationId: bread.variations[0]!.id, modifierIds: [], quantity: 1, note: `Line ${i + 1}` }))
    const order = await placed(sokha, { lines, expectedTotalMinor: 30 * 250 })
    expect(order.lines.map(l => l.note)).toEqual(lines.map(l => l.note))
    expect(order.totalMinor).toBe(7500)
  })

  it('a later menu edit or archive never changes a placed order', async () => {
    const before = await placed(sokha)
    await updateItem(db, admin, bread.id, { version: bread.version, name: 'Banana Loaf', variations: [{ valueIds: [], priceMinor: 400, status: 'active' }] })
    const edited = (await getOrder(db, sokha, before.id))
    await archiveItem(db, admin, latte.id, { version: latte.version })
    expect(await getOrder(db, sokha, before.id)).toEqual(before)
    expect(edited).toEqual(before)
  })

  it('refuses a total other than the one shown, and places nothing', async () => {
    await expectApiError(() => place(sokha, { expectedTotalMinor: 900 }), 409, 'PRICES_CHANGED')
    expect(await orderCount()).toBe(0)
  })

  it('refuses a line that can\'t be ordered now', async () => {
    const staff: BranchActor = { userId: 'staff-1', tenantId: TEST_TENANT, role: 'customer', branchId, branchRole: 'staff' }
    await setSoldOut(db, staff, { variationIds: [bread.variations[0]!.id], soldOut: true })
    await expectApiError(() => place(sokha), 409, 'ORDER_NOT_ORDERABLE')
    expect(await orderCount()).toBe(0)
  })

  it('refuses when closed or within 15 minutes of closing (open until 21:00)', async () => {
    await expectApiError(() => place(sokha, {}, monday('06:59')), 409, 'ORDERING_CLOSED')
    await expectApiError(() => place(sokha, {}, monday('20:45')), 409, 'ORDERING_CLOSED')
    expect((await placed(sokha, {}, monday('20:44'))).pickupNumber).toBe(1)
  })

  it('refuses while the counter paused online orders, and takes them again after it ends or is resumed (D199)', async () => {
    const manager: Actor = { ...admin, userId: (await createUser(db, 'mony@example.com', 'Mony')).id }
    await pauseBranch(db, manager, branchId, { for: '15m', reason: null }, NOON)
    await expectApiError(() => place(sokha, {}, monday('12:10')), 409, 'ORDERING_CLOSED', undefined, 'Riverside isn\'t taking online orders right now. Back at 12:15 PM.')
    // Another branch carries on.
    expect((await placed(sokha, { branchId: otherBranch }, monday('12:10'))).pickupNumber).toBe(1)
    expect(await orderCount()).toBe(1)
    // The pause ends by itself.
    expect((await placed(dara, {}, monday('12:15'))).pickupNumber).toBe(1)
    await pauseBranch(db, manager, branchId, { for: '1h', reason: null }, monday('12:20'))
    await resumeBranch(db, manager, branchId, monday('12:21'))
    expect((await placed(dara, {}, monday('12:22'))).pickupNumber).toBe(2)
  })
})

describe('pickup numbers (Q39)', () => {
  it('count up per branch and business day, restarting at 4:00', async () => {
    expect((await placed(sokha)).pickupNumber).toBe(1)
    expect((await placed(dara)).pickupNumber).toBe(2)
    expect((await placed(dara, { branchId: otherBranch })).pickupNumber).toBe(1)
    // Open all night: 03:59 is still Monday's business day, 04:00 starts Tuesday's.
    const night = await addBranch('Night Owl', allWeek(0, 1440))
    const lateSokha = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' as const }
    const lateDara = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' as const }
    expect(await placed(lateSokha, { branchId: night }, new Date('2026-09-29T03:59:00+07:00'))).toMatchObject({ pickupNumber: 1, businessDate: '2026-09-28' })
    expect(await placed(lateDara, { branchId: night }, new Date('2026-09-29T04:00:00+07:00'))).toMatchObject({ pickupNumber: 1, businessDate: '2026-09-29' })
  })

  it('never repeat when orders are placed at the same moment', async () => {
    const customers = await Promise.all([1, 2, 3, 4].map(async () => ({ userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'customer' as const })))
    const on = racing(customers.length)
    const results = await Promise.all(customers.map(customer => place(customer, {}, NOON, crypto.randomUUID(), on)))
    const numbers = await Promise.all(results.map(async (r, i) => (await getOrder(db, customers[i]!, r.orderId)).pickupNumber))
    expect(numbers.sort()).toEqual([1, 2, 3, 4])
  })

  it('the database refuses a repeated number whatever the code does', async () => {
    const order = await placed(sokha)
    const copy = { ...(await db.select().from(orders).where(eq(orders.id, order.id)))[0]!, id: newId() }
    await expect(db.insert(orders).values(copy)).rejects.toThrow()
  })
})

describe('retries (Idempotency-Key)', () => {
  it('the same key gives the same order, once', async () => {
    const key = crypto.randomUUID()
    const first = await place(sokha, {}, NOON, key)
    const again = await place(sokha, {}, NOON, key)
    expect(again).toEqual({ orderId: first.orderId, replayed: true })
    expect(first.replayed).toBe(false)
    expect(await orderCount()).toBe(1)
  })

  it('a retry after the prices changed still answers with the order it placed', async () => {
    const key = crypto.randomUUID()
    const first = await place(sokha, {}, NOON, key)
    await updateItem(db, admin, bread.id, { version: bread.version, variations: [{ valueIds: [], priceMinor: 400, status: 'active' }] })
    expect((await place(sokha, {}, NOON, key)).orderId).toBe(first.orderId)
  })

  it('two tabs sending the same key at the same moment place one order', async () => {
    const key = crypto.randomUUID()
    const on = racing(2)
    const [one, two] = await Promise.all([place(sokha, {}, NOON, key, on), place(sokha, {}, NOON, key, on)])
    expect(one.orderId).toBe(two.orderId)
    expect([one.replayed, two.replayed].sort()).toEqual([false, true])
    expect(await orderCount()).toBe(1)
  })

  it('the same key with a different order is refused', async () => {
    const key = crypto.randomUUID()
    await place(sokha, {}, NOON, key)
    await expectApiError(() => place(sokha, { lines: THE_LINES().slice(1), expectedTotalMinor: 250 }, NOON, key), 422, 'IDEMPOTENCY_MISMATCH')
  })
})

describe('unpaid orders (at most 2 at once)', () => {
  it('a third is refused until one is no longer due', async () => {
    await place(sokha)
    await place(sokha)
    await expectApiError(() => place(sokha), 409, 'TOO_MANY_UNPAID_ORDERS')
    expect(await orderCount()).toBe(2)
    // Someone else isn't affected.
    await place(dara)
    // 31 minutes later both are past their payment time (the expiry task cancels them, 6.6).
    expect((await placed(sokha, {}, monday('12:31'))).pickupNumber).toBe(4)
  })

  it('two placed at the same moment can\'t both pass', async () => {
    await place(sokha)
    const on = racing(2)
    const results = await Promise.allSettled([place(sokha, {}, NOON, crypto.randomUUID(), on), place(sokha, {}, NOON, crypto.randomUUID(), on)])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await orderCount()).toBe(2)
  })
})

describe('dine-in (Q42)', () => {
  const tokenOf = (qrUrl: string | null) => qrUrl!.split('/').pop()!

  it('a table\'s QR token makes it dine-in at that table', async () => {
    const table = await createTable(db, admin, branchId, { label: 'T12', area: null, seats: 2 }, qr)
    const order = await placed(sokha, { tableToken: tokenOf(table.qrUrl) })
    expect(order).toMatchObject({ orderType: 'dine_in', table: { label: 'T12' } })
  })

  it('refuses a token of another branch, an archived table or a made-up token: never pickup instead', async () => {
    const elsewhere = await createTable(db, admin, otherBranch, { label: 'Z1', area: null, seats: 2 }, qr)
    await expectApiError(() => place(sokha, { tableToken: tokenOf(elsewhere.qrUrl) }), 409, 'TABLE_UNAVAILABLE')
    const table = await createTable(db, admin, branchId, { label: 'T3', area: null, seats: 2 }, qr)
    await archiveTable(db, admin, branchId, table.id, { version: table.version }, qr)
    await expectApiError(() => place(sokha, { tableToken: tokenOf(table.qrUrl) }), 409, 'TABLE_UNAVAILABLE')
    await expectApiError(() => place(sokha, { tableToken: 'not-a-token' }), 409, 'TABLE_UNAVAILABLE')
    expect(await orderCount()).toBe(0)
  })
})

describe('reading an order', () => {
  it('someone else\'s order is 404, like an unknown one', async () => {
    const order = await placed(sokha)
    await expectApiError(() => getOrder(db, dara, order.id), 404, 'NOT_FOUND')
    await expectApiError(() => getOrder(db, sokha, newId()), 404, 'NOT_FOUND')
  })
})

/** Only intercept the write batch: catalog reads also use batch. */
function beforeCheckoutCommit(meanwhile: () => Promise<unknown>): Db {
  const on = Object.create(db) as Db
  let intercepted = false
  on.batch = (async (statements: Parameters<Db['batch']>[0]) => {
    const query = (statements[0] as unknown as { toSQL: () => { sql: string } }).toSQL().sql
    if (!intercepted && query.startsWith('insert into "idempotency_keys"')) {
      intercepted = true
      await meanwhile()
    }
    return db.batch(statements)
  }) as unknown as Db['batch']
  return on
}

async function checkoutRows() {
  return Promise.all([orders, orderLines, orderEvents, counterPayments, idempotencyKeys, auditEvents, outboxMessages].map(table => db.select({ count: sql<number>`count(*)` }).from(table)))
}

describe('checkout state at commit', () => {
  const staff = (): BranchActor => ({ ...admin, branchId, branchRole: 'manager' })
  const rejectAfter = async (change: () => Promise<unknown>, code: string, over: Partial<PlaceOrderInput> = {}) => {
    let afterChange: unknown
    const on = beforeCheckoutCommit(async () => {
      await change()
      afterChange = await checkoutRows()
    })
    await expectApiError(() => place(sokha, over, NOON, crypto.randomUUID(), on), 409, code)
    expect(afterChange).toBeDefined()
    expect(await checkoutRows()).toEqual(afterChange)
    expect(await orderCount()).toBe(0)
  }

  it('refuses an item marked sold out after validation', async () => {
    await rejectAfter(() => setSoldOut(db, staff(), { variationIds: [large()], soldOut: true }), 'ORDER_NOT_ORDERABLE')
  })

  it('refuses a price changed after validation without accepting a new total', async () => {
    await rejectAfter(() => updateItem(db, admin, bread.id, { version: bread.version, variations: [{ valueIds: [], priceMinor: 400, status: 'active' }] }), 'PRICES_CHANGED')
  })

  it('refuses an option archived after validation', async () => {
    await rejectAfter(() => archiveOptionValue(db, admin, latte.optionSets[0]!.id, latte.optionSets[0]!.values.find(v => v.name === 'Large')!.id, { version: 1 }), 'ORDER_NOT_ORDERABLE')
  })

  it('refuses an add-on archived after validation', async () => {
    await rejectAfter(() => archiveModifier(db, admin, milk.id, oat(), { version: milk.version }), 'ORDER_NOT_ORDERABLE')
  })

  it('refuses a promotion starting after validation', async () => {
    await rejectAfter(() => createPromotion(db, admin, { name: 'Lunch', description: '', discount: { kind: 'percent', percent: 20 }, scope: 'menu', itemIds: [], categoryIds: [], branchIds: [branchId], startsOn: '2026-09-28', endsOn: null, posterId: null, publish: true }, NOON), 'PRICES_CHANGED')
  })

  it('refuses a promotion ending after validation', async () => {
    const promotion = await createPromotion(db, admin, { name: 'Lunch', description: '', discount: { kind: 'percent', percent: 20 }, scope: 'menu', itemIds: [], categoryIds: [], branchIds: [branchId], startsOn: '2026-09-28', endsOn: null, posterId: null, publish: true }, NOON)
    // 2 * (325 * 0.8 + 50) + 250 * 0.8 = 820.
    await rejectAfter(() => endPromotion(db, admin, promotion.id, { version: promotion.version }, NOON), 'PRICES_CHANGED', { expectedTotalMinor: 820 })
  })

  it('refuses a branch paused after validation (pause does not bump its version)', async () => {
    await rejectAfter(() => pauseBranch(db, { ...admin, userId: sokha.userId }, branchId, { for: '15m', reason: null }, NOON), 'ORDERING_CLOSED')
  })

  it('refuses hours closed after validation', async () => {
    await rejectAfter(() => updateBranchSettings(db, admin, branchId, { version: 2, hours: [] }), 'ORDERING_CLOSED')
  })

  it('refuses a table archived after validation, preserving dine-in intent', async () => {
    const table = await createTable(db, admin, branchId, { label: 'Race', area: null, seats: 2 }, qr)
    await rejectAfter(() => archiveTable(db, admin, branchId, table.id, { version: table.version }, qr), 'TABLE_UNAVAILABLE', { tableToken: table.qrUrl!.split('/').pop()! })
  })

  it('refuses an add-on price changed after validation', async () => {
    await rejectAfter(() => updateModifier(db, admin, milk.id, oat(), { version: milk.version, name: 'Oat milk', priceDeltaMinor: 75, isDefault: false }), 'PRICES_CHANGED')
  })

  it('rejects offsetting line price changes even when the total stays the same', async () => {
    await rejectAfter(async () => {
      await updateItem(db, admin, bread.id, { version: bread.version, variations: [{ valueIds: [], priceMinor: 300, status: 'active' }] })
      await updateModifier(db, admin, milk.id, oat(), { version: milk.version, name: 'Oat milk', priceDeltaMinor: 25, isDefault: false })
    }, 'ORDER_NOT_ORDERABLE')
  })

  it('refuses availability hours changed after validation', async () => {
    const rule = await createAvailabilityRule(db, admin, { name: 'Lunch hours', windows: [{ weekday: 1, startMinute: 660, endMinute: 780 }] })
    bread = await updateItem(db, admin, bread.id, { version: bread.version, availabilityRuleIds: [rule.id] })
    await rejectAfter(() => updateAvailabilityRule(db, admin, rule.id, { version: rule.version, name: rule.name, windows: [{ weekday: 1, startMinute: 780, endMinute: 840 }] }), 'ORDER_NOT_ORDERABLE')
  })

  it('refuses a promotion discount edited after validation', async () => {
    const fields = { name: 'Lunch', description: '', discount: { kind: 'percent' as const, percent: 20 }, scope: 'menu' as const, itemIds: [], categoryIds: [], branchIds: [branchId], startsOn: '2026-09-28', endsOn: null, posterId: null, publish: true }
    const promotion = await createPromotion(db, admin, fields, NOON)
    await rejectAfter(() => updatePromotion(db, admin, promotion.id, { ...fields, version: promotion.version, discount: { kind: 'percent', percent: 30 } }, NOON), 'PRICES_CHANGED', { expectedTotalMinor: 820 })
  })

  it('rolls back if time crosses the last-order minute before commit', async () => {
    const on = beforeCheckoutCommit(() => new Promise(resolve => setTimeout(resolve, 30)))
    const before = await checkoutRows()
    // Just before 20:45; the shifted logical clock uses actual elapsed database time.
    await expectApiError(() => place(sokha, {}, new Date(monday('20:45').getTime() - 1), crypto.randomUUID(), on), 409, 'ORDER_NOT_ORDERABLE')
    expect(await checkoutRows()).toEqual(before)
  })

  it('does not reject another branch sold-out change', async () => {
    const on = beforeCheckoutCommit(() => setSoldOut(db, { ...staff(), branchId: otherBranch }, { variationIds: [large()], soldOut: true }))
    const result = await place(sokha, {}, NOON, crypto.randomUUID(), on)
    expect((await getOrder(db, sokha, result.orderId)).totalMinor).toBe(1000)
  })
})
