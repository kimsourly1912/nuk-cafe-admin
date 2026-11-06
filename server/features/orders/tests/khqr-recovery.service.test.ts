import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { updateBranchSettings } from '#server/features/branches'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { auditEvents, outboxMessages } from '#server/features/platform/platform.schema'
import { isSupportReadable } from '#server/features/support/support.rules'
import type { BakongAnswer, BakongClient, BakongTransaction } from '#server/features/orders/bakong'
import { payOrder } from '#server/features/orders/counter.service'
import { expireUnpaidOrders } from '#server/features/orders/expiry.service'
import { checkKhqrCharge } from '#server/features/orders/khqr-check.service'
import { claimBakongCheck } from '#server/features/orders/khqr.repository'
import { claimRecovery, rescheduleRecovery } from '#server/features/orders/khqr-recovery.repository'
import { listKhqrReviews, nextRecoveryCheck, openReviewCase, recordKhqrReturn, recoverKhqrPayments } from '#server/features/orders/khqr-recovery.service'
import { createKhqrCharge, saveKhqrSettings } from '#server/features/orders/khqr.service'
import { counterPayments, khqrCharges, khqrReviewCases, orderEvents, orders } from '#server/features/orders/orders.schema'
import { placeOrder } from '#server/features/orders/orders.service'
import { createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

// KHQR recovery (D266) against the real order, menu and platform services and the migrations, with
// a stand-in for Bakong: the server keeps asking about each QR after the counter stops; a payment
// for an order still waiting is recorded once by the system; one the order can't take becomes one
// review case for the owners, who record how the money went back.

let db: Db

/** Monday 2026-09-28, local time in Phnom Penh (UTC+7). */
const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
const NOON = monday('12:00')
const MINUTE = 60_000
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE)
const allWeek = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 }))

interface Cafe {
  tenantId: string
  branchId: string
  owner: Actor
  cashier: BranchActor
  colleague: BranchActor
  place: () => Promise<string>
}

