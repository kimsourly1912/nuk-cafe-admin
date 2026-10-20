import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, lt, min, or, sql } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { deleteOldest, readInChunks } from '#server/utils/batch'
import { byId, firstRow, inTenant } from '#server/utils/query'
import type { WorkClaim } from '#server/utils/claims'
import { claimAttempt, ownsWork, pendingWork } from '#server/utils/claims'
import type { StoredMessage } from './notifications.schema'
import { notificationDeliveries, telegramDestinations } from './notifications.schema'

// --- Row types ---

export type DeliveryRow = typeof notificationDeliveries.$inferSelect

export interface NewDelivery {
  id: string
  tenantId: string
  kind: DeliveryRow['kind']
  destinationId: string
  dedupeKey: string
  subject: string
  message: StoredMessage
  status?: DeliveryRow['status']
  attempts?: number
  createdAt: Date
  nextAttemptAt: Date
  sentAt?: Date
}

export interface DeliveryHistoryRow { delivery: DeliveryRow, title: string }

export interface DeliverySnapshotRow extends DeliveryHistoryRow { destinationStatus: string }

// --- Columns and conditions ---

const deliveryColumns = getTableColumns(notificationDeliveries)

const ownsDelivery = (tenantId: string, id: string, token: string) => ownsWork(notificationDeliveries, token, byId(notificationDeliveries, tenantId, id), eq(notificationDeliveries.status, 'pending'))

// --- Reads ---

/** Which of these deliveries exist (a dropped duplicate doesn't). */
export async function findDeliveryIds(db: Db, tenantId: string, ids: string[]): Promise<Set<string>> {
  const rows = await readInChunks(ids, piece => db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).where(inTenant(notificationDeliveries, tenantId, inArray(notificationDeliveries.id, piece))))
  return new Set(rows.map(row => row.id))
}

/** Which of these chats already have a delivery with this key. */
export async function deliveredTo(db: Db, tenantId: string, dedupeKey: string, destinationIds: string[]): Promise<Set<string>> {
  const rows = await readInChunks(destinationIds, ids => db.select({ destinationId: notificationDeliveries.destinationId }).from(notificationDeliveries)
    .where(inTenant(
      notificationDeliveries,
      tenantId,
      eq(notificationDeliveries.dedupeKey, dedupeKey),
      inArray(notificationDeliveries.destinationId, ids),
    )))
  return new Set(rows.map(row => row.destinationId))
}

/** Across cafes: due sends, oldest first; uses notification_deliveries_due_idx. Optional ids are chunked. */
export async function dueDeliveries(db: Db, now: Date, limit: number, ids?: string[]): Promise<DeliveryRow[]> {
  const query = (piece?: string[]) => db.select(deliveryColumns).from(notificationDeliveries)
    .where(and(
      pendingWork(notificationDeliveries, now),
      piece ? inArray(notificationDeliveries.id, piece) : undefined,
    ))
    .orderBy(asc(notificationDeliveries.nextAttemptAt), asc(notificationDeliveries.id)).limit(limit)
  if (ids === undefined) return query()
  const rows = await readInChunks(ids, piece => query(piece))
  return rows.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit)
}

export function findDelivery(db: Db, tenantId: string, id: string): Promise<DeliverySnapshotRow | undefined> {
  return firstRow(db.select({ delivery: deliveryColumns, title: telegramDestinations.title, destinationStatus: telegramDestinations.status })
    .from(notificationDeliveries)
    .innerJoin(telegramDestinations, and(
      eq(telegramDestinations.tenantId, notificationDeliveries.tenantId),
      eq(telegramDestinations.id, notificationDeliveries.destinationId),
    ))
    .where(byId(notificationDeliveries, tenantId, id)))
}

/** The cafe's newest history, using notification_deliveries_tenant_created_idx. */
export function listRecentDeliveries(db: Db, tenantId: string, limit: number): Promise<DeliveryHistoryRow[]> {
  return db.select({ delivery: deliveryColumns, title: telegramDestinations.title })
    .from(notificationDeliveries)
    .innerJoin(telegramDestinations, and(
      eq(telegramDestinations.tenantId, notificationDeliveries.tenantId),
      eq(telegramDestinations.id, notificationDeliveries.destinationId),
    ))
    .where(inTenant(notificationDeliveries, tenantId))
    .orderBy(desc(notificationDeliveries.createdAt), desc(notificationDeliveries.id))
    .limit(limit)
}

/** Across cafes: health checks the oldest overdue send, using notification_deliveries_due_idx. */
export async function oldestDueNotification(db: Db, now: Date): Promise<Date | null> {
  const [row] = await db.select({ at: min(notificationDeliveries.nextAttemptAt) }).from(notificationDeliveries)
    .where(pendingWork(notificationDeliveries, now))
  return row?.at ?? null
}

