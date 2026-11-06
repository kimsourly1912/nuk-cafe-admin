import type { KhqrCurrency, KhqrReview, KhqrReviewReason, KhqrReviews, RecordKhqrReturnInput } from '#shared/contracts/orders'
import { KHQR_CURRENCIES, KHQR_RECOVERY_HOURS } from '#shared/contracts/orders'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { log } from '#server/utils/log'
import { toIso } from '#server/utils/time'
import type { Actor } from '#server/features/identity'
import { auditStatement, outboxStatement, withIdempotency } from '#server/features/platform'
import type { BakongClient, BakongProblem, BakongTransaction } from './bakong'
import * as recoveryRepo from './khqr-recovery.repository'
import type { RecoveryCharge } from './khqr-recovery.repository'
import { khqrReturnTimeInvalid, khqrReviewChanged, khqrReviewNotFound } from './orders.errors'
import { ORDER_EVENTS } from './orders.events'
import * as repo from './orders.repository'

/**
 * KHQR recovery (D266). The counter asks Bakong while a QR is on its screen; when the tablet closes,
 * the page reloads or a write fails, that stops. The `orders:recover-khqr` task keeps asking about
 * every QR until KHQR_RECOVERY_HOURS after it expires (owner, 2026-11-05):
 *
 * - paid as the QR asked, and the order still waits for payment → the payment is recorded by the
 *   system (event and audit with no actor), with the same guards as the counter's;
 * - paid, but the order was paid another way, cancelled, or the money differs from the QR's → a
 *   review case only the cafe's owners see (`payment: ['review']`). Nothing is sent back
 *   automatically: the owner records how the money went back;
 * - not paid, or Bakong can't say → asked again later; once the window is over the checks stop,
 *   and a QR whose last check had no answer is counted on Payments as unchecked (never "unpaid").
 *
 * A customer can pay a QR only while it works, so it is asked every LIVE_GAP_MS until it expires,
 * then a few times while a slow bank posts the payment: about a dozen questions per unpaid QR.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** How often the server asks while the QR still works (the counter asks every 5 s while it's shown). */
export const LIVE_GAP_MS = 2 * MINUTE

/** After the QR expires, asked once more at each of these delays, the last at the window's end. */
export const AFTER_EXPIRY_MS = [MINUTE, 10 * MINUTE, HOUR, 6 * HOUR, KHQR_RECOVERY_HOURS * HOUR]

/** The task's lease on a QR: one Bakong question (8 s at most) and its write. The counter's check waits it out. */
export const RECOVERY_LEASE_MS = 30_000

/** QRs per run: a backlog clears over the next minutes; each is one Bakong question at most. */
const PER_RUN = 25

/** The first check, a minute after the QR is made: the counter usually settles it before. */
export function firstRecoveryCheck(createdAt: Date): Date {
  return new Date(createdAt.getTime() + MINUTE)
}

/** The check after one at `now`; null once the window is over (this was the last). */
export function nextRecoveryCheck(charge: { expiresAt: Date }, now: Date): Date | null {
  const expiresAt = charge.expiresAt.getTime()
  if (now.getTime() < expiresAt) return new Date(Math.min(now.getTime() + LIVE_GAP_MS, expiresAt + AFTER_EXPIRY_MS[0]!))
  const next = AFTER_EXPIRY_MS.map(delay => expiresAt + delay).find(at => at > now.getTime())
  return next === undefined ? null : new Date(next)
}

/** Bakong's amount in the QR's units (cents or riel), the one rounding `matchesCharge` also uses. */
export function receivedMinor(currency: KhqrCurrency, amount: number): number {
  return currency === 'USD' ? Math.round(amount * 100) : Math.round(amount)
}

const knownCurrency = (currency: string): KhqrCurrency | undefined => {
  const upper = currency.trim().toUpperCase()
  return (KHQR_CURRENCIES as readonly string[]).includes(upper) ? upper as KhqrCurrency : undefined
}

/**
 * Whether Bakong's payment reached the QR's own account in a currency we know. Anything else isn't
 * this cafe's money to give back: nothing is opened, the check stops and logs it.
 */
export function receivedByCafe(charge: { accountId: string }, transaction: BakongTransaction): KhqrCurrency | undefined {
  if (transaction.toAccountId.trim().toLowerCase() !== charge.accountId.toLowerCase()) return undefined
  return knownCurrency(transaction.currency)
}

/**
 * The statements that open a review case for a QR's payment, with its audit, and end the QR's
 * checks. Run in one batch; a unique violation there means the case is already open (the counter
 * and the server at once): see `openReviewCase`.
 */
