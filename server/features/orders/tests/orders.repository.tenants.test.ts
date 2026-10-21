import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { KhqrSettingsInput } from '#shared/contracts/orders'
import { orderHistoryQuerySchema } from '#shared/contracts/reports'
import { findBranchClock, listActiveBranchClocks, updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { cancelOrderAtCounter, payOrder } from '#server/features/orders/counter.service'
import { createKhqrCharge, saveKhqrSettings } from '#server/features/orders/khqr.service'
import * as khqrRepo from '#server/features/orders/khqr.repository'
import { cancelMyOrder, placeOrder } from '#server/features/orders/orders.service'
import * as repo from '#server/features/orders/orders.repository'
import { counterPayments, orders } from '#server/features/orders/orders.schema'
import * as reportsRepo from '#server/features/orders/reports.repository'
import { periodInstants } from '#server/features/orders/reports.rules'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'
import { isStaleWrite, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { parseInput } from '#server/utils/validation'

/**
 * The second layer of tenant isolation (repositories.md → The tenant rule, D194): every orders,
 * reports and KHQR query names the cafe itself, not only through the service's parent check.
 * Another cafe's real orders, payments, events and QRs, asked for with our cafe's id, are never
 * read or changed. Each case also reads them with their own cafe's id, so an empty answer can't
 * come from a wrong fixture.
 */

const OTHER = 'tenant-2'
const DAY = '2026-09-28'
const monday = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+07:00`)
const allWeek = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 }))
const SETTINGS: KhqrSettingsInput = { version: 0, enabled: true, accountId: 'other@aclb', merchantName: 'Other Cafe', merchantCity: 'Phnom Penh', currencies: ['USD'] }

let db: Db
let branchId: string
let refunded: string
let cancelled: string
let waiting: string
let chargeId: string

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  const owner: Actor = { userId: (await createUser(db, 'owner@other.example', 'Owner')).id, tenantId: OTHER, role: 'owner' }
  branchId = newId()
  await insertBranch(db, { id: branchId, name: 'Their branch', timezone: 'Asia/Phnom_Penh', tenantId: OTHER })
  await updateBranchSettings(db, owner, branchId, { version: 1, hours: allWeek })
  const category = await createCategory(db, owner, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, owner, { categoryId: category.id, name: 'Iced Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 875, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const item = await publishItem(db, owner, draft.id, { version: draft.version })
  const cashier: BranchActor = { userId: (await createUser(db, 'cashier@other.example', 'Cashier')).id, tenantId: OTHER, role: 'member', branchId, branchRole: 'staff' }
  const place = async (hhmm: string, name: string) => {
    const customer: Actor = { userId: (await createUser(db, `${name}@example.com`, name)).id, tenantId: OTHER, role: 'customer' }
    const order = { branchId, tableToken: null, lines: [{ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 2, note: null }], expectedTotalMinor: 1750 }
    return { customer, orderId: (await placeOrder(db, customer, order, crypto.randomUUID(), monday(hhmm))).orderId }
  }

  // Paid, then cancelled with the money returned.
  refunded = (await place('09:00', 'dara')).orderId
  await payOrder(db, cashier, refunded, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('09:05'))
  await cancelOrderAtCounter(db, cashier, refunded, { version: 2, reason: 'item_unavailable', note: null, returnMethod: 'cash' }, crypto.randomUUID(), monday('09:10'))
  // Cancelled by its customer before paying.
  const unpaid = await place('10:00', 'sokha')
  cancelled = unpaid.orderId
  await cancelMyOrder(db, unpaid.customer, cancelled, { version: 1 }, crypto.randomUUID(), monday('10:01'))
  // Still waiting, with a QR.
  waiting = (await place('11:00', 'vanna')).orderId
  await saveKhqrSettings(db, owner, SETTINGS, monday('08:00'))
  chargeId = (await createKhqrCharge(db, cashier, waiting, { currency: 'USD' }, monday('11:01'))).id
})

const NOW = monday('11:02')
const range = (tenantId: string) => ({ tenantId, branchId, ...periodInstants({ from: DAY, to: DAY }, 'Asia/Phnom_Penh') })
const dates = (tenantId: string) => ({ tenantId, branchId, from: DAY, to: DAY })

describe('orders repository: another cafe\'s rows with our cafe\'s id', () => {
  it('reads no lines, payments, events or counts', async () => {
    const ids = [refunded, cancelled, waiting]
    expect(await repo.linesOf(db, TEST_TENANT, refunded)).toEqual([])
    expect(await repo.linesOf(db, OTHER, refunded)).toHaveLength(1)
    expect(await repo.linesOfOrders(db, TEST_TENANT, ids)).toEqual([])
    expect(await repo.linesOfOrders(db, OTHER, ids)).toHaveLength(3)
    expect(await repo.paymentsOf(db, TEST_TENANT, ids)).toEqual([])
    expect(await repo.paymentsOf(db, OTHER, ids)).toHaveLength(1)
    expect(await repo.itemCounts(db, TEST_TENANT, ids)).toEqual(new Map())
    expect((await repo.itemCounts(db, OTHER, ids)).get(refunded)).toBe(2)
    expect(await repo.cancelEventOf(db, TEST_TENANT, cancelled)).toBeUndefined()
    expect(await repo.cancelEventOf(db, OTHER, cancelled)).toBeDefined()
  })

  it('lists none of their branch\'s queue or finished orders', async () => {
    expect(await repo.findFinishedOrders(db, TEST_TENANT, branchId, DAY)).toEqual([])
    expect(await repo.findFinishedOrders(db, OTHER, branchId, DAY)).toHaveLength(2)
    expect(await repo.counterQueueRows(db, TEST_TENANT, branchId, DAY, NOW)).toEqual({ rows: [], lines: [], payments: [], finishedToday: 0 })
    expect((await repo.counterQueueRows(db, OTHER, branchId, DAY, NOW)).rows.map(row => row.id)).toEqual([waiting])
  })

  it('changes nothing: a transition stops its batch, a return touches no payment', async () => {
    const change = { tenantId: TEST_TENANT, orderId: waiting, fromStatus: 'awaiting_payment' as const, toStatus: 'cancelled' as const, version: 1, at: NOW }
    const stopped = await db.batch([repo.transitionStatement(db, change), requireOneChange(db)]).catch(error => error)
    expect(isStaleWrite(stopped)).toBe(true)
    expect((await repo.findOrder(db, OTHER, waiting))?.status).toBe('awaiting_payment')

    await db.batch([repo.returnPaymentStatement(db, TEST_TENANT, refunded, { returnMethod: 'khqr', returnedBy: 'someone', returnedAt: NOW })])
    expect((await db.select({ returnMethod: counterPayments.returnMethod }).from(counterPayments).where(eq(counterPayments.orderId, refunded)))).toEqual([{ returnMethod: 'cash' }])
  })

  it('counts only the cafe\'s own unpaid orders in the guard', async () => {
    const [{ customerId }] = await db.select({ customerId: orders.customerId }).from(orders).where(eq(orders.id, waiting)) as [{ customerId: string }]
    await db.batch([repo.requireUnpaidAtMost(db, TEST_TENANT, customerId, NOW, 0)])
    await expect(db.batch([repo.requireUnpaidAtMost(db, OTHER, customerId, NOW, 0)])).rejects.toSatisfy(isStaleWrite)
  })
})

describe('reports repository: another cafe\'s branch with our cafe\'s id', () => {
  it('sums, counts and lists nothing of it', async () => {
    expect(await reportsRepo.paidSalesTotal(db, range(TEST_TENANT))).toBe(0)
    expect(await reportsRepo.paidSalesTotal(db, range(OTHER))).toBe(1750)
    expect(await reportsRepo.refundsReturned(db, range(TEST_TENANT))).toEqual({ amountMinor: 0, orders: 0 })
    expect(await reportsRepo.refundsReturned(db, range(OTHER))).toEqual({ amountMinor: 1750, orders: 1 })
    expect(await reportsRepo.itemTotals(db, range(TEST_TENANT), 'collected')).toEqual([])
    expect(await reportsRepo.itemTotals(db, range(OTHER), 'returned')).toHaveLength(1)
    expect(await reportsRepo.paymentsCollected(db, range(TEST_TENANT), [{ start: 0, end: Number.MAX_SAFE_INTEGER }])).toEqual([])
    expect(await reportsRepo.ordersPlaced(db, dates(TEST_TENANT))).toBe(0)
    expect(await reportsRepo.ordersPlaced(db, dates(OTHER))).toBe(3)
    expect(await reportsRepo.cancelledUnpaid(db, dates(TEST_TENANT))).toEqual([])
    expect(await reportsRepo.cancelledUnpaid(db, dates(OTHER))).toEqual([{ by: 'customer', n: 1 }])
    expect(await reportsRepo.currentCounts(db, TEST_TENANT, branchId, NOW)).toEqual([])
    expect(await reportsRepo.currentCounts(db, OTHER, branchId, NOW)).toEqual([{ status: 'awaiting_payment', n: 1 }])
  })

  it('reads none of its order history, events or refunds', async () => {
    const query = parseInput(orderHistoryQuerySchema, { branchId, from: DAY, to: DAY })
    expect(await reportsRepo.orderHistory(db, TEST_TENANT, query)).toEqual({ rows: [], total: 0 })
    expect((await reportsRepo.orderHistory(db, OTHER, query)).total).toBe(3)
    expect(await reportsRepo.orderHistory(db, TEST_TENANT, { ...query, payment: 'refunded' })).toEqual({ rows: [], total: 0 })
    expect((await reportsRepo.orderHistory(db, OTHER, { ...query, payment: 'refunded' })).total).toBe(1)
    expect(await reportsRepo.eventsOf(db, TEST_TENANT, refunded)).toEqual([])
    expect(await reportsRepo.eventsOf(db, OTHER, refunded)).toHaveLength(3)
    expect(await reportsRepo.returnedByName(db, TEST_TENANT, refunded)).toBeNull()
    expect(await reportsRepo.returnedByName(db, OTHER, refunded)).toBe('Cashier')
  })
})

describe('KHQR repository and branch clocks: another cafe\'s with our cafe\'s id', () => {
  it('finds none of its QRs or branches', async () => {
    expect(await khqrRepo.findOpenCharge(db, TEST_TENANT, waiting, 'USD', NOW)).toBeUndefined()
    expect((await khqrRepo.findOpenCharge(db, OTHER, waiting, 'USD', NOW))?.id).toBe(chargeId)
    expect(await khqrRepo.findCharge(db, TEST_TENANT, chargeId)).toBeUndefined()
    expect(await khqrRepo.findBakongTokenExpiry(db, OTHER)).toBeUndefined()
    expect(await findBranchClock(db, TEST_TENANT, branchId)).toBeUndefined()
    expect(await findBranchClock(db, OTHER, branchId)).toEqual({ id: branchId, name: 'Their branch', timeZone: 'Asia/Phnom_Penh' })
    expect(await listActiveBranchClocks(db, TEST_TENANT)).toEqual([])
  })
})