/**
 * Across cafes: Telegram deliveries going wrong, grouped by cafe (the console's System health, P4, D192): failed ones
 * made since `since`, pending ones retrying after a failed try, and the latest failed try. Counts
 * and dates only; never the message, the chat or the error. Reads `notification_deliveries_created_idx`.
 */
export async function deliveryHealth(db: Db, since: Date): Promise<{ tenantId: string, failed: number, retrying: number, lastFailureAt: Date | null }[]> {
  const rows = await db.select({
    tenantId: notificationDeliveries.tenantId,
    failed: sql<number>`sum(case when ${notificationDeliveries.status} = 'failed' then 1 else 0 end)`.mapWith(Number),
    retrying: sql<number>`sum(case when ${notificationDeliveries.status} = 'pending' and ${notificationDeliveries.attempts} > 0 then 1 else 0 end)`.mapWith(Number),
    lastFailureAt: sql<number | null>`max(case when ${notificationDeliveries.status} = 'failed' or ${notificationDeliveries.attempts} > 0 then ${notificationDeliveries.createdAt} end)`,
  }).from(notificationDeliveries)
    .where(and(gte(notificationDeliveries.createdAt, since), or(
      eq(notificationDeliveries.status, 'failed'),
      and(eq(notificationDeliveries.status, 'pending'), gt(notificationDeliveries.attempts, 0)),
    )))
    .groupBy(notificationDeliveries.tenantId)
  return rows.map(row => ({ ...row, lastFailureAt: row.lastFailureAt == null ? null : new Date(row.lastFailureAt) }))
}

// --- Write statements ---

/** Saves a delivery unless the chat already has one about the same thing (the dedupe key). */
export function insertDeliveryStatement(db: Db, delivery: NewDelivery): Statement {
  return db.insert(notificationDeliveries).values(delivery).onConflictDoNothing()
}

/** Marks only this cafe's claim sent. Follow it with `requireOneChange` in the service's batch. */
export function markDeliveredStatement(db: Db, tenantId: string, id: string, token: string, at: Date): Statement {
  return db.update(notificationDeliveries).set({ status: 'sent', sentAt: at, lastError: null, claimToken: null }).where(ownsDelivery(tenantId, id, token))
}

/** Requeues the cafe's failed delivery. Follow it with `requireOneChange` and audit in the same batch. */
export function requeueFailedStatement(db: Db, tenantId: string, id: string, now: Date): Statement {
  return db.update(notificationDeliveries).set({ status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null, claimToken: null })
    .where(inTenant(
      notificationDeliveries,
      tenantId,
      eq(notificationDeliveries.id, id),
      eq(notificationDeliveries.status, 'failed'),
    ))
}

// --- Background-task writes ---

/**
 * Claims a due delivery for one run: counts the try and pushes its next time out, only if it's still
 * pending and due. Two overlapping runs never send it at once.
 */
export async function claimDelivery(db: Db, tenantId: string, id: string, until: Date, now: Date): Promise<(DeliveryRow & WorkClaim) | undefined> {
  const claim = claimAttempt(notificationDeliveries)
  const [claimed] = await db.update(notificationDeliveries)
    .set({ ...claim, nextAttemptAt: until })
    .where(inTenant(
      notificationDeliveries,
      tenantId,
      eq(notificationDeliveries.id, id),
      pendingWork(notificationDeliveries, now),
    ))
    .returning(deliveryColumns)
  return claimed ? { ...claimed, claimToken: claim.claimToken } : undefined
}

export async function markRetry(db: Db, tenantId: string, id: string, token: string, next: Date, reason: string): Promise<boolean> {
  const rows = await db.update(notificationDeliveries).set({ nextAttemptAt: next, lastError: reason, claimToken: null }).where(ownsDelivery(tenantId, id, token)).returning({ id: notificationDeliveries.id })
  return rows.length === 1
}

export async function markFailed(db: Db, tenantId: string, id: string, token: string, reason: string): Promise<boolean> {
  const rows = await db.update(notificationDeliveries).set({ status: 'failed', lastError: reason, claimToken: null }).where(ownsDelivery(tenantId, id, token)).returning({ id: notificationDeliveries.id })
  return rows.length === 1
}

/** Across cafes: bounded expiry of delivery history; uses notification_deliveries_created_idx. */
export function deleteDeliveriesBefore(db: Db, cutoff: Date, limit: number): Promise<number> {
  return deleteOldest(db, notificationDeliveries, notificationDeliveries.id, lt(notificationDeliveries.createdAt, cutoff), [asc(notificationDeliveries.createdAt), asc(notificationDeliveries.id)], limit)
}
