import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { organization } from '../../../db/tables'
import { updateBranchSettings } from '../../branches'
import type { Actor, BranchActor } from '../../identity'
import { createCategory, createItem, publishItem } from '../../menu'
import { auditEvents } from '../../platform/platform.schema'
import { cancelOrderAtCounter, payOrder } from '../counter.service'
import { EXPIRY_NOTE, expireUnpaidOrders } from '../expiry.service'
import { orderEvents, orders } from '../orders.schema'
import { getOrder, placeOrder } from '../orders.service'
import { createTestDb, createUser } from '../../../tests/support/db'
import { interleaved } from '../../../tests/support/interleave'
import type { Db } from '../../../utils/batch'
import { newId } from '../../../utils/ids'

// The unpaid-order expiry (step 6.6, D104) against the real order and counter services and the
// migrations: what it cancels, what it leaves, and a cashier paying at the same moment.

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

async function place(customer: Actor, at: Date) {
  const { orderId } = await placeOrder(db, customer, {
    branchId,
    tableToken: null,
    lines: [{ itemId, variationId, modifierIds: [], quantity: 1, note: null }],
    expectedTotalMinor: 875,
  }, crypto.randomUUID(), at)
  return orderId
}

const statusOf = async (orderId: string) => (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]!.status
const eventsOf = async (orderId: string) => (await db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId))).sort((a, b) => a.toVersion - b.toVersion)

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

describe('expiring unpaid orders (D104)', () => {
  it('cancels only unpaid orders past their 30 minutes, as the system, with the event and audit entry', async () => {
    const late = await place(sokha, monday('11:00'))
    const onTime = await place(dara, monday('11:40'))
    const paid = await place(sokha, monday('11:05'))
    const cancelled = await place(dara, monday('11:06'))
    await payOrder(db, cashier, paid, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('11:10'))
    await cancelOrderAtCounter(db, cashier, cancelled, { version: 1, reason: 'customer_changed_mind', note: null, returnMethod: null }, crypto.randomUUID(), monday('11:10'))

    // 11:40: `late` (11:00) was due at 11:30; `paid` and `cancelled` were due too, but aren't unpaid.
    expect(await expireUnpaidOrders(db, monday('11:40'))).toEqual({ expired: 1, skipped: 0 })
    expect(await statusOf(late)).toBe('cancelled')
    expect(await statusOf(onTime)).toBe('awaiting_payment')
    expect(await statusOf(paid)).toBe('preparing')
    expect(await statusOf(cancelled)).toBe('cancelled')

    expect((await eventsOf(late)).at(-1)).toMatchObject({ toVersion: 2, actorId: null, fromStatus: 'awaiting_payment', toStatus: 'cancelled', reason: null, note: EXPIRY_NOTE })
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, late))
    expect(audit).toMatchObject({ action: 'orders.order.expire', actorId: null, branchId })
    // The customer sees it cancelled.
    expect(await getOrder(db, sokha, late)).toMatchObject({ status: 'cancelled', cancelledAt: monday('11:40').toISOString() })
  })

  it('exactly at the deadline, like the counter\'s refusal to take payment; a second run finds nothing', async () => {
    const orderId = await place(sokha, monday('11:00'))
    expect(await expireUnpaidOrders(db, new Date(monday('11:30').getTime() - 1))).toEqual({ expired: 0, skipped: 0 })
    expect(await expireUnpaidOrders(db, monday('11:30'))).toEqual({ expired: 1, skipped: 0 })
    expect(await expireUnpaidOrders(db, monday('11:31'))).toEqual({ expired: 0, skipped: 0 })
    expect(await eventsOf(orderId)).toHaveLength(2)
  })

  it('a cashier taking payment between the task\'s read and its write wins: the order is paid, not cancelled', async () => {
    const orderId = await place(sokha, monday('11:00'))
    const meanwhile = () => payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('11:29'))
    expect(await expireUnpaidOrders(interleaved(db, meanwhile), monday('11:30'))).toEqual({ expired: 0, skipped: 1 })
    expect(await statusOf(orderId)).toBe('preparing')
    expect((await eventsOf(orderId)).map(e => e.toStatus)).toEqual(['awaiting_payment', 'preparing'])
  })

  it('one order changed meanwhile doesn\'t stop the others', async () => {
    const first = await place(sokha, monday('11:00'))
    const second = await place(dara, monday('11:01'))
    const meanwhile = () => payOrder(db, cashier, first, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('11:29'))
    expect(await expireUnpaidOrders(interleaved(db, meanwhile), monday('11:40'))).toEqual({ expired: 1, skipped: 1 })
    expect(await statusOf(first)).toBe('preparing')
    expect(await statusOf(second)).toBe('cancelled')
  })
})
