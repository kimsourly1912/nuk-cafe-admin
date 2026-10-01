import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { organization } from '#server/db/tables'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { auditEvents } from '#server/features/platform/platform.schema'
import { cancelOrderAtCounter, completeOrder, markOrderReady, payOrder } from '#server/features/orders/counter.service'
import { expireUnpaidOrders } from '#server/features/orders/expiry.service'
import { orderEvents } from '#server/features/orders/orders.schema'
import { cancelMyOrder, getOrder, listMyOrders, placeOrder } from '#server/features/orders/orders.service'
import { createTestDb, createUser } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// The customer's side of an order (step 6.5, D106) against the real order and counter services
// and the migrations: what tracking reads, the list, and cancelling while unpaid.

let db: Db
const admin: Actor = { userId: 'admin-1', role: 'admin' }
let branchId: string
let itemId: string
let variationId: string
let sokha: Actor
let dara: Actor
let cashier: BranchActor

/** Monday 2026-09-28, local time in Phnom Penh (UTC+7). */
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)

/** An order of `quantity` Iced Lattes ($8.75 each). */
async function place(customer: Actor, at: Date, quantity = 1) {
  const { orderId } = await placeOrder(db, customer, {
    branchId,
    tableToken: null,
    lines: [{ itemId, variationId, modifierIds: [], quantity, note: null }],
    expectedTotalMinor: 875 * quantity,
  }, crypto.randomUUID(), at)
  return orderId
}

const key = () => crypto.randomUUID()
const eventsOf = async (orderId: string) => db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId))

beforeEach(async () => {
  db = await createTestDb()
  branchId = newId()
  await db.insert(organization).values({ id: branchId, name: 'Riverside', slug: branchId, timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  await updateBranchSettings(db, admin, branchId, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 })) })
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
  sokha = { userId: (await createUser(db)).id, role: 'customer' }
  dara = { userId: (await createUser(db)).id, role: 'customer' }
  cashier = { userId: (await createUser(db)).id, role: 'customer', branchId, branchRole: 'staff' }
})

describe('tracking an order (D106)', () => {
  it('reads each step\'s time, the version and the payment as it moves along', async () => {
    const orderId = await place(sokha, monday('10:15'))
    expect(await getOrder(db, sokha, orderId)).toMatchObject({ version: 1, status: 'awaiting_payment', paidAt: null, readyAt: null, completedAt: null, payment: null, cancellation: null })

    await payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, key(), monday('10:21'))
    expect(await getOrder(db, sokha, orderId)).toMatchObject({
      version: 2,
      status: 'preparing',
      paidAt: monday('10:21').toISOString(),
      payment: { method: 'cash_usd', amountMinor: 875, amountKhr: null, collectedAt: monday('10:21').toISOString(), returnMethod: null, returnedAt: null },
    })
    // What the counter sees about the cashier stays at the counter.
    expect(Object.keys((await getOrder(db, sokha, orderId)).payment!)).not.toContain('collectedBy')

    await markOrderReady(db, cashier, orderId, { version: 2 }, key(), monday('10:30'))
    await completeOrder(db, cashier, orderId, { version: 3 }, key(), monday('10:34'))
    expect(await getOrder(db, sokha, orderId)).toMatchObject({ version: 4, status: 'completed', readyAt: monday('10:30').toISOString(), completedAt: monday('10:34').toISOString(), cancellation: null })
  })

  it('says who cancelled: the customer, the cafe with its reason and the money returned, or the system', async () => {
    const mine = await place(sokha, monday('10:00'))
    await cancelMyOrder(db, sokha, mine, { version: 1 }, key(), monday('10:05'))
    expect((await getOrder(db, sokha, mine)).cancellation).toEqual({ by: 'customer', reason: null })

    const cafe = await place(sokha, monday('10:10'))
    await payOrder(db, cashier, cafe, { version: 1, method: 'cash_usd' }, key(), monday('10:12'))
    await cancelOrderAtCounter(db, cashier, cafe, { version: 2, reason: 'item_unavailable', note: 'Out of ice', returnMethod: 'cash' }, key(), monday('10:14'))
    const byCafe = await getOrder(db, sokha, cafe)
    expect(byCafe.cancellation).toEqual({ by: 'cafe', reason: 'item_unavailable' })
    expect(byCafe.payment).toMatchObject({ returnMethod: 'cash', returnedAt: monday('10:14').toISOString() })
    // The staff's own words aren't shown to the customer.
    expect(JSON.stringify(byCafe)).not.toContain('Out of ice')

    const late = await place(sokha, monday('11:00'))
    await expireUnpaidOrders(db, monday('11:30'))
    expect((await getOrder(db, sokha, late)).cancellation).toEqual({ by: 'system', reason: null })
  })
})

