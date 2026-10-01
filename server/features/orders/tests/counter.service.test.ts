import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CancelOrderInput, PayOrderInput } from '#shared/contracts/orders'
import { cancelOrderSchema, toRiel } from '#shared/contracts/orders'
import { organization } from '#server/db/tables'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { auditEvents } from '#server/features/platform/platform.schema'
import { cancelOrderAtCounter, completeOrder, getCounterOrder, getCounterOrderHistory, getExchangeRates, listCounterQueue, listFinishedToday, markOrderReady, payOrder, setExchangeRate } from '#server/features/orders/counter.service'
import { expireUnpaidOrders } from '#server/features/orders/expiry.service'
import { counterPayments, orderEvents, orders } from '#server/features/orders/orders.schema'
import { cancelMyOrder, placeOrder } from '#server/features/orders/orders.service'
import { createTestDb, createUser } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { parseInput } from '#server/utils/validation'
import { newId } from '#server/utils/ids'

// The counter (step 6.3, D101) against the real menu, branch, platform and order services and the
// migrations: the queue, each command, the riel rate, and what two cashiers (or a retry) can't do.

let db: Db
const admin: Actor = { userId: 'admin-1', role: 'admin' }
let branchId: string
let otherBranchId: string
let itemId: string
let variationId: string
let sokha: Actor
let dara: Actor
let cashier: BranchActor
let colleague: BranchActor
let rateSetter: Actor

/** Monday 2026-09-28, local time in Phnom Penh (UTC+7). */
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
const NOON = monday('12:00')
const allWeek = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 }))

async function addBranch(name: string) {
  const id = newId()
  await db.insert(organization).values({ id, name, slug: id, timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  await updateBranchSettings(db, admin, id, { version: 1, hours: allWeek })
  return id
}

/** A $8.75 order: one Iced Latte. */
async function place(customer: Actor, at = NOON, branch = branchId) {
  const { orderId } = await placeOrder(db, customer, {
    branchId: branch,
    tableToken: null,
    lines: [{ itemId, variationId, modifierIds: [], quantity: 1, note: null }],
    expectedTotalMinor: 875,
  }, crypto.randomUUID(), at)
  return orderId
}

const key = () => crypto.randomUUID()
const cash: PayOrderInput = { version: 1, method: 'cash_usd' }
const pay = (orderId: string, input: PayOrderInput = cash, by = cashier, at = monday('12:05'), on = db, k = key()) =>
  payOrder(on, by, orderId, input, k, at)
const cancelInput = (over: Partial<CancelOrderInput> = {}): CancelOrderInput =>
  ({ version: 1, reason: 'customer_changed_mind', note: null, returnMethod: null, ...over })

const paymentsOf = async (orderId: string) => db.select().from(counterPayments).where(eq(counterPayments.orderId, orderId))
const eventsOf = async (orderId: string) => (await db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId))).sort((a, b) => a.toVersion - b.toVersion)
const statusOf = async (orderId: string) => (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]!.status

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
  branchId = await addBranch('Riverside')
  otherBranchId = await addBranch('Zeta Kiosk')
  const category = await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, admin, {
    categoryId: category.id,
    name: 'Iced Latte',
    description: '',
    imageId: null,
    optionSetIds: [],
    variations: [{ valueIds: [], priceMinor: 875, status: 'active' }],
    modifierGroups: [],
    availabilityRuleIds: [],
  })
  const item = await publishItem(db, admin, draft.id, { version: draft.version })
  itemId = item.id
  variationId = item.variations[0]!.id
  sokha = { userId: (await createUser(db, 'sokha@example.com', 'Sokha Chan')).id, role: 'customer' }
  dara = { userId: (await createUser(db, 'dara@example.com', 'Dara Sok')).id, role: 'customer' }
  cashier = { userId: (await createUser(db, 'sophea@example.com', 'Sophea')).id, role: 'customer', branchId, branchRole: 'staff' }
  colleague = { userId: (await createUser(db, 'vanna@example.com', 'Vanna')).id, role: 'customer', branchId, branchRole: 'staff' }
  rateSetter = { userId: (await createUser(db, 'kim@example.com', 'Kim')).id, role: 'admin' }
})