/** A cafe with one branch, a $8.75 Iced Latte, KHQR on to `nukcafe@aclb`, an owner and two cashiers. */
async function openCafe(tenantId: string): Promise<Cafe> {
  const branchId = newId()
  await insertBranch(db, { id: branchId, name: `Riverside ${tenantId}`, timezone: 'Asia/Phnom_Penh', status: 'active', tenantId })
  const owner: Actor = { userId: (await createUser(db, `owner-${tenantId}@example.com`, 'Kim')).id, tenantId, role: 'owner' }
  await updateBranchSettings(db, owner, branchId, { version: 1, hours: allWeek })
  const category = await createCategory(db, owner, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, owner, {
    categoryId: category.id,
    name: 'Iced Latte',
    description: '',
    imageId: null,
    optionSetIds: [],
    variations: [{ valueIds: [], priceMinor: 875, status: 'active' }],
    modifierGroups: [],
    availabilityRuleIds: [],
  })
  const item = await publishItem(db, owner, draft.id, { version: draft.version })
  const customer: Actor = { userId: (await createUser(db, `customer-${tenantId}@example.com`, 'Sokha Chan')).id, tenantId, role: 'customer' }
  const staff = async (name: string): Promise<BranchActor> => ({ userId: (await createUser(db, `${name}-${tenantId}@example.com`, name)).id, tenantId, role: 'customer', branchId, branchRole: 'staff' })
  const cashier = await staff('sophea')
  const colleague = await staff('dara')
  await saveKhqrSettings(db, owner, { version: 0, enabled: true, accountId: 'nukcafe@aclb', merchantName: 'NUK Cafe', merchantCity: 'Phnom Penh', currencies: ['USD', 'KHR'] }, monday('09:00'))
  const place = async () => {
    const { orderId } = await placeOrder(db, customer, {
      branchId,
      tableToken: null,
      lines: [{ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, note: null }],
      expectedTotalMinor: 875,
    }, crypto.randomUUID(), NOON)
    return orderId
  }
  return { tenantId, branchId, owner, cashier, colleague, place }
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
const paid = (patch?: Partial<BakongTransaction>): BakongAnswer => ({ kind: 'paid', transaction: transaction(patch) })
const notFound: BakongAnswer = { kind: 'not_found' }

/** A stand-in for Bakong answering `answer` (or what it returns), counting the questions. */
function fakeBakong(answer: BakongAnswer | ((md5: string) => BakongAnswer | Promise<BakongAnswer>)) {
  const asked: string[] = []
  const client: BakongClient = {
    checkByMd5: async (md5) => {
      asked.push(md5)
      return typeof answer === 'function' ? answer(md5) : answer
    },
  }
  return { client, asked, clients: async () => client }
}

const chargeRow = async (id: string) => (await db.select().from(khqrCharges).where(eq(khqrCharges.id, id)))[0]!
const paymentsOf = (orderId: string) => db.select().from(counterPayments).where(eq(counterPayments.orderId, orderId))
const statusOf = async (orderId: string) => (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]!.status
const casesOf = (orderId: string) => db.select().from(khqrReviewCases).where(eq(khqrReviewCases.orderId, orderId))

let cafe: Cafe

beforeEach(async () => {
  db = await createTestDb()
  cafe = await openCafe(TEST_TENANT)
})

describe('the schedule', () => {
  const charge = { expiresAt: monday('12:17') }

  it('asks every 2 minutes while the QR works, never past a minute after it expires', () => {
    expect(nextRecoveryCheck(charge, monday('12:03'))).toEqual(monday('12:05'))
    expect(nextRecoveryCheck(charge, monday('12:16'))).toEqual(monday('12:18'))
  })

  it('then once each at 1 and 10 minutes, 1 and 6 hours and 24 hours after expiry; then stops', () => {
    expect(nextRecoveryCheck(charge, monday('12:17'))).toEqual(monday('12:18'))
    expect(nextRecoveryCheck(charge, monday('12:18'))).toEqual(monday('12:27'))
    expect(nextRecoveryCheck(charge, monday('12:27'))).toEqual(monday('13:17'))
    expect(nextRecoveryCheck(charge, monday('13:17'))).toEqual(monday('18:17'))
    expect(nextRecoveryCheck(charge, monday('18:17'))).toEqual(new Date('2026-09-29T12:17:00+07:00'))
    expect(nextRecoveryCheck(charge, new Date('2026-09-29T12:17:00+07:00'))).toBeNull()
  })
})

describe('the server\'s own check', () => {
  it('records the payment of an order still waiting when the counter stopped asking, once, by the system', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    expect((await chargeRow(charge.id)).recoveryNextAt).toEqual(monday('12:03'))
    const bakong = fakeBakong(paid())

    // Before its first check is due: not asked.
    expect(await recoverKhqrPayments(db, bakong.clients, at(monday('12:02'), 0.5))).toMatchObject({ paid: 0, skipped: 0 })
    expect(bakong.asked).toEqual([])

    expect(await recoverKhqrPayments(db, bakong.clients, monday('12:03'))).toMatchObject({ paid: 1 })
    expect(await statusOf(orderId)).toBe('preparing')
    // The money came through the cashier's QR; the change itself is the system's.
    expect(await paymentsOf(orderId)).toMatchObject([{ method: 'khqr', amountMinor: 875, khqrChargeId: charge.id, collectedBy: cafe.cashier.userId, reference: '100FT36931627892' }])
    expect(await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.toStatus, 'preparing')))).toMatchObject([{ actorId: null }])
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.order.pay'))).toMatchObject([{ actorId: null, targetId: orderId }])
    expect(await db.select().from(outboxMessages).where(eq(outboxMessages.kind, 'orders.paid'))).toHaveLength(1)
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'done', recoveryNextAt: null, recoveryClaimToken: null })

    // Nothing left to ask: done is final.
    await recoverKhqrPayments(db, bakong.clients, monday('12:10'))
    expect(bakong.asked).toHaveLength(1)
    expect(await casesOf(orderId)).toEqual([])
  })

  it('asks about an unpaid QR about a dozen times, then stops without calling it unpaid or unchecked', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    const bakong = fakeBakong(notFound)
    let now = monday('12:03')
    for (let runs = 0; runs < 50; runs++) {
      await recoverKhqrPayments(db, bakong.clients, now)
      const row = await chargeRow(charge.id)
      if (row.recoveryState !== 'open') break
      now = row.recoveryNextAt!
    }
    expect(bakong.asked).toHaveLength(13)
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'stopped', recoveryProblem: null })
    expect((await listKhqrReviews(db, cafe.tenantId, now)).unchecked).toBe(0)
  })

  it('without a Bakong token asks nothing, and counts the QR as unchecked once its window is over', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    const end = new Date('2026-09-29T12:17:00+07:00')
    await recoverKhqrPayments(db, async () => null, monday('12:03'))
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'open', recoveryProblem: 'not_set_up' })
    await recoverKhqrPayments(db, async () => null, end)
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'stopped', recoveryProblem: 'not_set_up' })
    expect((await listKhqrReviews(db, cafe.tenantId, end)).unchecked).toBe(1)
  })

  it('stops asking with a token Bakong refuses for the rest of the run, cafe by cafe', async () => {
    const first = await createKhqrCharge(db, cafe.cashier, await cafe.place(), { currency: 'USD' }, monday('12:02'))
    const second = await createKhqrCharge(db, cafe.cashier, await cafe.place(), { currency: 'USD' }, monday('12:02'))
    const bakong = fakeBakong({ kind: 'unavailable', problem: 'token', detail: 'expired' })
    await recoverKhqrPayments(db, bakong.clients, monday('12:03'))
    expect(bakong.asked).toHaveLength(1)
    for (const id of [first.id, second.id]) expect(await chargeRow(id)).toMatchObject({ recoveryState: 'open', recoveryProblem: 'token', recoveryNextAt: monday('12:05') })
  })

  it('opens a review case when cash won before the bank payment was found; the cash payment stays', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    await payOrder(db, cafe.colleague, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('12:02'))
    await recoverKhqrPayments(db, fakeBakong(paid()).clients, monday('12:03'))
    expect(await paymentsOf(orderId)).toMatchObject([{ method: 'cash_usd', khqrChargeId: null, returnedAt: null }])
    expect(await casesOf(orderId)).toMatchObject([{ reason: 'paid_otherwise', status: 'open', chargeId: charge.id, receivedCurrency: 'USD', receivedAmount: 875, foundBy: null, bankHash: 'hash-1' }])
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.khqr_review.open'))).toMatchObject([{ actorId: null }])
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'done' })
  })

  it('opens a review case for a payment found after the expiry cancelled the order, without reopening it', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:20'))
    await expireUnpaidOrders(db, monday('12:31'))
    await recoverKhqrPayments(db, fakeBakong(paid()).clients, monday('12:36'))
    expect(await statusOf(orderId)).toBe('cancelled')
    expect(await paymentsOf(orderId)).toEqual([])
    expect(await casesOf(orderId)).toMatchObject([{ reason: 'order_cancelled', chargeId: charge.id }])
  })

  it('opens an amount case for another amount on the cafe\'s account, and records no payment', async () => {
    const orderId = await cafe.place()
    await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    await recoverKhqrPayments(db, fakeBakong(paid({ amount: 5 })).clients, monday('12:03'))
    expect(await statusOf(orderId)).toBe('awaiting_payment')
    expect(await casesOf(orderId)).toMatchObject([{ reason: 'amount_mismatch', receivedCurrency: 'USD', receivedAmount: 500 }])
  })

  it('opens nothing for money on another account: not the cafe\'s to give back, and not counted unchecked', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    await recoverKhqrPayments(db, fakeBakong(paid({ toAccountId: 'someone@else' })).clients, monday('12:03'))
    expect(await casesOf(orderId)).toEqual([])
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'stopped', recoveryProblem: 'account_mismatch' })
    expect((await listKhqrReviews(db, cafe.tenantId, monday('12:04'))).unchecked).toBe(0)
  })

  it('records nothing if the payment write fails, and records it once on the next run', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    const bakong = fakeBakong(paid())
    // The real database for reads and the claim; only the payment batch fails.
    const interrupted = Object.create(db) as Db
    let batches = 0
    const failFirst: Db['batch'] = async (statements) => {
      if (++batches === 1) throw new Error('database unavailable after bank confirmation')
      return db.batch(statements)
    }
    interrupted.batch = failFirst
    await expect(recoverKhqrPayments(interrupted, bakong.clients, monday('12:03'))).rejects.toThrow('database unavailable')
    expect(await paymentsOf(orderId)).toEqual([])
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'open' })

    // The lease of the failed run lapses; the next run asks again and records it once.
    await recoverKhqrPayments(db, bakong.clients, monday('12:04'))
    expect(await paymentsOf(orderId)).toHaveLength(1)
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'done' })
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.order.pay'))).toHaveLength(1)
  })

  it('waits while the counter\'s check holds the QR, and the counter waits while the server holds it', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    const bakong = fakeBakong(notFound)
    expect(await claimBakongCheck(db, cafe.tenantId, charge.id, at(monday('12:03'), 0.1), monday('12:03'))).toBe(true)
    expect(await recoverKhqrPayments(db, bakong.clients, monday('12:03'))).toMatchObject({ skipped: 1 })
    expect(bakong.asked).toEqual([])

    const claim = await claimRecovery(db, cafe.tenantId, charge.id, at(monday('12:04'), 0.5), monday('12:04'))
    expect(claim).toMatchObject({ attempts: 1 })
    expect(await checkKhqrCharge(db, cafe.cashier, orderId, charge.id, bakong.client, at(monday('12:04'), 0.1))).toEqual({ status: 'waiting' })
    expect(bakong.asked).toEqual([])
  })

  it('lets only the claim\'s own run settle it', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    const stale = await claimRecovery(db, cafe.tenantId, charge.id, at(monday('12:03'), 0.5), monday('12:03'))
    const fresh = await claimRecovery(db, cafe.tenantId, charge.id, at(monday('12:04'), 0.5), monday('12:04'))
    expect(fresh).toMatchObject({ attempts: 2 })
    expect(await rescheduleRecovery(db, cafe.tenantId, charge.id, stale!.claimToken, { nextAt: monday('13:00'), problem: null, checkedAt: monday('12:05') })).toBe(false)
    expect(await rescheduleRecovery(db, cafe.tenantId, charge.id, fresh!.claimToken, { nextAt: monday('12:06'), problem: null, checkedAt: monday('12:05') })).toBe(true)
    expect((await chargeRow(charge.id)).recoveryNextAt).toEqual(monday('12:06'))
  })
})