describe('the customer\'s orders (D106)', () => {
  it('lists every order still in play and a page of finished ones, newest first, only their own', async () => {
    const completed = await place(sokha, monday('09:00'), 3)
    await payOrder(db, cashier, completed, { version: 1, method: 'khqr', reference: null }, key(), monday('09:01'))
    await markOrderReady(db, cashier, completed, { version: 2 }, key(), monday('09:05'))
    await completeOrder(db, cashier, completed, { version: 3 }, key(), monday('09:06'))
    const cancelled = await place(sokha, monday('09:30'))
    await cancelMyOrder(db, sokha, cancelled, { version: 1 }, key(), monday('09:31'))
    const preparing = await place(sokha, monday('10:00'), 2)
    await payOrder(db, cashier, preparing, { version: 1, method: 'cash_usd' }, key(), monday('10:01'))
    const waiting = await place(sokha, monday('10:15'))
    await place(dara, monday('10:16'))

    const first = await listMyOrders(db, sokha, { page: 1, pageSize: 1 })
    expect(first.inProgress.map(o => [o.id, o.status, o.itemCount])).toEqual([[waiting, 'awaiting_payment', 1], [preparing, 'preparing', 2]])
    expect(first.past).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 })
    expect(first.past.items.map(o => [o.id, o.status])).toEqual([[cancelled, 'cancelled']])
    const second = await listMyOrders(db, sokha, { page: 2, pageSize: 1 })
    expect(second.past.items.map(o => [o.id, o.status, o.itemCount, o.totalMinor])).toEqual([[completed, 'completed', 3, 2625]])

    expect(await listMyOrders(db, { userId: (await createUser(db)).id, role: 'customer' }, { page: 1, pageSize: 20 }))
      .toEqual({ inProgress: [], past: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 } })
  })
})

describe('the customer cancelling (D45, D106)', () => {
  it('cancels their unpaid order, as themselves with the reason "changed their mind", audited; the unpaid limit frees up', async () => {
    await place(sokha, monday('10:00'))
    const second = await place(sokha, monday('10:01'))
    const order = await cancelMyOrder(db, sokha, second, { version: 1 }, key(), monday('10:02'))
    expect(order).toMatchObject({ status: 'cancelled', version: 2, cancelledAt: monday('10:02').toISOString() })
    expect((await eventsOf(second)).find(e => e.toStatus === 'cancelled')).toMatchObject({ actorId: sokha.userId, fromStatus: 'awaiting_payment', reason: 'customer_changed_mind', note: null })
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, second))
    expect(audit).toMatchObject({ action: 'orders.order.customer_cancel', actorId: sokha.userId, branchId })
    // Two unpaid at most: cancelling one lets a new one through.
    await expect(place(sokha, monday('10:03'))).resolves.toBeTruthy()
  })

  it('someone else\'s order is 404, like an unknown one', async () => {
    const orderId = await place(sokha, monday('10:00'))
    await expectApiError(() => cancelMyOrder(db, dara, orderId, { version: 1 }, key(), monday('10:01')), 404, 'NOT_FOUND')
    await expectApiError(() => cancelMyOrder(db, dara, newId(), { version: 1 }, key(), monday('10:01')), 404, 'NOT_FOUND')
    expect((await getOrder(db, sokha, orderId)).status).toBe('awaiting_payment')
  })

  it('once paid it can\'t be cancelled here, whatever version is sent; a cancelled one says so', async () => {
    const orderId = await place(sokha, monday('10:00'))
    await payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, key(), monday('10:05'))
    const paid = 'Order 001 is paid now, so it can\'t be cancelled here. Ask at the counter.'
    await expectApiError(() => cancelMyOrder(db, sokha, orderId, { version: 1 }, key(), monday('10:06')), 409, 'ORDER_NOT_CANCELLABLE', undefined, paid)
    await expectApiError(() => cancelMyOrder(db, sokha, orderId, { version: 2 }, key(), monday('10:06')), 409, 'ORDER_NOT_CANCELLABLE', undefined, paid)

    const other = await place(sokha, monday('10:10'))
    await cancelMyOrder(db, sokha, other, { version: 1 }, key(), monday('10:11'))
    await expectApiError(() => cancelMyOrder(db, sokha, other, { version: 2 }, key(), monday('10:12')), 409, 'ORDER_CHANGED', undefined, 'Order 002 is already cancelled.')
  })

  it('a retry with the same key answers the same and cancels once', async () => {
    const orderId = await place(sokha, monday('10:00'))
    const retry = key()
    const first = await cancelMyOrder(db, sokha, orderId, { version: 1 }, retry, monday('10:01'))
    const again = await cancelMyOrder(db, sokha, orderId, { version: 1 }, retry, monday('10:02'))
    expect(again).toEqual(first)
    expect((await eventsOf(orderId)).filter(e => e.toStatus === 'cancelled')).toHaveLength(1)
  })

  it('a payment recorded between the read and the write wins: the order is paid, and the customer is told to ask at the counter', async () => {
    const orderId = await place(sokha, monday('10:00'))
    const meanwhile = () => payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, key(), monday('10:05'))
    await expectApiError(() => cancelMyOrder(interleaved(db, meanwhile), sokha, orderId, { version: 1 }, key(), monday('10:05')), 409, 'ORDER_NOT_CANCELLABLE')
    expect(await getOrder(db, sokha, orderId)).toMatchObject({ status: 'preparing', payment: { method: 'cash_usd' } })
    expect((await eventsOf(orderId)).map(e => e.toStatus).sort()).toEqual(['awaiting_payment', 'preparing'])
  })
})
