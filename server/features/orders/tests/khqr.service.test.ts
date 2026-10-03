import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { KhqrSettingsInput } from '#shared/contracts/orders'
import { khqrSettingsSchema, toRiel } from '#shared/contracts/orders'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { auditEvents } from '#server/features/platform/platform.schema'
import { listCounterQueue, payOrder, setExchangeRate } from '#server/features/orders/counter.service'
import { createKhqrCharge, getKhqrSettings, saveKhqrSettings } from '#server/features/orders/khqr.service'
import { counterPayments, khqrCharges } from '#server/features/orders/orders.schema'
import { placeOrder } from '#server/features/orders/orders.service'
import { createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { parseInput } from '#server/utils/validation'

// KHQR at the counter (step 10.15a, D130) against the real order, menu and platform services and
// the migrations: the settings, the QR made for an order, and the payment that names it.

let db: Db
const admin: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner' }
let branchId: string
let otherBranchId: string
let itemId: string
let variationId: string
let customer: Actor
let cashier: BranchActor
let elsewhere: BranchActor
let owner: Actor

/** Monday 2026-09-28, local time in Phnom Penh (UTC+7). */
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
const NOON = monday('12:00')
const allWeek = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 }))
const MINUTE = 60_000

const SETTINGS: KhqrSettingsInput = { version: 0, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD', 'KHR'] }

async function addBranch(name: string) {
  const id = newId()
  await insertBranch(db, { id, name, timezone: 'Asia/Phnom_Penh', status: 'active' })
  await updateBranchSettings(db, admin, id, { version: 1, hours: allWeek })
  return id
}

/** A $8.75 order: one Iced Latte, placed at noon (30 minutes to pay). */
async function place(at = NOON, branch = branchId) {
  const { orderId } = await placeOrder(db, customer, {
    branchId: branch,
    tableToken: null,
    lines: [{ itemId, variationId, modifierIds: [], quantity: 1, note: null }],
    expectedTotalMinor: 875,
  }, crypto.randomUUID(), at)
  return orderId
}

const qr = (orderId: string, currency: 'USD' | 'KHR' = 'USD', at = monday('12:02'), by = cashier) => createKhqrCharge(db, by, orderId, { currency }, at)

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
  customer = { userId: (await createUser(db, 'sokha@example.com', 'Sokha Chan')).id, tenantId: TEST_TENANT, role: 'customer' }
  cashier = { userId: (await createUser(db, 'sophea@example.com', 'Sophea')).id, tenantId: TEST_TENANT, role: 'customer', branchId, branchRole: 'staff' }
  elsewhere = { userId: (await createUser(db, 'vanna@example.com', 'Vanna')).id, tenantId: TEST_TENANT, role: 'customer', branchId: otherBranchId, branchRole: 'staff' }
  owner = { userId: (await createUser(db, 'kim@example.com', 'Kim')).id, tenantId: TEST_TENANT, role: 'owner' }
})