/** The QR a case is about, within its cafe. */
export interface ReviewCharge {
  id: string
  tenantId: string
  orderId: string
  branchId: string
}

/** What Bakong confirmed, why the order couldn't take it, and who asked (`null`: the server). */
export interface FoundPayment {
  reason: KhqrReviewReason
  currency: KhqrCurrency
  /** Minor units: cents or riel. */
  amount: number
  transaction: BakongTransaction
  by: string | null
  at: Date
}

export function reviewCaseStatements(db: Db, charge: ReviewCharge, found: FoundPayment, token?: string): Statement[] {
  const id = newId()
  return [
    recoveryRepo.insertReviewCaseStatement(db, {
      id,
      tenantId: charge.tenantId,
      branchId: charge.branchId,
      orderId: charge.orderId,
      chargeId: charge.id,
      reason: found.reason,
      receivedCurrency: found.currency,
      receivedAmount: found.amount,
      bankHash: found.transaction.hash?.slice(0, 128) ?? null,
      bankReference: found.transaction.externalRef?.slice(0, 64) ?? null,
      foundBy: found.by,
      foundAt: found.at,
    }),
    auditStatement(db, { userId: found.by, tenantId: charge.tenantId }, {
      action: 'orders.khqr_review.open',
      targetType: 'khqr_review_case',
      targetId: id,
      branchId: charge.branchId,
      metadata: { orderId: charge.orderId, chargeId: charge.id, reason: found.reason, currency: found.currency, amount: found.amount },
    }),
    recoveryRepo.finishRecoveryStatement(db, charge.tenantId, charge.id, { state: 'done', checkedAt: found.at }, token),
  ]
}

/** Opens the case (see `reviewCaseStatements`). One already open for this QR is left as it is; any other failure throws. */
export async function openReviewCase(db: Db, charge: ReviewCharge, found: FoundPayment, token?: string): Promise<void> {
  try {
    await db.batch(reviewCaseStatements(db, charge, found, token) as [Statement, ...Statement[]])
  }
  catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Opened by the other check: this QR's checks still end.
    await db.batch([recoveryRepo.finishRecoveryStatement(db, charge.tenantId, charge.id, { state: 'done', checkedAt: found.at }, token)])
  }
}

/**
 * The system records the payment Bakong confirmed, as the counter's check would (D131): the order
 * at the version read, still awaiting payment, one payment per order. The event and audit have no
 * actor; the payment's `collected_by` is the cashier who made the QR (the column is required, and
 * the money came through their QR). False when the order moved on meanwhile.
 */
async function attachPayment(db: Db, charge: RecoveryCharge, order: repo.OrderRow, transaction: BakongTransaction, token: string, now: Date): Promise<boolean> {
  try {
    await db.batch([
      repo.transitionStatement(db, { tenantId: charge.tenantId, orderId: order.id, fromStatus: 'awaiting_payment', toStatus: 'preparing', version: order.version, at: now }),
      requireOneChange(db),
      repo.eventStatement(db, { tenantId: charge.tenantId, orderId: order.id, toVersion: order.version + 1, actorId: null, fromStatus: 'awaiting_payment', toStatus: 'preparing', note: 'Paid by KHQR: found by the automatic check', at: now }),
      repo.insertPaymentStatement(db, {
        tenantId: charge.tenantId,
        orderId: order.id,
        branchId: order.branchId,
        method: 'khqr',
        amountMinor: order.totalMinor,
        amountKhr: null,
        khrPerUsd: null,
        reference: (transaction.externalRef ?? transaction.hash)?.slice(0, 64) ?? null,
        khqrChargeId: charge.id,
        collectedBy: charge.createdBy,
        collectedAt: now,
      }),
      outboxStatement(db, charge.tenantId, ORDER_EVENTS.paid, { orderId: order.id }),
      auditStatement(db, { userId: null, tenantId: charge.tenantId }, {
        action: 'orders.order.pay',
        targetType: 'order',
        targetId: order.id,
        branchId: order.branchId,
        metadata: { from: 'awaiting_payment', to: 'preparing', method: 'khqr', amountMinor: order.totalMinor, amountKhr: null, khqrChargeId: charge.id, khqrCurrency: charge.currency, khqrAmount: charge.amount, checkedWithBakong: true, recovered: true },
      }),
      recoveryRepo.finishRecoveryStatement(db, charge.tenantId, charge.id, { state: 'done', checkedAt: now }, token),
    ])
    return true
  }
  catch (error) {
    // The counter, the expiry or a cash payment got there first (status/version guard, or the payment's unique order).
    if (isStaleWrite(error) || isUniqueViolation(error)) return false
    throw error
  }
}

