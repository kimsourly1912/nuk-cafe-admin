import { and, asc, eq, getTableColumns, gt, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { deleteOldest } from '#server/utils/batch'
import { firstRow, hasAny, inTenant } from '#server/utils/query'
import type { WorkClaim } from '#server/utils/claims'
import { availableLease, claimAttempt, ownsWork } from '#server/utils/claims'
import { orderReadyAlerts } from './notifications.schema'

// --- Row types ---

export type OrderReadyAlertRow = typeof orderReadyAlerts.$inferSelect

/** A send of one subscription: what it is for, and the claim that lets it complete. */
export type OrderReadyClaim = OrderReadyAlertRow & WorkClaim & { chatId: string }

// --- Columns and conditions ---

const alertColumns = getTableColumns(orderReadyAlerts)

/** The claim's own subscription and token: what a sender must still hold to change the row. */
const ownsOrderReady = (claim: OrderReadyClaim) => ownsWork(orderReadyAlerts, claim.claimToken,
  inTenant(orderReadyAlerts, claim.tenantId, eq(orderReadyAlerts.orderId, claim.orderId)),
  and(
    claim.subscriptionId === null ? isNull(orderReadyAlerts.subscriptionId) : eq(orderReadyAlerts.subscriptionId, claim.subscriptionId),
    isNull(orderReadyAlerts.notifiedAt),
  )!,
)

// --- Reads ---

export async function findOrderReadyAlert(db: Db, tenantId: string, orderId: string): Promise<OrderReadyAlertRow | undefined> {
  return firstRow(db.select(alertColumns).from(orderReadyAlerts).where(inTenant(orderReadyAlerts, tenantId, eq(orderReadyAlerts.orderId, orderId))))
}

/** Across cafes: the webhook knows only the hashed code. */
export async function findOrderReadyAlertByCode(db: Db, codeHash: string): Promise<OrderReadyAlertRow | undefined> {
  return firstRow(db.select(alertColumns).from(orderReadyAlerts).where(eq(orderReadyAlerts.codeHash, codeHash)))
}

/** Whether a sender holds an unexpired claim on the order's message. */
export async function hasOrderReadyClaim(db: Db, tenantId: string, orderId: string, now: Date): Promise<boolean> {
  return hasAny(db, orderReadyAlerts, inTenant(
    orderReadyAlerts,
    tenantId,
    eq(orderReadyAlerts.orderId, orderId),
    gt(orderReadyAlerts.claimUntil, now),
  ))
}

/** Across cafes: subscribed, unsent messages due with no live lease; uses order_ready_alerts_due_idx. */
export async function dueOrderReadyAlerts(db: Db, now: Date, limit: number): Promise<{ tenantId: string, orderId: string }[]> {
  return db.select({ tenantId: orderReadyAlerts.tenantId, orderId: orderReadyAlerts.orderId }).from(orderReadyAlerts)
    .where(and(
      isNotNull(orderReadyAlerts.chatId),
      isNull(orderReadyAlerts.notifiedAt),
      isNotNull(orderReadyAlerts.retryAt),
      lte(orderReadyAlerts.retryAt, now),
      availableLease(orderReadyAlerts.claimUntil, now),
    ))
    .orderBy(asc(orderReadyAlerts.retryAt), asc(orderReadyAlerts.orderId))
    .limit(limit)
}

// --- Write statements ---

/**
 * A new link for the order: a new code and expiry. A chat that already asked stays until a new one
 * uses the new code; a message already sent stays sent.
 */
export function upsertOrderReadyLinkStatement(db: Db, link: { tenantId: string, orderId: string, codeHash: string, linkExpiresAt: Date, createdAt: Date }): Statement {
  return db.insert(orderReadyAlerts).values(link)
    .onConflictDoUpdate({ target: orderReadyAlerts.orderId, set: { codeHash: link.codeHash, linkExpiresAt: link.linkExpiresAt }, setWhere: inTenant(orderReadyAlerts, link.tenantId) })
}

/**
 * A chat used the code: it gets the message. Only the code it was given, unexpired, once (the code
 * is cleared; a guard follows it in the batch). In the same statement the subscription gets a new
 * identity, any older send loses its claim, and the scheduled run is due now: if the order was
 * marked ready while the chat signed up, that is the durable work that sends it.
 */
export function subscribeOrderReadyAlertStatement(db: Db, tenantId: string, orderId: string, codeHash: string, chatId: string, subscriptionId: string, now: Date): Statement {
  return db.update(orderReadyAlerts)
    .set({ chatId, codeHash: null, subscribedAt: now, subscriptionId, claimToken: null, claimUntil: null, attempts: 0, retryAt: now })
    .where(inTenant(
      orderReadyAlerts,
      tenantId,
      eq(orderReadyAlerts.orderId, orderId),
      eq(orderReadyAlerts.codeHash, codeHash),
      gt(orderReadyAlerts.linkExpiresAt, now),
    ))
}

// --- Background-task writes ---

/**
 * Claims the order's message for one sender (the ready event, the sign-up catch-up or the scheduled
 * run): one atomic update, only while a chat is waiting, nothing was sent and nobody else holds an
 * unexpired claim. Counts the try; the lease ends at `until` (an abandoned claim is claimable then).
 */
export async function claimOrderReady(db: Db, tenantId: string, orderId: string, until: Date, now: Date): Promise<OrderReadyClaim | undefined> {
  const claim = claimAttempt(orderReadyAlerts)
  const [claimed] = await db.update(orderReadyAlerts)
    .set({ ...claim, claimUntil: until, retryAt: until })
    .where(inTenant(
      orderReadyAlerts,
      tenantId,
      eq(orderReadyAlerts.orderId, orderId),
      isNotNull(orderReadyAlerts.chatId),
      isNull(orderReadyAlerts.notifiedAt),
      availableLease(orderReadyAlerts.claimUntil, now),
    ))
    .returning(alertColumns)
  return claimed ? { ...claimed, chatId: claimed.chatId!, claimToken: claim.claimToken } : undefined
}

/**
 * Sent (or given up on): the chat is forgotten. Only for the subscription and claim the sender
 * holds, so an old send never marks a newer chat. Returns whether it did.
 */
export async function markOrderReadyComplete(db: Db, claim: OrderReadyClaim, at: Date): Promise<boolean> {
  const done = await db.update(orderReadyAlerts)
    .set({ chatId: null, notifiedAt: at, claimToken: null, claimUntil: null, retryAt: null })
    .where(ownsOrderReady(claim)).returning({ orderId: orderReadyAlerts.orderId })
  return done.length === 1
}

/** A try that failed: the claim is released and the scheduled run tries again at `next`. */
export async function markOrderReadyRetry(db: Db, claim: OrderReadyClaim, next: Date): Promise<boolean> {
  const done = await db.update(orderReadyAlerts)
    .set({ claimToken: null, claimUntil: null, retryAt: next })
    .where(ownsOrderReady(claim)).returning({ orderId: orderReadyAlerts.orderId })
  return done.length === 1
}

/** Nothing to send yet (the order is still being prepared): releases the claim without counting the try; the ready event comes. */
export async function markOrderReadyParked(db: Db, claim: OrderReadyClaim): Promise<boolean> {
  const done = await db.update(orderReadyAlerts)
    .set({ claimToken: null, claimUntil: null, retryAt: null, attempts: sql`max(${orderReadyAlerts.attempts} - 1, 0)` })
    .where(ownsOrderReady(claim)).returning({ orderId: orderReadyAlerts.orderId })
  return done.length === 1
}

/** Too many tries: the chat is forgotten without a "sent" mark (nothing was confirmed). */
export async function markOrderReadyAbandoned(db: Db, claim: OrderReadyClaim): Promise<boolean> {
  const done = await db.update(orderReadyAlerts)
    .set({ chatId: null, claimToken: null, claimUntil: null, retryAt: null })
    .where(ownsOrderReady(claim)).returning({ orderId: orderReadyAlerts.orderId })
  return done.length === 1
}

/** Across cafes: bounded cleanup of old alerts, using order_ready_alerts_created_idx. */
export function deleteOrderReadyAlertsBefore(db: Db, cutoff: Date, limit: number): Promise<number> {
  return deleteOldest(db, orderReadyAlerts, orderReadyAlerts.orderId, lt(orderReadyAlerts.createdAt, cutoff), [asc(orderReadyAlerts.createdAt), asc(orderReadyAlerts.orderId)], limit)
}