describe('the counter\'s check and payments end the server\'s checks', () => {
  it('a payment the counter\'s check records ends them', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    await checkKhqrCharge(db, cafe.cashier, orderId, charge.id, fakeBakong(paid()).client, monday('12:02'))
    expect(await chargeRow(charge.id)).toMatchObject({ recoveryState: 'done' })
  })

  it('Confirm naming the QR ends them; the order\'s other QRs keep being checked', async () => {
    const orderId = await cafe.place()
    const usd = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    await saveExchangeRateForKhr()
    const khr = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'KHR' }, monday('12:02'))
    await payOrder(db, cafe.colleague, orderId, { version: 1, method: 'khqr', chargeId: usd.id, reference: 'seen in app' }, crypto.randomUUID(), monday('12:03'))
    expect(await chargeRow(usd.id)).toMatchObject({ recoveryState: 'done' })
    expect(await chargeRow(khr.id)).toMatchObject({ recoveryState: 'open' })
  })

  it('the counter\'s refund_needed opens the case before it answers, so a closed tablet loses nothing', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    await payOrder(db, cafe.colleague, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('12:02'))
    const bakong = fakeBakong(paid())
    expect(await checkKhqrCharge(db, cafe.cashier, orderId, charge.id, bakong.client, monday('12:03'))).toMatchObject({ status: 'refund_needed' })
    expect(await casesOf(orderId)).toMatchObject([{ reason: 'paid_otherwise', foundBy: cafe.cashier.userId }])
    // Asked again (another round, another counter): still one case, and the server doesn't ask.
    await checkKhqrCharge(db, cafe.colleague, orderId, charge.id, bakong.client, monday('12:04'))
    await recoverKhqrPayments(db, bakong.clients, monday('12:05'))
    expect(await casesOf(orderId)).toHaveLength(1)
    expect(bakong.asked).toHaveLength(2)
  })

  it('a case opened twice at once (counter and server) stays one, and neither fails', async () => {
    const orderId = await cafe.place()
    const charge = await createKhqrCharge(db, cafe.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    const found = { reason: 'paid_otherwise' as const, currency: 'USD' as const, amount: 875, transaction: transaction(), at: monday('12:05') }
    const owned = { id: charge.id, tenantId: cafe.tenantId, orderId, branchId: cafe.branchId }
    await Promise.all([openReviewCase(db, owned, { ...found, by: null }), openReviewCase(db, owned, { ...found, by: cafe.cashier.userId })])
    expect(await casesOf(orderId)).toHaveLength(1)
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.khqr_review.open'))).toHaveLength(1)
  })
})

