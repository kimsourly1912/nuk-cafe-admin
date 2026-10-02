import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { toRiel } from '#shared/contracts/orders'
import { organization } from '#server/db/tables'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { auditEvents } from '#server/features/platform/platform.schema'
import type { BakongAnswer, BakongClient, BakongTransaction } from '#server/features/orders/bakong'
import { cancelOrderAtCounter, listCounterQueue, payOrder, setExchangeRate } from '#server/features/orders/counter.service'
import { expireUnpaidOrders } from '#server/features/orders/expiry.service'
import { checkKhqrCharge, matchesCharge, testBakongConnection } from '#server/features/orders/khqr-check.service'
import { createKhqrCharge, getKhqrSettings, saveKhqrSettings } from '#server/features/orders/khqr.service'
import { counterPayments, khqrCharges, orders } from '#server/features/orders/orders.schema'
import { placeOrder } from '#server/features/orders/orders.service'
import { createTestDb, createUser } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// Checking a counter KHQR with Bakong (step 10.15b, D131), against the real order, menu and
// platform services and the migrations, with a stand-in for Bakong: paid as it should be, the
// payment is recorded once as the cashier who asked; anything else records nothing.

let db: Db
const admin: Actor = { userId: 'admin-1', role: 'admin' }
let branchId: string
let itemId: string
let variationId: string
let customer: Actor
let cashier: BranchActor
let colleague: BranchActor
let owner: Actor

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

/** A $8.75 order: one Iced Latte, placed at noon (30 minutes to pay). */
async function place() {
  const { orderId } = await placeOrder(db, customer, {
    branchId,
    tableToken: null,
    lines: [{ itemId, variationId, modifierIds: [], quantity: 1, note: null }],
    expectedTotalMinor: 875,
  }, crypto.randomUUID(), NOON)
  return orderId
}

const transaction = (patch: Partial<BakongTransaction> = {}): BakongTransaction => ({
  hash: 'hash-1',
  fromAccountId: 'customer@abaa',
  toAccountId: 'nukcafe@aclb',
  currency: 'USD',
  amount: 8.75,
  externalRef: '100FT36931627892',
  createdAt: monday('12:03'),
  ...patch,
})

/** A stand-in for Bakong answering `answer` (or what `answer` returns), counting the questions. */
function fakeBakong(answer: BakongAnswer | ((md5: string) => BakongAnswer | Promise<BakongAnswer>)) {
  const asked: string[] = []
  const client: BakongClient = {
    checkByMd5: async (md5) => {
      asked.push(md5)
      return typeof answer === 'function' ? answer(md5) : answer
    },
  }
  return { client, asked }
}
const paid = (patch?: Partial<BakongTransaction>): BakongAnswer => ({ kind: 'paid', transaction: transaction(patch) })

const paymentsOf = (orderId: string) => db.select().from(counterPayments).where(eq(counterPayments.orderId, orderId))
const statusOf = async (orderId: string) => (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]!.status

