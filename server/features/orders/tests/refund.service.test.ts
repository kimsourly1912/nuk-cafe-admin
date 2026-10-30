import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PayOrderInput, RefundOrderInput } from '#shared/contracts/orders'
import { refundOrderSchema } from '#shared/contracts/orders'
import { reportPeriodQuerySchema } from '#shared/contracts/reports'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { auditEvents, idempotencyKeys } from '#server/features/platform/platform.schema'
import { cancelOrderAtCounter, completeOrder, listCounterQueue, markOrderReady, payOrder } from '#server/features/orders/counter.service'
import { counterPayments, orderEvents, orders } from '#server/features/orders/orders.schema'
import { placeOrder } from '#server/features/orders/orders.service'
import { refundOrder } from '#server/features/orders/refund.service'
import { reportSummary } from '#server/features/orders/reports.service'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { parseInput } from '#server/utils/validation'

// An owner's refund of a ready or completed order (D233) against the real menu, branch, counter and
// report services and the migrations: what it writes, what it refuses, and the guards behind it.

let db: Db
const admin: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner' }
let branchId: string
let otherBranchId: string
let itemId: string
let variationId: string
let sokha: Actor
let cashier: BranchActor
let owner: BranchActor

/** Phnom Penh time (UTC+7). */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`)
const MON = '2026-09-28'
const TUE = '2026-09-29'
const allWeek = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 }))

async function addBranch(name: string) {
  const id = newId()
  await insertBranch(db, { id, name, timezone: 'Asia/Phnom_Penh', status: 'active' })
  await updateBranchSettings(db, admin, id, { version: 1, hours: allWeek })
  return id
}

const key = () => crypto.randomUUID()
const cash: PayOrderInput = { version: 1, method: 'cash_usd' }
const refund = (over: Partial<RefundOrderInput> = {}): RefundOrderInput =>
  parseInput(refundOrderSchema, { version: 4, returnMethod: 'khqr', note: 'Wrong drink', ...over })

/** A $8.75 order placed Monday at noon in `branch`, paid at 12:05, then taken as far as `to`. */
async function order(to: 'awaiting_payment' | 'preparing' | 'ready' | 'completed', branch = branchId) {
  const counter = { ...cashier, branchId: branch }
  const { orderId } = await placeOrder(db, sokha, {
    branchId: branch,
    tableToken: null,
    lines: [{ itemId, variationId, modifierIds: [], quantity: 1, note: null }],
    expectedTotalMinor: 875,
  }, key(), at(MON, '12:00'))
  if (to === 'awaiting_payment') return orderId
  await payOrder(db, counter, orderId, cash, key(), at(MON, '12:05'))
  if (to === 'preparing') return orderId
  await markOrderReady(db, counter, orderId, { version: 2 }, key(), at(MON, '12:10'))
  if (to === 'ready') return orderId
  await completeOrder(db, counter, orderId, { version: 3 }, key(), at(MON, '12:15'))
  return orderId
}

const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!
const paymentRow = async (id: string) => (await db.select().from(counterPayments).where(eq(counterPayments.orderId, id)))[0]!
const eventsOf = async (id: string) => (await db.select().from(orderEvents).where(eq(orderEvents.orderId, id))).sort((a, b) => a.toVersion - b.toVersion)
const refundAudits = async () => db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.order.refund'))

/** Everything a refund writes, to show a refused one wrote nothing. */
async function written(id: string) {
  return { order: await orderRow(id), payment: await paymentRow(id).catch(() => null), events: (await eventsOf(id)).length, audits: (await refundAudits()).length }
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
  sokha = { userId: (await createUser(db, 'sokha@example.com', 'Sokha Chan')).id, tenantId: TEST_TENANT, role: 'customer' }
  cashier = { userId: (await createUser(db, 'sophea@example.com', 'Sophea')).id, tenantId: TEST_TENANT, role: 'customer', branchId, branchRole: 'staff' }
  owner = { userId: (await createUser(db, 'kim@example.com', 'Kim Owner')).id, tenantId: TEST_TENANT, role: 'owner', branchId }
})

describe('a completed order', () => {
  it('stays completed, keeping its completion time; its payment shows the money went back', async () => {
    const id = await order('completed')
    const detail = await refundOrder(db, owner, id, refund(), key(), at(TUE, '09:00'))

    const row = await orderRow(id)
    expect([row.status, row.version]).toEqual(['completed', 5])
    expect(row.completedAt).toEqual(at(MON, '12:15'))
    expect(row.cancelledAt).toBeNull()
    expect(await paymentRow(id)).toMatchObject({ returnMethod: 'khqr', returnedBy: owner.userId, returnedAt: at(TUE, '09:00'), amountMinor: 875 })
    expect((await eventsOf(id)).at(-1)).toMatchObject({ toVersion: 5, actorId: owner.userId, fromStatus: 'completed', toStatus: 'completed', reason: 'other', note: 'Wrong drink' })
    expect(await refundAudits()).toMatchObject([{ actorId: owner.userId, targetId: id, branchId, metadata: { from: 'completed', to: 'completed', returnMethod: 'khqr', amountMinor: 875 } }])

    expect(detail).toMatchObject({ id, status: 'completed', version: 5, payment: { state: 'refunded', returnMethod: 'khqr', returnedBy: 'Kim Owner', returnedAt: at(TUE, '09:00').toISOString() } })
  })

  it('counts in reports on the day the money went back; the day it was paid keeps its sales', async () => {
    const id = await order('completed')
    await refundOrder(db, owner, id, refund(), key(), at(TUE, '09:00'))
    const period = (day: string) => parseInput(reportPeriodQuerySchema, { branchId, from: day, to: day })
    const monday = await reportSummary(db, TEST_TENANT, period(MON), at(TUE, '12:00'))
    const tuesday = await reportSummary(db, TEST_TENANT, period(TUE), at(TUE, '12:00'))
    expect([monday.paid.salesMinor, monday.refunds]).toEqual([875, { amountMinor: 0, orders: 0 }])
    expect([tuesday.paid.salesMinor, tuesday.refunds]).toEqual([0, { amountMinor: 875, orders: 1 }])
  })
})

describe('a ready order', () => {
  it('is cancelled and leaves the counter\'s queue', async () => {
    const id = await order('ready')
    expect((await listCounterQueue(db, cashier, at(MON, '12:20'))).orders.map(o => o.id)).toEqual([id])

    const detail = await refundOrder(db, owner, id, refund({ version: 3, returnMethod: 'cash' }), key(), at(MON, '12:20'))
    const row = await orderRow(id)
    expect([row.status, row.version, row.cancelledAt, row.readyAt]).toEqual(['cancelled', 4, at(MON, '12:20'), at(MON, '12:10')])
    expect(await paymentRow(id)).toMatchObject({ returnMethod: 'cash', returnedAt: at(MON, '12:20') })
    expect(detail).toMatchObject({ status: 'cancelled', payment: { state: 'refunded', returnMethod: 'cash' } })
    expect((await listCounterQueue(db, cashier, at(MON, '12:21'))).orders).toEqual([])
  })
})

describe('what it refuses, writing nothing', () => {
  it('an order not yet ready: unpaid, or being prepared (the counter cancels those)', async () => {
    const unpaid = await order('awaiting_payment')
    const before = await written(unpaid)
    await expectApiError(() => refundOrder(db, owner, unpaid, refund({ version: 1 }), key(), at(MON, '12:20')), 409, 'ORDER_NOT_REFUNDABLE', undefined, 'Order 001 isn\'t paid: there\'s nothing to refund.')
    expect(await written(unpaid)).toEqual(before)

    const preparing = await order('preparing')
    const prepared = await written(preparing)
    await expectApiError(() => refundOrder(db, owner, preparing, refund({ version: 2 }), key(), at(MON, '12:20')), 409, 'ORDER_NOT_REFUNDABLE', undefined, 'Order 002 is being prepared: cancel it at the counter, saying how the money went back.')
    expect(await written(preparing)).toEqual(prepared)
  })

  it('a cancelled order, and one already refunded (at the counter or here)', async () => {
    const cancelled = await order('preparing')
    await cancelOrderAtCounter(db, cashier, cancelled, { version: 2, reason: 'item_unavailable', note: null, returnMethod: 'cash' }, key(), at(MON, '12:08'))
    await expectApiError(() => refundOrder(db, owner, cancelled, refund({ version: 3 }), key(), at(MON, '12:20')), 409, 'ORDER_NOT_REFUNDABLE', undefined, 'Order 001 is already refunded.')

    const id = await order('completed')
    await refundOrder(db, owner, id, refund(), key(), at(TUE, '09:00'))
    const once = await written(id)
    await expectApiError(() => refundOrder(db, owner, id, refund({ version: 5 }), key(), at(TUE, '09:05')), 409, 'ORDER_NOT_REFUNDABLE', undefined, 'Order 002 is already refunded.')
    expect(await written(id)).toEqual(once)
  })

  it('more than 30 days after its payment; 30 days exactly is still allowed', async () => {
    const late = await order('completed')
    const thirtyDays = new Date(at(MON, '12:05').getTime() + 30 * 24 * 60 * 60 * 1000)
    const before = await written(late)
    await expectApiError(() => refundOrder(db, owner, late, refund(), key(), new Date(thirtyDays.getTime() + 60_000)), 409, 'REFUND_TOO_LATE')
    expect(await written(late)).toEqual(before)
    await expect(refundOrder(db, owner, late, refund(), key(), thirtyDays)).resolves.toMatchObject({ payment: { state: 'refunded' } })
  })

  it('a stale version: someone changed the order since the screen read it', async () => {
    const id = await order('completed')
    const before = await written(id)
    await expectApiError(() => refundOrder(db, owner, id, refund({ version: 3 }), key(), at(TUE, '09:00')), 409, 'ORDER_CHANGED', undefined, 'Order 001 changed meanwhile: it\'s completed now.')
    expect(await written(id)).toEqual(before)
  })

  it('another branch\'s order (the branch in the path), and another cafe\'s: not found', async () => {
    const elsewhere = await order('completed', otherBranchId)
    await expectApiError(() => refundOrder(db, owner, elsewhere, refund(), key(), at(TUE, '09:00')), 404, 'NOT_FOUND')

    const id = await order('completed')
    await ensureTenant(db, 'tenant-2')
    const otherCafe: BranchActor = { ...owner, tenantId: 'tenant-2' }
    await expectApiError(() => refundOrder(db, otherCafe, id, refund(), key(), at(TUE, '09:00')), 404, 'NOT_FOUND')
    expect((await paymentRow(id)).returnedAt).toBeNull()
  })
})

describe('retries and races', () => {
  it('the same key again returns the first answer and writes nothing more; with another body it is refused', async () => {
    const id = await order('completed')
    const k = key()
    const first = await refundOrder(db, owner, id, refund(), k, at(TUE, '09:00'))
    const again = await refundOrder(db, owner, id, refund(), k, at(TUE, '09:01'))
    expect(again).toEqual(first)
    expect(await refundAudits()).toHaveLength(1)
    expect(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.operation, 'orders.refund'))).toHaveLength(1)
    await expectApiError(() => refundOrder(db, owner, id, refund({ returnMethod: 'cash' }), k, at(TUE, '09:02')), 422, 'IDEMPOTENCY_MISMATCH')
  })

  it('a payment returned between the read and the write, outside the version, stops the batch (the payment guard)', async () => {
    const id = await order('completed')
    const racer = Object.create(db) as Db
    racer.batch = (async (statements: Parameters<Db['batch']>[0]) => {
      // Something returns the money without touching the order's version, just before the refund's batch.
      await db.update(counterPayments).set({ returnMethod: 'cash', returnedBy: cashier.userId, returnedAt: at(TUE, '08:59') }).where(eq(counterPayments.orderId, id))
      return db.batch(statements)
    }) as unknown as Db['batch']

    await expect(refundOrder(racer, owner, id, refund(), key(), at(TUE, '09:00'))).rejects.toThrow()
    const row = await orderRow(id)
    expect([row.status, row.version]).toEqual(['completed', 4])
    expect(await paymentRow(id)).toMatchObject({ returnMethod: 'cash', returnedAt: at(TUE, '08:59') })
    expect(await refundAudits()).toHaveLength(0)
  })
})