export interface RecoveryReport {
  /** Payments recorded for orders still waiting. */
  paid: number
  /** Review cases opened. */
  reviews: number
  /** Asked, nothing yet (or Bakong couldn't say): asked again later. */
  waiting: number
  /** Checks that ended: paid elsewhere already, the window over, or not the cafe's money. */
  finished: number
  /** Held by the counter's check or another run. */
  skipped: number
}

/** The cafe's Bakong client for this run; `null` without a token. */
export type BakongClients = (tenantId: string) => Promise<BakongClient | null>

/** Problems that hold for every QR of the cafe this run: no more questions with that token now. */
const CAFE_WIDE: (BakongProblem | 'not_set_up')[] = ['not_set_up', 'token', 'key', 'refused']

/** Runs one recovery pass over the due QRs (`orders:recover-khqr`, every minute). Across cafes. */
export async function recoverKhqrPayments(db: Db, clients: BakongClients, now = new Date()): Promise<RecoveryReport> {
  const report: RecoveryReport = { paid: 0, reviews: 0, waiting: 0, finished: 0, skipped: 0 }
  const clientOf = new Map<string, Promise<BakongClient | null>>()
  const blocked = new Map<string, string>()

  for (const charge of await recoveryRepo.dueRecoveryCharges(db, now, PER_RUN)) {
    const [payment] = await repo.paymentsOf(db, charge.tenantId, [charge.orderId])
    if (payment?.khqrChargeId === charge.id) {
      // Paid with this QR (made before D266, or its write's own `done` was lost): nothing to ask.
      await db.batch([recoveryRepo.finishRecoveryStatement(db, charge.tenantId, charge.id, { state: 'done' })])
      report.finished++
      continue
    }
    const claim = await recoveryRepo.claimRecovery(db, charge.tenantId, charge.id, new Date(now.getTime() + RECOVERY_LEASE_MS), now)
    if (!claim) {
      report.skipped++
      continue
    }
    const settle = async (problem: string | null) => {
      const next = nextRecoveryCheck(charge, now)
      if (next) {
        await recoveryRepo.rescheduleRecovery(db, charge.tenantId, charge.id, claim.claimToken, { nextAt: next, problem, checkedAt: now })
        report.waiting++
      }
      else {
        await db.batch([recoveryRepo.finishRecoveryStatement(db, charge.tenantId, charge.id, { state: 'stopped', problem, checkedAt: now }, claim.claimToken)])
        report.finished++
      }
    }

    const cafeProblem = blocked.get(charge.tenantId)
    if (cafeProblem) {
      await settle(cafeProblem)
      continue
    }
    if (!clientOf.has(charge.tenantId)) clientOf.set(charge.tenantId, clients(charge.tenantId))
    const bakong = await clientOf.get(charge.tenantId)!
    if (!bakong) {
      blocked.set(charge.tenantId, 'not_set_up')
      await settle('not_set_up')
      continue
    }

    const answer = await bakong.checkByMd5(charge.md5)
    if (answer.kind === 'not_found') {
      await settle(null)
      continue
    }
    if (answer.kind === 'unavailable') {
      if (CAFE_WIDE.includes(answer.problem)) blocked.set(charge.tenantId, answer.problem)
      await settle(answer.problem)
      continue
    }

    const transaction = answer.transaction
    const currency = receivedByCafe(charge, transaction)
    if (!currency) {
      // Not to the QR's account, or a currency we don't know: not this cafe's money to give back.
      log('warn', 'KHQR payment not to the QR\'s account', { tenantId: charge.tenantId, chargeId: charge.id })
      await db.batch([recoveryRepo.finishRecoveryStatement(db, charge.tenantId, charge.id, { state: 'stopped', problem: 'account_mismatch', checkedAt: now }, claim.claimToken)])
      report.finished++
      continue
    }
    const amount = receivedMinor(currency, transaction.amount)
    const found = { currency, amount, transaction, by: null, at: now }
    if (currency !== charge.currency || amount !== charge.amount) {
      await openReviewCase(db, charge, { ...found, reason: 'amount_mismatch' }, claim.claimToken)
      report.reviews++
      continue
    }

    const order = await repo.findOrder(db, charge.tenantId, charge.orderId)
    if (order?.status === 'awaiting_payment' && await attachPayment(db, charge, order, transaction, claim.claimToken, now)) {
      report.paid++
      continue
    }
    const [after] = await repo.paymentsOf(db, charge.tenantId, [charge.orderId])
    if (after?.khqrChargeId === charge.id) {
      // The counter recorded this very QR meanwhile.
      await db.batch([recoveryRepo.finishRecoveryStatement(db, charge.tenantId, charge.id, { state: 'done', checkedAt: now }, claim.claimToken)])
      report.finished++
      continue
    }
    const current = await repo.findOrder(db, charge.tenantId, charge.orderId)
    await openReviewCase(db, charge, { ...found, reason: current?.status === 'cancelled' ? 'order_cancelled' : 'paid_otherwise' }, claim.claimToken)
    report.reviews++
  }
  return report
}

