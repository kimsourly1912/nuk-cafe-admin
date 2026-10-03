import { beforeEach, describe, expect, it } from 'vitest'
import type { KhqrSettingsInput } from '#shared/contracts/orders'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { getExchangeRates, getCounterOrder, listCounterQueue, payOrder, setExchangeRate } from '#server/features/orders/counter.service'
import { createKhqrCharge, getKhqrSettings, saveKhqrSettings } from '#server/features/orders/khqr.service'
import { cancelMyOrder, getOrder, listMyOrders, placeOrder } from '#server/features/orders/orders.service'
import { orderHistoryDetail } from '#server/features/orders/reports.service'
import { createTestDb, createUser, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

/**
 * Tenant isolation for orders, the riel rate and the KHQR settings (D137, multi-tenant plan →
 * Rules). One account orders at two cafes: each cafe sees only its own orders, rate and settings.
 */

const OTHER = 'tenant-2'
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
const NOON = monday('12:00')
const allWeek = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 }))
const SETTINGS: KhqrSettingsInput = { version: 0, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD', 'KHR'] }

let db: Db
let customerId: string

/** A cafe: its owner, a branch open all week, a cashier there, and one $8.75 item on its menu. */
async function cafe(tenantId: string) {
  const owner: Actor = { userId: (await createUser(db, `owner@${tenantId}.example`, 'Owner')).id, tenantId, role: 'owner' }
  const branchId = newId()
  await insertBranch(db, { id: branchId, name: `Branch of ${tenantId}`, timezone: 'Asia/Phnom_Penh', tenantId })
  await updateBranchSettings(db, owner, branchId, { version: 1, hours: allWeek })
  const category = await createCategory(db, owner, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, owner, { categoryId: category.id, name: 'Iced Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 875, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const item = await publishItem(db, owner, draft.id, { version: draft.version })
  const cashier: BranchActor = { userId: (await createUser(db, `cashier@${tenantId}.example`, 'Cashier')).id, tenantId, role: 'member', branchId, branchRole: 'staff' }
  const customer: Actor = { userId: customerId, tenantId, role: 'customer' }
  const place = async (at = NOON) => (await placeOrder(db, customer, { branchId, tableToken: null, lines: [{ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, note: null }], expectedTotalMinor: 875 }, crypto.randomUUID(), at)).orderId
  return { owner, branchId, cashier, customer, place }
}

let ours: Awaited<ReturnType<typeof cafe>>
let theirs: Awaited<ReturnType<typeof cafe>>

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  await ensureTenant(db, OTHER)
  customerId = (await createUser(db, 'sokha@example.com', 'Sokha Chan')).id
  ours = await cafe(TEST_TENANT)
  theirs = await cafe(OTHER)
})

describe('orders tenants', () => {
  it('shows a customer only the cafe\'s own orders, though it\'s the same account', async () => {
    const order = await ours.place()
    expect((await getOrder(db, ours.customer, order)).id).toBe(order)
    await expectApiError(() => getOrder(db, theirs.customer, order), 404, 'NOT_FOUND')
    await expectApiError(() => cancelMyOrder(db, theirs.customer, order, { version: 1 }, crypto.randomUUID(), monday('12:01')), 404, 'NOT_FOUND')
    const listed = await listMyOrders(db, theirs.customer, { page: 1, pageSize: 20 })
    expect([listed.inProgress, listed.past.items]).toEqual([[], []])
    expect((await listMyOrders(db, ours.customer, { page: 1, pageSize: 20 })).inProgress.map(o => o.id)).toEqual([order])
    expect((await getOrder(db, ours.customer, order)).status).toBe('awaiting_payment')

    // Finished, it's in our past orders, not theirs.
    await cancelMyOrder(db, ours.customer, order, { version: 1 }, crypto.randomUUID(), monday('12:01'))
    expect((await listMyOrders(db, ours.customer, { page: 1, pageSize: 20 })).past.items.map(o => o.id)).toEqual([order])
    expect((await listMyOrders(db, theirs.customer, { page: 1, pageSize: 20 })).past).toMatchObject({ items: [], total: 0 })
  })

  it('counts unpaid orders per cafe', async () => {
    await ours.place()
    await ours.place(monday('12:01'))
    await expectApiError(() => ours.place(monday('12:02')), 409, 'TOO_MANY_UNPAID_ORDERS')
    // Two unpaid at our cafe don't stop an order at theirs.
    expect(await theirs.place(monday('12:02'))).toBeTruthy()
  })

  it('keeps an order to its cafe at the counter and in reports', async () => {
    const order = await ours.place()
    await expectApiError(() => getCounterOrder(db, theirs.cashier, order), 404, 'NOT_FOUND')
    await expectApiError(() => payOrder(db, theirs.cashier, order, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('12:05')), 404, 'NOT_FOUND')
    await expectApiError(() => orderHistoryDetail(db, OTHER, order), 404, 'NOT_FOUND')
    expect((await listCounterQueue(db, theirs.cashier, monday('12:05'))).orders).toEqual([])
    expect((await getCounterOrder(db, ours.cashier, order)).status).toBe('awaiting_payment')
  })

  it('gives each cafe its own riel rate', async () => {
    await setExchangeRate(db, ours.owner, { khrPerUsd: 4100 }, monday('08:00'))
    expect((await getExchangeRates(db, TEST_TENANT, NOON)).current?.khrPerUsd).toBe(4100)
    expect(await getExchangeRates(db, OTHER, NOON)).toEqual({ current: null, history: [] })
    expect((await listCounterQueue(db, theirs.cashier, NOON)).khrRate).toBeNull()
    const order = await theirs.place()
    await expectApiError(() => payOrder(db, theirs.cashier, order, { version: 1, method: 'cash_khr', khrPerUsd: 4100 }, crypto.randomUUID(), monday('12:05')), 409, 'NO_EXCHANGE_RATE')

    await setExchangeRate(db, theirs.owner, { khrPerUsd: 4000 }, monday('09:00'))
    expect([(await getExchangeRates(db, TEST_TENANT, NOON)).history.length, (await getExchangeRates(db, OTHER, NOON)).current?.khrPerUsd]).toEqual([1, 4000])
  })

  it('gives each cafe its own KHQR settings and QRs', async () => {
    await saveKhqrSettings(db, ours.owner, SETTINGS, monday('08:00'))
    expect((await getKhqrSettings(db, TEST_TENANT)).accountId).toBe('nukcafe@aclb')
    expect(await getKhqrSettings(db, OTHER)).toMatchObject({ version: 0, enabled: false, accountId: null })
    expect((await listCounterQueue(db, theirs.cashier, NOON)).khqr).toBeNull()
    const theirOrder = await theirs.place()
    await expectApiError(() => createKhqrCharge(db, theirs.cashier, theirOrder, { currency: 'USD' }, monday('12:02')), 409, 'KHQR_NOT_SET_UP')

    // Their first save is their own, from version 0, and leaves ours alone.
    await saveKhqrSettings(db, theirs.owner, { ...SETTINGS, accountId: 'other@aclb', merchantName: 'Other Cafe' }, monday('09:00'))
    expect([(await getKhqrSettings(db, TEST_TENANT)).accountId, (await getKhqrSettings(db, OTHER)).accountId]).toEqual(['nukcafe@aclb', 'other@aclb'])
    const ourOrder = await ours.place()
    const charge = await createKhqrCharge(db, ours.cashier, ourOrder, { currency: 'USD' }, monday('12:02'))
    expect(charge.merchantName).toBe('NUK Cafe')
    // Our QR can't pay their order.
    await expectApiError(() => payOrder(db, theirs.cashier, theirOrder, { version: 1, method: 'khqr', chargeId: charge.id, reference: null }, crypto.randomUUID(), monday('12:05')), 409, 'KHQR_CHARGE_INVALID')
  })
})