describe('the KHQR settings', () => {
  it('start off, then save from the version read; a stale save is refused and changes nothing', async () => {
    expect(await getKhqrSettings(db, TEST_TENANT)).toMatchObject({ version: 0, enabled: false, accountId: null, currencies: [] })
    const saved = await saveKhqrSettings(db, owner, SETTINGS, NOON)
    expect(saved).toMatchObject({ version: 1, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', currencies: ['USD', 'KHR'], updatedBy: { name: 'Kim' } })

    // A second "first save" (another admin's page read version 0) is refused.
    await expectApiError(() => saveKhqrSettings(db, admin, { ...SETTINGS, accountId: 'other@abaa' }), 409, 'VERSION_CONFLICT')
    await saveKhqrSettings(db, owner, { ...SETTINGS, version: 1, currencies: ['USD'] })
    await expectApiError(() => saveKhqrSettings(db, owner, { ...SETTINGS, version: 1, enabled: false }), 409, 'VERSION_CONFLICT')
    expect(await getKhqrSettings(db, TEST_TENANT)).toMatchObject({ version: 2, enabled: true, accountId: 'nukcafe@aclb', currencies: ['USD'] })

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.khqr_settings.save'))
    expect(audits).toHaveLength(2)
  })

  it('two admins saving at once from the same version: one wins, the other is refused', async () => {
    await saveKhqrSettings(db, owner, SETTINGS)
    // Both read version 1, both reach the batch before either commits.
    let arrived = 0
    let open!: () => void
    const both = new Promise<void>((resolve) => {
      open = resolve
    })
    const racer = Object.create(db) as Db
    racer.batch = (async (statements: Parameters<Db['batch']>[0]) => {
      if (++arrived === 2) open()
      await both
      return db.batch(statements)
    }) as unknown as Db['batch']
    const results = await Promise.allSettled([
      saveKhqrSettings(racer, owner, { ...SETTINGS, version: 1, merchantName: 'First' }),
      saveKhqrSettings(racer, admin, { ...SETTINGS, version: 1, merchantName: 'Second' }),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await getKhqrSettings(db, TEST_TENANT)).version).toBe(2)
  })

  it('takes an account like name@bank and a name the QR can carry (Latin letters, at most 25)', () => {
    expect(parseInput(khqrSettingsSchema, { ...SETTINGS, accountId: ' NukCafe@ACLB ', currencies: ['KHR', 'USD', 'KHR'] }))
      .toMatchObject({ accountId: 'nukcafe@aclb', currencies: ['USD', 'KHR'] })
    for (const bad of [{ accountId: 'nukcafe' }, { accountId: 'nuk cafe@aclb' }, { merchantName: 'ហាងកាហ្វេ' }, { merchantName: 'A very long cafe name over 25' }, { merchantCity: 'Phnom Penh Capital' }, { currencies: [] }]) {
      expect(() => parseInput(khqrSettingsSchema, { ...SETTINGS, ...bad }), JSON.stringify(bad)).toThrow()
    }
  })
})

describe('the QR for an order', () => {
  it('is refused until KHQR is on, and in a currency not offered', async () => {
    const orderId = await place()
    await expectApiError(() => qr(orderId), 409, 'KHQR_NOT_SET_UP')
    await saveKhqrSettings(db, owner, { ...SETTINGS, enabled: false })
    await expectApiError(() => qr(orderId), 409, 'KHQR_NOT_SET_UP')
    expect((await listCounterQueue(db, cashier, NOON)).khqr).toBeNull()
    await saveKhqrSettings(db, owner, { ...SETTINGS, version: 1, currencies: ['USD'] })
    expect((await listCounterQueue(db, cashier, NOON)).khqr).toEqual({ currencies: ['USD'], automaticCheck: false })
    await expectApiError(() => qr(orderId, 'KHR'), 409, 'KHQR_NOT_SET_UP')
  })

  it('holds the total, the order number and the branch, for 15 minutes; the same QR is answered again while it works', async () => {
    await saveKhqrSettings(db, owner, SETTINGS)
    const orderId = await place()
    const first = await qr(orderId)
    expect(first).toMatchObject({ currency: 'USD', amount: 875, khrPerUsd: null, billNumber: 'Order 001', merchantName: 'NUK Cafe', expiresAt: monday('12:17').toISOString() })
    expect(first.qr).toContain('0012nukcafe@aclb')
    expect(first.qr).toContain('54048.75')
    expect(first.qr).toContain('0109Order 0010309Riverside')

    expect((await qr(orderId, 'USD', monday('12:10'))).id).toBe(first.id)
    // Less than a minute left: a new one.
    const second = await qr(orderId, 'USD', new Date(monday('12:16').getTime() + MINUTE / 2))
    expect(second.id).not.toBe(first.id)
  })

  it('in riel at the current rate, rounded up to ៛100; refused with no rate', async () => {
    await saveKhqrSettings(db, owner, SETTINGS)
    const orderId = await place()
    await expectApiError(() => qr(orderId, 'KHR'), 409, 'NO_EXCHANGE_RATE')
    await setExchangeRate(db, owner, { khrPerUsd: 4100 }, monday('11:00'))
    const charge = await qr(orderId, 'KHR')
    expect(charge).toMatchObject({ currency: 'KHR', amount: toRiel(875, 4100), khrPerUsd: 4100 })
    expect(charge.amount).toBe(35_900)
  })

  it('stops at the order\'s time to pay, and is refused once paid, past due, or in another branch', async () => {
    await saveKhqrSettings(db, owner, SETTINGS)
    const orderId = await place()
    expect((await qr(orderId, 'USD', monday('12:20'))).expiresAt).toBe(monday('12:30').toISOString())
    await expectApiError(() => qr(orderId, 'USD', monday('12:31')), 409, 'PAYMENT_EXPIRED')
    await expectApiError(() => qr(orderId, 'USD', monday('12:02'), elsewhere), 404, 'NOT_FOUND')
    await payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('12:21'))
    await expectApiError(() => qr(orderId, 'USD', monday('12:22')), 409, 'ORDER_CHANGED')
  })

  it('is made again when the account changed since', async () => {
    await saveKhqrSettings(db, owner, SETTINGS)
    const orderId = await place()
    const before = await qr(orderId)
    await saveKhqrSettings(db, owner, { ...SETTINGS, version: 1, accountId: 'newcafe@abaa' })
    const after = await qr(orderId)
    expect(after.id).not.toBe(before.id)
    expect(after.qr).toContain('0012newcafe@abaa')
  })
})

describe('paying with the QR shown', () => {
  it('records which QR; an expired one is still accepted (the cashier saw the money)', async () => {
    await saveKhqrSettings(db, owner, SETTINGS)
    const orderId = await place()
    const charge = await qr(orderId)
    const paid = await payOrder(db, cashier, orderId, { version: 1, method: 'khqr', chargeId: charge.id, reference: null }, crypto.randomUUID(), monday('12:25'))
    expect(paid.payment).toMatchObject({ method: 'khqr', amountMinor: 875, khqrChargeId: charge.id })
  })

  it('refuses another order\'s QR and records nothing', async () => {
    await saveKhqrSettings(db, owner, SETTINGS)
    const orderId = await place()
    const other = await place(monday('12:01'))
    const otherCharge = await qr(other)
    await expectApiError(() => payOrder(db, cashier, orderId, { version: 1, method: 'khqr', chargeId: otherCharge.id, reference: null }, crypto.randomUUID(), monday('12:05')), 409, 'KHQR_CHARGE_INVALID')
    await expectApiError(() => payOrder(db, cashier, orderId, { version: 1, method: 'khqr', chargeId: 'missing-1', reference: null }, crypto.randomUUID(), monday('12:05')), 409, 'KHQR_CHARGE_INVALID')
    expect(await db.select().from(counterPayments).where(eq(counterPayments.orderId, orderId))).toEqual([])
    expect((await db.select().from(khqrCharges)).length).toBe(1)
  })
})
