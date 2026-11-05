import { and, asc, desc, eq, gt, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { KhqrCurrency, KhqrReviewReason, KhqrReviewStatus, OrderStatus, ReturnMethod } from '#shared/contracts/orders'
import { branches, user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { updateAtVersion } from '#server/utils/batch'
import type { WorkClaim } from '#server/utils/claims'
import { availableLease, claimAttempt } from '#server/utils/claims'
import { byId, firstRow, inTenant } from '#server/utils/query'
import { khqrCharges, khqrReviewCases, orders } from './orders.schema'

/**
 * KHQR recovery (D266): the server's own checks of each QR with Bakong, and the review cases for
 * bank payments an order couldn't take. The work is the charge row itself (`recovery_*`), written in
 * the charge's insert.
 */

const openRecovery = eq(khqrCharges.recoveryState, 'open')

export interface RecoveryCharge {
  id: string
  tenantId: string
  orderId: string
  branchId: string
  currency: KhqrCurrency
  amount: number
  accountId: string
  md5: string
  createdBy: string
  createdAt: Date
  expiresAt: Date
}

const recoveryColumns = {
  id: khqrCharges.id,
  tenantId: khqrCharges.tenantId,
  orderId: khqrCharges.orderId,
  branchId: khqrCharges.branchId,
  currency: khqrCharges.currency,
  amount: khqrCharges.amount,
  accountId: khqrCharges.accountId,
  md5: khqrCharges.md5,
  createdBy: khqrCharges.createdBy,
  createdAt: khqrCharges.createdAt,
  expiresAt: khqrCharges.expiresAt,
}

/**
 * Across cafes: open QRs whose next check is due (null: made before D266 rolled out, due now),
 * the longest waiting first. Uses `khqr_charges_recovery_idx` (open QRs only).
 */
export function dueRecoveryCharges(db: Db, now: Date, limit: number): Promise<RecoveryCharge[]> {
  return db.select(recoveryColumns).from(khqrCharges)
    .where(and(openRecovery, or(isNull(khqrCharges.recoveryNextAt), lte(khqrCharges.recoveryNextAt, now))))
    .orderBy(asc(khqrCharges.recoveryNextAt), asc(khqrCharges.id))
    .limit(limit)
}

/**
 * The turn to ask Bakong about this QR until `until`: the same lease the counter's check takes
 * (audit S5), so the two never ask at once, plus a fresh claim token only this run can settle with.
 * `undefined` when the QR isn't open any more or another check holds it.
 */
export async function claimRecovery(db: Db, tenantId: string, id: string, until: Date, now: Date): Promise<WorkClaim | undefined> {
  const attempt = claimAttempt({ claimToken: khqrCharges.recoveryClaimToken, attempts: khqrCharges.recoveryAttempts })
  const [claimed] = await db.update(khqrCharges)
    .set({ recoveryClaimToken: attempt.claimToken, recoveryAttempts: attempt.attempts, bakongCheckUntil: until })
    .where(inTenant(khqrCharges, tenantId, eq(khqrCharges.id, id), openRecovery, availableLease(khqrCharges.bakongCheckUntil, now)))
    .returning({ claimToken: khqrCharges.recoveryClaimToken, attempts: khqrCharges.recoveryAttempts })
  return claimed?.claimToken ? { claimToken: claimed.claimToken, attempts: claimed.attempts } : undefined
}

const ownsRecovery = (tenantId: string, id: string, token: string) =>
  inTenant(khqrCharges, tenantId, eq(khqrCharges.id, id), openRecovery, eq(khqrCharges.recoveryClaimToken, token))

/** After an answer that settles nothing: the next check, and why this one couldn't answer. Only the claim's own run. */
export async function rescheduleRecovery(db: Db, tenantId: string, id: string, token: string, values: { nextAt: Date, problem: string | null, checkedAt: Date }): Promise<boolean> {
  const changed = await db.update(khqrCharges)
    .set({ recoveryNextAt: values.nextAt, recoveryProblem: values.problem, recoveryCheckedAt: values.checkedAt, recoveryClaimToken: null })
    .where(ownsRecovery(tenantId, id, token))
    .returning({ id: khqrCharges.id })
  return changed.length > 0
}

/**
 * The QR's checks end: `done` (a payment names it or a review case holds its money) or `stopped`
 * (the window is over). With `token`, only that claim's run; without, whoever settles it first (a
 * counter's payment or case). Changes nothing once it isn't open, so it never needs a guard after it.
 */
export function finishRecoveryStatement(db: Db, tenantId: string, id: string, values: { state: 'done' | 'stopped', problem?: string | null, checkedAt?: Date }, token?: string): Statement {
  return db.update(khqrCharges)
    .set({ recoveryState: values.state, recoveryNextAt: null, recoveryClaimToken: null, ...(values.problem !== undefined && { recoveryProblem: values.problem }), ...(values.checkedAt && { recoveryCheckedAt: values.checkedAt }) })
    .where(token ? ownsRecovery(tenantId, id, token) : inTenant(khqrCharges, tenantId, eq(khqrCharges.id, id), openRecovery))
}

/**
 * Payments' count: the cafe's QRs whose checks ended since `since` without Bakong ever answering
 * the last one (no token, refused, errors). Uses `khqr_charges_tenant_recovery_idx`.
 */
export function countUncheckedCharges(db: Db, tenantId: string, since: Date): Promise<number> {
  return db.$count(khqrCharges, inTenant(
    khqrCharges,
    tenantId,
    eq(khqrCharges.recoveryState, 'stopped'),
    gt(khqrCharges.expiresAt, since),
    isNotNull(khqrCharges.recoveryProblem),
    // Bakong answered those: the money went to another account (logged), not unchecked.
    ne(khqrCharges.recoveryProblem, 'account_mismatch'),
  ))
}

// --- Review cases ---

export interface NewReviewCase {
  tenantId: string
  branchId: string
  orderId: string
  chargeId: string
  reason: KhqrReviewReason
  receivedCurrency: KhqrCurrency
  receivedAmount: number
  bankHash: string | null
  bankReference: string | null
  foundBy: string | null
  foundAt: Date
}

/**
 * Opens the QR's case. A second one for the same QR (the counter and the server at once) fails the
 * batch on `khqr_review_cases_charge_idx`: the caller treats that as already opened.
 */
export function insertReviewCaseStatement(db: Db, review: NewReviewCase & { id: string }): Statement {
  return db.insert(khqrReviewCases).values(review)
}

const foundByUser = alias(user, 'found_by_user')
const returnedByUser = alias(user, 'returned_by_user')

export interface ReviewCaseRow {
  id: string
  version: number
  status: KhqrReviewStatus
  reason: KhqrReviewReason
  branchId: string
  branchName: string
  orderId: string
  pickupNumber: number
  businessDate: string
  orderStatus: OrderStatus
  totalMinor: number
  expectedCurrency: KhqrCurrency
  expectedAmount: number
  chargeCreatedAt: Date
  receivedCurrency: KhqrCurrency
  receivedAmount: number
  bankReference: string | null
  bankHash: string | null
  foundAt: Date
  foundByName: string | null
  returnMethod: ReturnMethod | null
  returnCurrency: KhqrCurrency | null
  returnAmount: number | null
  returnedAt: Date | null
  returnReference: string | null
  returnNote: string | null
  returnedByName: string | null
  returnRecordedAt: Date | null
}

const reviewColumns = {
  id: khqrReviewCases.id,
  version: khqrReviewCases.version,
  status: khqrReviewCases.status,
  reason: khqrReviewCases.reason,
  branchId: khqrReviewCases.branchId,
  branchName: branches.name,
  orderId: khqrReviewCases.orderId,
  pickupNumber: orders.pickupNumber,
  businessDate: orders.businessDate,
  orderStatus: orders.status,
  totalMinor: orders.totalMinor,
  expectedCurrency: khqrCharges.currency,
  expectedAmount: khqrCharges.amount,
  chargeCreatedAt: khqrCharges.createdAt,
  receivedCurrency: khqrReviewCases.receivedCurrency,
  receivedAmount: khqrReviewCases.receivedAmount,
  bankReference: khqrReviewCases.bankReference,
  bankHash: khqrReviewCases.bankHash,
  foundAt: khqrReviewCases.foundAt,
  foundByName: foundByUser.name,
  returnMethod: khqrReviewCases.returnMethod,
  returnCurrency: khqrReviewCases.returnCurrency,
  returnAmount: khqrReviewCases.returnAmount,
  returnedAt: khqrReviewCases.returnedAt,
  returnReference: khqrReviewCases.returnReference,
  returnNote: khqrReviewCases.returnNote,
  returnedByName: returnedByUser.name,
  returnRecordedAt: khqrReviewCases.returnRecordedAt,
}

/** The case with its order, branch and QR, all joined within the cafe (composite keys). */
function selectReviews(db: Db) {
  return db.select(reviewColumns).from(khqrReviewCases)
    .innerJoin(branches, and(eq(branches.tenantId, khqrReviewCases.tenantId), eq(branches.id, khqrReviewCases.branchId)))
    .innerJoin(orders, and(eq(orders.tenantId, khqrReviewCases.tenantId), eq(orders.id, khqrReviewCases.orderId)))
    .innerJoin(khqrCharges, and(eq(khqrCharges.tenantId, khqrReviewCases.tenantId), eq(khqrCharges.id, khqrReviewCases.chargeId)))
    .leftJoin(foundByUser, eq(foundByUser.id, khqrReviewCases.foundBy))
    .leftJoin(returnedByUser, eq(returnedByUser.id, khqrReviewCases.returnedBy))
    .$dynamic()
}

/**
 * The cafe's open cases (all: one per QR paid by mistake, so few) and its latest returned ones, in
 * one batch. Oldest open first, newest returned first. Uses `khqr_review_cases_status_idx`.
 */
export async function reviewCaseRows(db: Db, tenantId: string, returnedLimit: number): Promise<{ open: ReviewCaseRow[], returned: ReviewCaseRow[] }> {
  const [open, returned] = await db.batch([
    selectReviews(db).where(inTenant(khqrReviewCases, tenantId, eq(khqrReviewCases.status, 'open'))).orderBy(asc(khqrReviewCases.foundAt), asc(khqrReviewCases.id)),
    selectReviews(db).where(inTenant(khqrReviewCases, tenantId, eq(khqrReviewCases.status, 'returned'))).orderBy(desc(khqrReviewCases.foundAt), desc(khqrReviewCases.id)).limit(returnedLimit),
  ])
  return { open, returned }
}

export function findReviewCase(db: Db, tenantId: string, id: string): Promise<ReviewCaseRow | undefined> {
  return firstRow(selectReviews(db).where(byId(khqrReviewCases, tenantId, id)))
}

export interface ReturnValues {
  returnMethod: ReturnMethod
  returnCurrency: KhqrCurrency
  returnAmount: number
  returnedAt: Date
  returnReference: string | null
  returnNote: string
  returnedBy: string
  returnRecordedAt: Date
}

/** The owner's record of how the money went back: only an open case, at the version read. Follow it with `requireOneChange`. */
export function recordReturnStatement(db: Db, tenantId: string, id: string, version: number, values: ReturnValues): Statement {
  return updateAtVersion(db, khqrReviewCases, { tenantId, id, version }, { ...values, status: 'returned' }, eq(khqrReviewCases.status, 'open'))
}