beforeEach(async () => {
  db = await createTestDb()
  branchId = await addBranch('Riverside')
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
  customer = { userId: (await createUser(db, 'sokha@example.com', 'Sokha Chan')).id, role: 'customer' }
  cashier = { userId: (await createUser(db, 'sophea@example.com', 'Sophea')).id, role: 'customer', branchId, branchRole: 'staff' }
  colleague = { userId: (await createUser(db, 'dara@example.com', 'Dara')).id, role: 'customer', branchId, branchRole: 'staff' }
  owner = { userId: (await createUser(db, 'kim@example.com', 'Kim')).id, role: 'admin' }
  await saveKhqrSettings(db, owner, { version: 0, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD', 'KHR'] }, monday('09:00'))
})

describe('checking a QR with Bakong', () => {
  it('paid to our account in its currency and amount: recorded as the cashier who asked, once; asking again doesn\'t ask Bakong', async () => {
    const orderId = await place()
    const charge = await createKhqrCharge(db, cashier, orderId, { currency: 'USD' }, monday('12:02'))
    const bakong = fakeBakong(paid({ toAccountId: 'NUKCAFE@aclb' }))

    const result = await checkKhqrCharge(db, cashier, orderId, charge.id, bakong.client, monday('12:04'))
    expect(result).toMatchObject({ status: 'paid', order: { id: orderId, status: 'preparing', payment: { method: 'khqr', amountMinor: 875, reference: '100FT36931627892', khqrChargeId: charge.id, collectedBy: { name: 'Sophea' } } } })
    const [md5] = await db.select({ md5: khqrCharges.md5 }).from(khqrCharges).where(eq(khqrCharges.id, charge.id))
    expect(bakong.asked).toEqual([md5!.md5])

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.order.pay'))
    expect(audit).toHaveLength(1)
    expect(audit[0]!.actorId).toBe(cashier.userId)
    expect(audit[0]!.metadata).toMatchObject({ method: 'khqr', khqrChargeId: charge.id, checkedWithBakong: true })

    expect(await checkKhqrCharge(db, cashier, orderId, charge.id, bakong.client, monday('12:05'))).toMatchObject({ status: 'paid' })
    expect(bakong.asked).toHaveLength(1)
    expect(await paymentsOf(orderId)).toHaveLength(1)
  })

  it('in riel: the amount in riel the QR was made for', async () => {
    await setExchangeRate(db, owner, { khrPerUsd: 4100 }, monday('11:00'))
    const orderId = await place()
    const charge = await createKhqrCharge(db, cashier, orderId, { currency: 'KHR' }, monday('12:02'))
    expect(charge.amount).toBe(toRiel(875, 4100))
    const result = await checkKhqrCharge(db, cashier, orderId, charge.id, fakeBakong(paid({ currency: 'KHR', amount: charge.amount })).client, monday('12:04'))
    expect(result).toMatchObject({ status: 'paid', order: { status: 'preparing', payment: { method: 'khqr', khqrChargeId: charge.id } } })
  })

  it('not paid yet: waiting, nothing recorded', async () => {
    const orderId = await place()
    const charge = await createKhqrCharge(db, cashier, orderId, { currency: 'USD' }, monday('12:02'))
    expect(await checkKhqrCharge(db, cashier, orderId, charge.id, fakeBakong({ kind: 'not_found' }).client, monday('12:04'))).toEqual({ status: 'waiting' })
    expect(await statusOf(orderId)).toBe('awaiting_payment')
  })

  it('something else arrived (another amount, currency or account): says what, records nothing', async () => {
    const orderId = await place()
    const charge = await createKhqrCharge(db, cashier, orderId, { currency: 'USD' }, monday('12:02'))
    for (const patch of [{ amount: 8 }, { currency: 'KHR', amount: 875 }, { toAccountId: 'someone@aclb' }]) {
      const result = await checkKhqrCharge(db, cashier, orderId, charge.id, fakeBakong(paid(patch)).client, monday('12:04'))
      expect(result).toEqual({ status: 'mismatch', received: { currency: patch.currency ?? 'USD', amount: patch.amount ?? 8.75, toAccountId: patch.toAccountId ?? 'nukcafe@aclb' } })
    }
    expect(await paymentsOf(orderId)).toHaveLength(0)
    expect(await statusOf(orderId)).toBe('awaiting_payment')
  })

  it('without a token, or when Bakong refuses the token or this server: unavailable, the cashier confirms by hand', async () => {
    const orderId = await place()
    const charge = await createKhqrCharge(db, cashier, orderId, { currency: 'USD' }, monday('12:02'))
    expect(await checkKhqrCharge(db, cashier, orderId, charge.id, null, monday('12:04'))).toEqual({ status: 'unavailable', problem: 'not_set_up' })
    for (const problem of ['token', 'refused', 'error'] as const) {
      const result = await checkKhqrCharge(db, cashier, orderId, charge.id, fakeBakong({ kind: 'unavailable', problem, detail: 'x' }).client, monday('12:04'))
      expect(result).toEqual({ status: 'unavailable', problem })
    }
    expect(await paymentsOf(orderId)).toHaveLength(0)
  })

  it('paid after the time to pay, before the expiry ran: still recorded (the money arrived)', async () => {
    const orderId = await place()
    const charge = await createKhqrCharge(db, cashier, orderId, { currency: 'USD' }, monday('12:20'))
    const result = await checkKhqrCharge(db, cashier, orderId, charge.id, fakeBakong(paid()).client, monday('12:31'))
    expect(result).toMatchObject({ status: 'paid', order: { status: 'preparing' } })
  })

  it('paid on a QR of an order already paid in cash, or expired: the money goes back', async () => {
    const cashOrder = await place()
    const cashCharge = await createKhqrCharge(db, cashier, cashOrder, { currency: 'USD' }, monday('12:02'))
    await payOrder(db, colleague, cashOrder, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('12:03'))
    expect(await checkKhqrCharge(db, cashier, cashOrder, cashCharge.id, fakeBakong(paid()).client, monday('12:04'))).toMatchObject({
      status: 'refund_needed',
      received: { currency: 'USD', amount: 8.75 },
      order: { status: 'preparing', payment: { method: 'cash_usd', khqrChargeId: null } },
    })
    expect(await paymentsOf(cashOrder)).toHaveLength(1)

    const lateOrder = await place()
    const lateCharge = await createKhqrCharge(db, cashier, lateOrder, { currency: 'USD' }, monday('12:20'))
    await expireUnpaidOrders(db, monday('12:31'))
    expect(await checkKhqrCharge(db, cashier, lateOrder, lateCharge.id, fakeBakong(paid()).client, monday('12:32'))).toMatchObject({ status: 'refund_needed', order: { status: 'cancelled', payment: null } })

    const cancelled = await place()
    const cancelledCharge = await createKhqrCharge(db, cashier, cancelled, { currency: 'USD' }, monday('12:02'))
    await cancelOrderAtCounter(db, colleague, cancelled, { version: 1, reason: 'customer_changed_mind', note: null, returnMethod: null }, crypto.randomUUID(), monday('12:03'))
    expect(await checkKhqrCharge(db, cashier, cancelled, cancelledCharge.id, fakeBakong(paid()).client, monday('12:04'))).toMatchObject({ status: 'refund_needed', order: { status: 'cancelled' } })
  })

  it('two cashiers asking at once: one payment; both see it paid', async () => {
    const orderId = await place()
    const charge = await createKhqrCharge(db, cashier, orderId, { currency: 'USD' }, monday('12:02'))
    // Bakong answers both only once both have asked, so both go on to record at the same moment.
    let release!: () => void
    const bothAsked = new Promise<void>((resolve) => {
      release = resolve
    })
    let asked = 0
    const bakong = fakeBakong(async () => {
      if (++asked === 2) release()
      await bothAsked
      return paid()
    })
    const [first, second] = await Promise.all([
      checkKhqrCharge(db, cashier, orderId, charge.id, bakong.client, monday('12:04')),
      checkKhqrCharge(db, colleague, orderId, charge.id, bakong.client, monday('12:04')),
    ])
    expect(first).toMatchObject({ status: 'paid', order: { status: 'preparing' } })
    expect(second).toMatchObject({ status: 'paid', order: { status: 'preparing' } })
    expect(await paymentsOf(orderId)).toHaveLength(1)
  })

  it('refuses another order\'s QR, and an unknown one', async () => {
    const orderId = await place()
    const other = await place()
    const otherCharge = await createKhqrCharge(db, cashier, other, { currency: 'USD' }, monday('12:02'))
    await expectApiError(() => checkKhqrCharge(db, cashier, orderId, otherCharge.id, fakeBakong(paid()).client, monday('12:04')), 409, 'KHQR_CHARGE_INVALID')
    await expectApiError(() => checkKhqrCharge(db, cashier, orderId, 'missing-1', fakeBakong(paid()).client, monday('12:04')), 409, 'KHQR_CHARGE_INVALID')
    expect(await paymentsOf(orderId)).toHaveLength(0)
  })
})

describe('matching Bakong\'s transaction to the QR', () => {
  it('compares cents for dollars and whole riel, the account without case', () => {
    const usd = { accountId: 'nukcafe@aclb', currency: 'USD' as const, amount: 1050 }
    expect(matchesCharge(usd, transaction({ amount: 10.5 }))).toBe(true)
    expect(matchesCharge(usd, transaction({ amount: 10.499999999 }))).toBe(true)
    expect(matchesCharge(usd, transaction({ amount: 10.49 }))).toBe(false)
    expect(matchesCharge({ accountId: 'nukcafe@aclb', currency: 'KHR', amount: 35900 }, transaction({ currency: 'KHR', amount: 35900 }))).toBe(true)
  })
})

describe('whether the counter checks automatically', () => {
  it('the settings and the queue say so when this server has a token', async () => {
    expect(await getKhqrSettings(db, true)).toMatchObject({ automaticCheck: true })
    expect(await getKhqrSettings(db)).toMatchObject({ automaticCheck: false })
    expect((await listCounterQueue(db, cashier, NOON, true)).khqr).toEqual({ currencies: ['USD', 'KHR'], automaticCheck: true })
  })

  it('Test connection: connected when Bakong answers "not found"; otherwise why not', async () => {
    expect(await testBakongConnection(null)).toEqual({ status: 'unavailable', problem: 'not_set_up', detail: null })
    expect(await testBakongConnection(fakeBakong({ kind: 'not_found' }).client)).toEqual({ status: 'connected' })
    expect(await testBakongConnection(fakeBakong({ kind: 'unavailable', problem: 'refused', detail: 'Bakong refused this server (403)' }).client)).toEqual({ status: 'unavailable', problem: 'refused', detail: 'Bakong refused this server (403)' })
  })
})