describe('the queue', () => {
  it('lists the orders in play, oldest first, with lines, customer and payment; not the finished, the expired or another branch\'s', async () => {
    const paid = await place(sokha, monday('11:00'))
    const waiting = await place(dara, monday('11:50'))
    const expired = await place(sokha, monday('11:20'))
    const done = await place(dara, monday('11:10'))
    await place(sokha, monday('11:55'), otherBranchId)
    await pay(paid, cash, cashier, monday('11:05'))
    await pay(done, cash, cashier, monday('11:15'))
    await markOrderReady(db, cashier, done, { version: 2 }, key(), monday('11:16'))
    await completeOrder(db, cashier, done, { version: 3 }, key(), monday('11:17'))

    // 12:00: `expired` (11:20) had until 11:50.
    const queue = await listCounterQueue(db, cashier, NOON)
    expect(queue.orders.map(order => [order.id, order.status])).toEqual([[paid, 'preparing'], [waiting, 'awaiting_payment']])
    expect(queue.orders.some(order => order.id === expired)).toBe(false)
    const [first, second] = queue.orders
    expect(first).toMatchObject({
      version: 2,
      pickupNumber: 1,
      customer: { name: 'Sokha Chan' },
      lines: [{ itemName: 'Iced Latte', quantity: 1, totalMinor: 875 }],
      totalMinor: 875,
      paidAt: monday('11:05').toISOString(),
      payment: { method: 'cash_usd', amountMinor: 875, amountKhr: null, collectedBy: { name: 'Sophea' }, returnMethod: null },
    })
    expect(second).toMatchObject({ pickupNumber: 2, customer: { name: 'Dara Sok' }, payment: null, paidAt: null })
    expect(queue.khrRate).toBeNull()
    expect(queue.serverTime).toBe(NOON.toISOString())
  })

  it('carries the riel rate in force', async () => {
    await setExchangeRate(db, rateSetter, { khrPerUsd: 4100 }, monday('09:00'))
    expect((await listCounterQueue(db, cashier, NOON)).khrRate).toEqual({ khrPerUsd: 4100, effectiveFrom: monday('09:00').toISOString(), setBy: { name: 'Kim' } })
  })

  it('another branch\'s order is not found, like an unknown one', async () => {
    const elsewhere = await place(sokha, NOON, otherBranchId)
    await expectApiError(() => getCounterOrder(db, cashier, elsewhere), 404, 'NOT_FOUND')
    await expectApiError(() => pay(elsewhere), 404, 'NOT_FOUND')
    await expectApiError(() => getCounterOrder(db, cashier, newId()), 404, 'NOT_FOUND')
  })
})

describe('taking payment', () => {
  it('cash in dollars: the order is paid and being prepared; the event, the payment and the audit entry are written', async () => {
    const orderId = await place(sokha)
    const order = await pay(orderId)
    expect(order).toMatchObject({ status: 'preparing', version: 2, paidAt: monday('12:05').toISOString(), payment: { method: 'cash_usd', amountMinor: 875, collectedAt: monday('12:05').toISOString() } })
    expect((await eventsOf(orderId)).map(e => [e.toVersion, e.fromStatus, e.toStatus, e.actorId])).toEqual([
      [1, null, 'awaiting_payment', sokha.userId],
      [2, 'awaiting_payment', 'preparing', cashier.userId],
    ])
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, orderId))
    expect(audit).toMatchObject({ action: 'orders.order.pay', actorId: cashier.userId, branchId, metadata: { from: 'awaiting_payment', to: 'preparing', method: 'cash_usd', amountMinor: 875, amountKhr: null } })
  })

  it('cash in riel: the riel at the rate in force, rounded up to 100, and the rate are recorded', async () => {
    await setExchangeRate(db, rateSetter, { khrPerUsd: 4100 }, monday('09:00'))
    const orderId = await place(sokha)
    const order = await pay(orderId, { version: 1, method: 'cash_khr', khrPerUsd: 4100 })
    expect(order.payment).toMatchObject({ method: 'cash_khr', amountMinor: 875, amountKhr: 35_900, khrPerUsd: 4100 })
  })

  it('cash in riel is refused without a rate, and at a rate other than the one in force', async () => {
    const orderId = await place(sokha)
    await expectApiError(() => pay(orderId, { version: 1, method: 'cash_khr', khrPerUsd: 4100 }), 409, 'NO_EXCHANGE_RATE')
    await setExchangeRate(db, rateSetter, { khrPerUsd: 4150 }, monday('09:00'))
    await expectApiError(() => pay(orderId, { version: 1, method: 'cash_khr', khrPerUsd: 4100 }), 409, 'EXCHANGE_RATE_CHANGED')
    expect(await paymentsOf(orderId)).toEqual([])
    expect(await statusOf(orderId)).toBe('awaiting_payment')
  })

  it('KHQR keeps the reference, if any', async () => {
    const orderId = await place(sokha)
    expect((await pay(orderId, { version: 1, method: 'khqr', reference: 'FT2609ABC' })).payment).toMatchObject({ method: 'khqr', reference: 'FT2609ABC', amountKhr: null })
  })

  it('is refused once the 30 minutes to pay are over', async () => {
    const orderId = await place(sokha, monday('11:00'))
    await expectApiError(() => pay(orderId, cash, cashier, monday('11:30')), 409, 'PAYMENT_EXPIRED')
    await pay(orderId, cash, cashier, monday('11:29'))
  })

  it('a stale version or an order already paid is refused with what it is now; nothing is written', async () => {
    const orderId = await place(sokha)
    await pay(orderId)
    await expectApiError(() => pay(orderId, cash, colleague), 409, 'ORDER_CHANGED')
    await expectApiError(() => pay(orderId, { version: 2, method: 'cash_usd' }, colleague), 409, 'ORDER_CHANGED')
    await expect(pay(orderId, cash, colleague)).rejects.toThrow('Order 001 changed meanwhile: it\'s paid and being prepared now.')
    expect(await paymentsOf(orderId)).toHaveLength(1)
  })
})