// --- The owner's review (`payment: ['review']`) ---

const RETURNED_SHOWN = 20
const UNCHECKED_DAYS = 30

const toReview = (row: recoveryRepo.ReviewCaseRow): KhqrReview => ({
  id: row.id,
  version: row.version,
  status: row.status,
  reason: row.reason,
  branch: { id: row.branchId, name: row.branchName },
  order: { id: row.orderId, pickupNumber: row.pickupNumber, businessDate: row.businessDate, status: row.orderStatus, totalMinor: row.totalMinor },
  expected: { currency: row.expectedCurrency, amount: row.expectedAmount },
  received: { currency: row.receivedCurrency, amount: row.receivedAmount },
  bankReference: row.bankReference,
  foundAt: toIso(row.foundAt),
  foundBy: row.foundByName === null ? null : { name: row.foundByName },
  returned: row.status === 'returned' && row.returnMethod && row.returnCurrency && row.returnAmount && row.returnedAt && row.returnNote && row.returnRecordedAt
    ? {
        method: row.returnMethod,
        currency: row.returnCurrency,
        amount: row.returnAmount,
        at: toIso(row.returnedAt),
        reference: row.returnReference,
        note: row.returnNote,
        by: { name: row.returnedByName ?? '' },
        recordedAt: toIso(row.returnRecordedAt),
      }
    : null,
})

/** Payments → Needs review: every open case, the latest returned ones, and the unchecked QRs' count. */
export async function listKhqrReviews(db: Db, tenantId: string, now = new Date()): Promise<KhqrReviews> {
  const [{ open, returned }, unchecked] = await Promise.all([
    recoveryRepo.reviewCaseRows(db, tenantId, RETURNED_SHOWN),
    recoveryRepo.countUncheckedCharges(db, tenantId, new Date(now.getTime() - UNCHECKED_DAYS * 24 * HOUR)),
  ])
  return { open: open.map(toReview), returned: returned.map(toReview), unchecked }
}

/** Clock skew allowed for "not in the future": the owner's device and the server's clock differ. */
const CLOCK_SKEW_MS = 5 * MINUTE

/**
 * The owner records how a case's money went back (`payment: ['review']`, D266): method, currency,
 * amount, when, and a note with the reason and evidence. Nothing is sent: it records what was done.
 * At the version read, only while open, with its audit and the idempotency key in one batch.
 */
export async function recordKhqrReturn(db: Db, actor: Actor, id: string, input: RecordKhqrReturnInput, key: string, now = new Date()): Promise<KhqrReview> {
  await withIdempotency(db, { tenantId: actor.tenantId, actorId: actor.userId, operation: 'orders.khqr_review.return', key }, { id, ...input }, async () => {
    const review = await recoveryRepo.findReviewCase(db, actor.tenantId, id)
    if (!review) throw khqrReviewNotFound()
    if (review.status !== 'open' || review.version !== input.version) throw khqrReviewChanged()
    const returnedAt = new Date(input.returnedAt)
    // Not before the QR existed (the money can't have gone back before it came), nor in the future.
    if (returnedAt.getTime() < review.chargeCreatedAt.getTime() || returnedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) throw khqrReturnTimeInvalid()
    return {
      statements: [
        recoveryRepo.recordReturnStatement(db, actor.tenantId, id, input.version, {
          returnMethod: input.method,
          returnCurrency: input.currency,
          returnAmount: input.amount,
          returnedAt,
          returnReference: input.reference || null,
          returnNote: input.note,
          returnedBy: actor.userId,
          returnRecordedAt: now,
        }),
        requireOneChange(db),
        auditStatement(db, actor, {
          action: 'orders.khqr_review.return',
          targetType: 'khqr_review_case',
          targetId: id,
          branchId: review.branchId,
          metadata: { orderId: review.orderId, method: input.method, currency: input.currency, amount: input.amount, returnedAt: returnedAt.toISOString(), received: { currency: review.receivedCurrency, amount: review.receivedAmount } },
        }),
      ],
      response: { id },
    }
  }, { onStale: khqrReviewChanged, now })
  const saved = await recoveryRepo.findReviewCase(db, actor.tenantId, id)
  if (!saved) throw khqrReviewNotFound()
  return toReview(saved)
}