async function saveExchangeRateForKhr() {
  const { setExchangeRate } = await import('#server/features/orders/counter.service')
  await setExchangeRate(db, cafe.owner, { khrPerUsd: 4100 }, monday('11:00'))
}

describe('the owner\'s review', () => {
  async function openCase(target = cafe) {
    const orderId = await target.place()
    const charge = await createKhqrCharge(db, target.cashier, orderId, { currency: 'USD' }, monday('12:02'))
    await payOrder(db, target.colleague, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), monday('12:02'))
    await recoverKhqrPayments(db, fakeBakong(paid()).clients, monday('12:03'))
    const [review] = await casesOf(orderId)
    return { orderId, chargeId: charge.id, id: review!.id }
  }
  const returned = (patch = {}) => ({ version: 1, method: 'cash' as const, currency: 'USD' as const, amount: 875, returnedAt: monday('12:10').toISOString(), reference: null, note: 'Paid twice; handed $8.75 back at the counter', ...patch })

  it('lists the open case with its order, branch, QR and what arrived', async () => {
    const { orderId } = await openCase()
    const reviews = await listKhqrReviews(db, cafe.tenantId, monday('12:05'))
    expect(reviews).toMatchObject({
      open: [{ reason: 'paid_otherwise', status: 'open', version: 1, order: { id: orderId, status: 'preparing', totalMinor: 875 }, expected: { currency: 'USD', amount: 875 }, received: { currency: 'USD', amount: 875 }, foundBy: null, returned: null }],
      returned: [],
      unchecked: 0,
    })
  })

  it('records the return once, with its audit; a replay answers the same and a stale version is refused', async () => {
    const { id } = await openCase()
    const key = crypto.randomUUID()
    const review = await recordKhqrReturn(db, cafe.owner, id, returned(), key, monday('12:20'))
    expect(review).toMatchObject({ status: 'returned', version: 2, returned: { method: 'cash', currency: 'USD', amount: 875, at: monday('12:10').toISOString(), by: { name: 'Kim' }, recordedAt: monday('12:20').toISOString() } })
    expect(await recordKhqrReturn(db, cafe.owner, id, returned(), key, monday('12:21'))).toMatchObject({ version: 2 })
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.khqr_review.return'))).toHaveLength(1)
    await expectApiError(() => recordKhqrReturn(db, cafe.owner, id, returned(), crypto.randomUUID(), monday('12:22')), 409, 'VERSION_CONFLICT')
    expect((await listKhqrReviews(db, cafe.tenantId, monday('12:23'))).returned).toHaveLength(1)
  })

  it('two owners recording at once: one return', async () => {
    const { id } = await openCase()
    const second: Actor = { ...cafe.owner, userId: (await createUser(db, 'second-owner@example.com', 'Lina')).id }
    // Both read version 1 before either writes: only the guard in the batch can refuse the second.
    let waiting = 0
    let release!: () => void
    const bothRead = new Promise<void>((resolve) => {
      release = resolve
    })
    const overlapping = Object.create(db) as Db
    const afterBothRead: Db['batch'] = async (statements) => {
      if (++waiting === 2) release()
      await bothRead
      return db.batch(statements)
    }
    overlapping.batch = afterBothRead
    const results = await Promise.allSettled([
      recordKhqrReturn(overlapping, cafe.owner, id, returned(), crypto.randomUUID(), monday('12:20')),
      recordKhqrReturn(overlapping, second, id, returned({ method: 'khqr' }), crypto.randomUUID(), monday('12:20')),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'orders.khqr_review.return'))).toHaveLength(1)
  })

  it('refuses a return time before the QR existed or in the future', async () => {
    const { id } = await openCase()
    await expectApiError(() => recordKhqrReturn(db, cafe.owner, id, returned({ returnedAt: monday('11:00').toISOString() }), crypto.randomUUID(), monday('12:20')), 422, 'VALIDATION_FAILED')
    await expectApiError(() => recordKhqrReturn(db, cafe.owner, id, returned({ returnedAt: monday('13:00').toISOString() }), crypto.randomUUID(), monday('12:20')), 422, 'VALIDATION_FAILED')
  })

  it('keeps cafes apart: another cafe\'s case is neither listed, counted nor recorded', async () => {
    const other = await openCafe('tenant-2')
    const theirs = await openCase(other)
    const ours = await openCase()
    expect((await listKhqrReviews(db, cafe.tenantId, monday('12:05'))).open.map(review => review.id)).toEqual([ours.id])
    expect((await listKhqrReviews(db, other.tenantId, monday('12:05'))).open.map(review => review.id)).toEqual([theirs.id])
    await expectApiError(() => recordKhqrReturn(db, cafe.owner, theirs.id, returned(), crypto.randomUUID(), monday('12:20')), 404, 'NOT_FOUND')
    expect(await casesOf(theirs.orderId)).toMatchObject([{ status: 'open', version: 1 }])
  })

  it('is closed to a platform support visit', () => {
    expect(isSupportReadable({ payment: ['review'] })).toBe(false)
  })
})