describe('two cashiers, or a retry', () => {
  it('two cashiers paying the same order at once: one payment, the other told it\'s paid', async () => {
    const orderId = await place(sokha)
    const on = racing(2)
    const results = await Promise.allSettled([pay(orderId, cash, cashier, monday('12:05'), on), pay(orderId, { version: 1, method: 'khqr', reference: null }, colleague, monday('12:05'), on)])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.data.code).toBe('ORDER_CHANGED')
    expect(await paymentsOf(orderId)).toHaveLength(1)
    expect(await eventsOf(orderId)).toHaveLength(2)
  })

  it('paying and cancelling at once: exactly one wins', async () => {
    const orderId = await place(sokha)
    const on = racing(2)
    const results = await Promise.allSettled([
      pay(orderId, cash, cashier, monday('12:05'), on),
      cancelOrderAtCounter(on, colleague, orderId, cancelInput(), key(), monday('12:05')),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const status = await statusOf(orderId)
    expect((await paymentsOf(orderId)).length).toBe(status === 'preparing' ? 1 : 0)
    expect(await eventsOf(orderId)).toHaveLength(2)
  })

  it('a change landing between the read and the write stops the batch (the version guard)', async () => {
    const orderId = await place(sokha)
    const meanwhile = () => cancelOrderAtCounter(db, colleague, orderId, cancelInput(), key(), monday('12:04'))
    await expectApiError(() => pay(orderId, cash, cashier, monday('12:05'), interleaved(db, meanwhile)), 409, 'ORDER_CHANGED')
    expect(await paymentsOf(orderId)).toEqual([])
    expect(await statusOf(orderId)).toBe('cancelled')
  })

  it('a retry with the same key returns the first answer and records nothing more; another body with it is refused', async () => {
    const orderId = await place(sokha)
    const same = key()
    const first = await pay(orderId, cash, cashier, monday('12:05'), db, same)
    const again = await pay(orderId, cash, cashier, monday('12:06'), db, same)
    expect(again).toEqual(first)
    expect(await paymentsOf(orderId)).toHaveLength(1)
    await expectApiError(() => pay(orderId, { version: 1, method: 'khqr', reference: null }, cashier, monday('12:06'), db, same), 422, 'IDEMPOTENCY_MISMATCH')
  })

  it('a riel payment retried after the rate changed still returns the first answer', async () => {
    await setExchangeRate(db, rateSetter, { khrPerUsd: 4100 }, monday('09:00'))
    const orderId = await place(sokha)
    const same = key()
    const input: PayOrderInput = { version: 1, method: 'cash_khr', khrPerUsd: 4100 }
    const first = await pay(orderId, input, cashier, monday('12:05'), db, same)
    await setExchangeRate(db, rateSetter, { khrPerUsd: 4200 }, monday('12:06'))
    expect(await pay(orderId, input, cashier, monday('12:07'), db, same)).toEqual(first)
  })
})

describe('ready and completed', () => {
  it('preparing → ready → completed, each once, each with its event', async () => {
    const orderId = await place(sokha)
    await pay(orderId)
    await expectApiError(() => completeOrder(db, cashier, orderId, { version: 2 }, key(), monday('12:09')), 409, 'ORDER_CHANGED')
    expect(await markOrderReady(db, cashier, orderId, { version: 2 }, key(), monday('12:10'))).toMatchObject({ status: 'ready', readyAt: monday('12:10').toISOString(), version: 3 })
    await expectApiError(() => markOrderReady(db, colleague, orderId, { version: 3 }, key(), monday('12:11')), 409, 'ORDER_CHANGED')
    expect(await completeOrder(db, colleague, orderId, { version: 3 }, key(), monday('12:12'))).toMatchObject({ status: 'completed', completedAt: monday('12:12').toISOString(), version: 4 })
    expect((await eventsOf(orderId)).map(e => e.toStatus)).toEqual(['awaiting_payment', 'preparing', 'ready', 'completed'])
    // Completed: no longer in the queue, still readable.
    expect((await listCounterQueue(db, cashier, monday('12:13'))).orders).toEqual([])
    expect((await getCounterOrder(db, cashier, orderId)).status).toBe('completed')
  })

  it('an unpaid order can\'t be marked ready', async () => {
    const orderId = await place(sokha)
    await expectApiError(() => markOrderReady(db, cashier, orderId, { version: 1 }, key(), monday('12:05')), 409, 'ORDER_CHANGED')
  })
})

describe('cancelling', () => {
  it('an unpaid order, with a reason; it leaves the queue and frees the customer\'s unpaid slot', async () => {
    const orderId = await place(sokha)
    await place(sokha, monday('12:01'))
    const order = await cancelOrderAtCounter(db, cashier, orderId, cancelInput({ reason: 'other', note: 'Left the cafe' }), key(), monday('12:05'))
    expect(order).toMatchObject({ status: 'cancelled', cancelledAt: monday('12:05').toISOString() })
    expect((await eventsOf(orderId))[1]).toMatchObject({ toStatus: 'cancelled', reason: 'other', note: 'Left the cafe', actorId: cashier.userId })
    // Two unpaid at most (D99): the cancelled one no longer counts.
    await place(sokha, monday('12:06'))
  })

  it('a paid order being prepared: says how the money went back (Q36)', async () => {
    const orderId = await place(sokha)
    await pay(orderId)
    await expectApiError(() => cancelOrderAtCounter(db, cashier, orderId, cancelInput({ version: 2 }), key(), monday('12:06')), 400, 'VALIDATION_FAILED', ['returnMethod'])
    const order = await cancelOrderAtCounter(db, cashier, orderId, cancelInput({ version: 2, reason: 'item_unavailable', returnMethod: 'cash' }), key(), monday('12:06'))
    expect(order.payment).toMatchObject({ method: 'cash_usd', returnMethod: 'cash', returnedAt: monday('12:06').toISOString() })
  })

  it('an unpaid order has no money to give back', async () => {
    const orderId = await place(sokha)
    await expectApiError(() => cancelOrderAtCounter(db, cashier, orderId, cancelInput({ returnMethod: 'khqr' }), key(), monday('12:05')), 400, 'VALIDATION_FAILED', ['returnMethod'])
  })

  it('a ready or completed order needs an admin refund', async () => {
    const orderId = await place(sokha)
    await pay(orderId)
    await markOrderReady(db, cashier, orderId, { version: 2 }, key(), monday('12:10'))
    await expectApiError(() => cancelOrderAtCounter(db, cashier, orderId, cancelInput({ version: 3, returnMethod: 'cash' }), key(), monday('12:11')), 409, 'ORDER_NOT_CANCELLABLE')
  })

  it('"Other" needs words', () => {
    expect(() => parseInput(cancelOrderSchema, { version: 1, reason: 'other' })).toThrow()
    expect(parseInput(cancelOrderSchema, { version: 1, reason: 'other', note: '  Left  ' }).note).toBe('Left')
  })
})

describe('the riel rate', () => {
  it('rounds up to 100 riel', () => {
    expect(toRiel(875, 4100)).toBe(35_900)
    expect(toRiel(1000, 4100)).toBe(41_000)
    expect(toRiel(1, 4100)).toBe(100)
    expect(toRiel(0, 4100)).toBe(0)
  })

  it('keeps every change, newest first; setting the same rate again changes nothing', async () => {
    expect(await getExchangeRates(db, monday('08:00'))).toEqual({ current: null, history: [] })
    await setExchangeRate(db, rateSetter, { khrPerUsd: 4100 }, monday('09:00'))
    await setExchangeRate(db, rateSetter, { khrPerUsd: 4100 }, monday('09:30'))
    const rates = await setExchangeRate(db, rateSetter, { khrPerUsd: 4120 }, monday('10:00'))
    expect(rates.current).toMatchObject({ khrPerUsd: 4120, setBy: { name: 'Kim' } })
    expect(rates.history.map(rate => rate.khrPerUsd)).toEqual([4120, 4100])
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.exchange_rate.set')))).toHaveLength(2)
  })
})

describe('finished today (step 10.2, D117)', () => {
  /** Places, pays, readies and completes an order; returns its id. */
  async function completed(customer: Actor, placedAt: string, doneAt: string) {
    const orderId = await place(customer, monday(placedAt))
    await pay(orderId, cash, cashier, monday(placedAt))
    await markOrderReady(db, colleague, orderId, { version: 2 }, key(), monday(placedAt))
    await completeOrder(db, cashier, orderId, { version: 3 }, key(), monday(doneAt))
    return orderId
  }

  it('lists today\'s completed and cancelled orders, the most recently finished first; not those in play, another branch\'s, or another day\'s', async () => {
    const picked = await completed(sokha, '12:00', '12:20')
    const byCafe = await place(dara, monday('12:02'))
    await pay(byCafe, cash, cashier, monday('12:03'))
    await cancelOrderAtCounter(db, cashier, byCafe, cancelInput({ version: 2, reason: 'item_unavailable', note: 'Out of oat milk', returnMethod: 'cash' }), key(), monday('12:10'))
    const byCustomer = await place(sokha, monday('12:04'))
    await cancelMyOrder(db, sokha, byCustomer, { version: 1 }, key(), monday('12:06'))
    const expired = await place(dara, monday('12:05'))
    await expireUnpaidOrders(db, monday('12:40'))
    const inPlay = await place(sokha, monday('12:30'))
    await place(sokha, monday('12:31'), otherBranchId)

    const finished = await listFinishedToday(db, cashier, monday('13:00'))
    expect(finished.businessDate).toBe('2026-09-28')
    expect(finished.orders.map(o => o.id)).toEqual([expired, picked, byCafe, byCustomer])
    expect(finished.orders.find(o => o.id === byCafe)!.payment).toMatchObject({ method: 'cash_usd', returnMethod: 'cash' })
    expect(finished.orders.map(o => o.id)).not.toContain(inPlay)
    expect((await listCounterQueue(db, cashier, monday('13:00'))).finishedToday).toBe(4)

    // The business day starts at 4:00: still Monday's until then, then a new, empty day.
    const tuesday = (hhmm: string) => new Date(`2026-09-29T${hhmm}:00+07:00`)
    expect((await listFinishedToday(db, cashier, tuesday('03:59'))).orders).toHaveLength(4)
    const next = await listFinishedToday(db, cashier, tuesday('04:00'))
    expect([next.businessDate, next.orders]).toEqual(['2026-09-29', []])
    expect((await listCounterQueue(db, cashier, tuesday('04:00'))).finishedToday).toBe(0)
  })

  it('an order\'s history: every step with who took it, the staff\'s note and who gave the money back', async () => {
    const orderId = await place(sokha)
    await pay(orderId, cash, cashier, monday('12:03'))
    await cancelOrderAtCounter(db, colleague, orderId, cancelInput({ version: 2, reason: 'item_unavailable', note: 'Out of oat milk', returnMethod: 'cash' }), key(), monday('12:10'))

    const history = await getCounterOrderHistory(db, cashier, orderId)
    expect(history.order).toMatchObject({ id: orderId, status: 'cancelled' })
    expect(history.timeline).toEqual([
      { at: NOON.toISOString(), toStatus: 'awaiting_payment', by: { kind: 'customer', name: 'Sokha' }, reason: null, note: null },
      { at: monday('12:03').toISOString(), toStatus: 'preparing', by: { kind: 'staff', name: 'Sophea' }, reason: null, note: null },
      { at: monday('12:10').toISOString(), toStatus: 'cancelled', by: { kind: 'staff', name: 'Vanna' }, reason: 'item_unavailable', note: 'Out of oat milk' },
    ])
    expect(history.returnedBy).toBe('Vanna')
  })

  it('an expired order\'s cancel is the system\'s; another branch\'s order is not found', async () => {
    const orderId = await place(sokha)
    await expireUnpaidOrders(db, monday('12:40'))
    const history = await getCounterOrderHistory(db, cashier, orderId)
    expect(history.timeline.at(-1)).toMatchObject({ toStatus: 'cancelled', by: { kind: 'system', name: null } })
    expect(history.returnedBy).toBeNull()

    const elsewhere = await place(dara, NOON, otherBranchId)
    await expectApiError(() => getCounterOrderHistory(db, cashier, elsewhere), 404, 'NOT_FOUND')
  })
})
