import { and, asc, desc, eq, inArray, lt, lte, min, or, sql } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { deleteOldest, readInChunks } from '#server/utils/batch'
import type { WorkClaim } from '#server/utils/claims'
import { availableLease, claimAttempt, ownsWork, pendingWork } from '#server/utils/claims'
import { newId } from '#server/utils/ids'
import { inJsonArray } from '#server/utils/query'
import { outboxMessages } from './platform.schema'
import type { OutboxTarget } from './platform.types'

// --- Row types ---

export interface DueMessage {
  id: string
  tenantId: string | null
  kind: string
  payload: Record<string, unknown>
  attempts: number
  nextAttemptAt: Date
}

export interface OutboxHealthRow {
  kind: string
  tenantId: string | null
  /** Pending, not tried yet. */
  waiting: number
  /** Pending after a failed try: will be retried. */
  failing: number
  /** Given up on. */
  dead: number
  /** The oldest unsent message of the group. */
  oldestAt: Date | null
}

// --- Columns and conditions ---

const unclaimed = (now: Date) => availableLease(outboxMessages.lockedUntil, now)

const ownsClaim = (id: string, token: string) => ownsWork(outboxMessages, token, eq(outboxMessages.id, id), eq(outboxMessages.status, 'pending'))

// --- Reads ---

/** Across cafes: pending work, including global rows, due without a live lease; uses outbox_messages_due_idx. */
export async function dueMessages(db: Db, now: Date, limit: number, target: OutboxTarget = {}): Promise<DueMessage[]> {
  const query = (ids?: string[]) => db.select({ id: outboxMessages.id, tenantId: outboxMessages.tenantId, kind: outboxMessages.kind, payload: outboxMessages.payload, attempts: outboxMessages.attempts, nextAttemptAt: outboxMessages.nextAttemptAt })
    .from(outboxMessages)
    .where(and(
      pendingWork(outboxMessages, now),
      unclaimed(now),
      target.kinds ? inJsonArray(outboxMessages.kind, target.kinds) : undefined,
      ids ? inArray(outboxMessages.id, ids) : undefined,
      target.order
        ? and(
            eq(outboxMessages.tenantId, target.order.tenantId),
            sql`json_extract(${outboxMessages.payload}, '$.orderId') = ${target.order.orderId}`,
          )
        : undefined,
    ))
    .orderBy(asc(outboxMessages.nextAttemptAt), asc(outboxMessages.id)).limit(limit)
  if (target.ids === undefined) return query()
  const rows = await readInChunks(target.ids, ids => query(ids))
  return rows.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit)
}

/** Across cafes: health age is about overdue work, not intentionally scheduled future retries. */
export async function oldestDueOutbox(db: Db, now: Date): Promise<Date | null> {
  const [row] = await db.select({ at: min(outboxMessages.nextAttemptAt) }).from(outboxMessages)
    .where(and(eq(outboxMessages.status, 'pending'), lte(outboxMessages.nextAttemptAt, now)))
  return row?.at ?? null
}

/** Across cafes: unsent outbox messages per kind and cafe (`outbox_messages_due_idx` by status); sent ones are not read. */
export async function outboxHealth(db: Db): Promise<OutboxHealthRow[]> {
  const rows = await db.select({
    kind: outboxMessages.kind,
    tenantId: outboxMessages.tenantId,
    waiting: sql<number>`sum(case when ${outboxMessages.status} = 'pending' and ${outboxMessages.attempts} = 0 then 1 else 0 end)`.mapWith(Number),
    failing: sql<number>`sum(case when ${outboxMessages.status} = 'pending' and ${outboxMessages.attempts} > 0 then 1 else 0 end)`.mapWith(Number),
    dead: sql<number>`sum(case when ${outboxMessages.status} = 'failed' then 1 else 0 end)`.mapWith(Number),
    oldestAt: min(outboxMessages.createdAt),
  }).from(outboxMessages)
    .where(inArray(outboxMessages.status, ['pending', 'failed']))
    .groupBy(outboxMessages.kind, outboxMessages.tenantId)
  return rows
}

/** Across cafes: the newest messages of these kinds, sent or not (`outbox_messages_expiry_idx`); the dev mail task's (D209). */
export async function recentMessages(db: Db, kinds: string[], limit: number): Promise<{ kind: string, payload: Record<string, unknown>, status: string, createdAt: Date }[]> {
  return db.select({ kind: outboxMessages.kind, payload: outboxMessages.payload, status: outboxMessages.status, createdAt: outboxMessages.createdAt })
    .from(outboxMessages)
    .where(inArray(outboxMessages.kind, kinds))
    .orderBy(desc(outboxMessages.createdAt))
    .limit(limit)
}

// --- Write statements ---

export function insertOutboxStatement(db: Db, tenantId: string | null, kind: string, payload: Record<string, unknown>): Statement {
  return db.insert(outboxMessages).values({ id: newId(), tenantId, kind, payload })
}

// --- Background-task writes ---

/**
 * Across cafes: takes a message for this run until `until`, counting the attempt. `undefined` when another run got
 * it first: the conditional update changed no row.
 */
export async function claimMessage(db: Db, id: string, until: Date, now: Date): Promise<WorkClaim | undefined> {
  const claim = claimAttempt(outboxMessages)
  const [row] = await db.update(outboxMessages)
    .set({ ...claim, lockedUntil: until })
    .where(and(
      eq(outboxMessages.id, id),
      pendingWork(outboxMessages, now),
      unclaimed(now),
    ))
    .returning({ attempts: outboxMessages.attempts })
  return row ? { claimToken: claim.claimToken, attempts: row.attempts } : undefined
}

/** Across cafes: settles only the exact pending claim, including global work. */
export async function markSent(db: Db, id: string, token: string, now: Date): Promise<boolean> {
  // Drop one-time links once sent; an expired worker must not clear another claim's payload.
  const rows = await db.update(outboxMessages).set({ status: 'sent', sentAt: now, lockedUntil: null, claimToken: null, lastError: null, payload: {} }).where(ownsClaim(id, token)).returning({ id: outboxMessages.id })
  return rows.length === 1
}

/** Across cafes: retries only the exact pending claim, including global work. */
export async function markRetry(db: Db, id: string, token: string, nextAttemptAt: Date, error: string): Promise<boolean> {
  const rows = await db.update(outboxMessages).set({ nextAttemptAt, lockedUntil: null, claimToken: null, lastError: error }).where(ownsClaim(id, token)).returning({ id: outboxMessages.id })
  return rows.length === 1
}

/** Across cafes: fails only the exact pending claim, including global work. */
export async function markFailed(db: Db, id: string, token: string, error: string): Promise<boolean> {
  const rows = await db.update(outboxMessages).set({ status: 'failed', lockedUntil: null, claimToken: null, lastError: error }).where(ownsClaim(id, token)).returning({ id: outboxMessages.id })
  return rows.length === 1
}

/** Across cafes: expired one-time email links have no reason to remain in failed/pending payloads. */
export async function redactExpiredMail(db: Db, now: Date, limit: number): Promise<number> {
  const expired = or(
    and(
      eq(outboxMessages.kind, 'identity.reset-password'),
      lt(outboxMessages.createdAt, new Date(now.getTime() - 3600_000)),
    ),
    and(
      eq(outboxMessages.kind, 'identity.verify-email'),
      lt(outboxMessages.createdAt, new Date(now.getTime() - 86400_000)),
    ),
  )
  const ids = db.select({ id: outboxMessages.id }).from(outboxMessages)
    .where(and(
      expired,
      sql`${outboxMessages.payload} <> '{}'`,
      unclaimed(now),
    )).orderBy(asc(outboxMessages.createdAt), asc(outboxMessages.id)).limit(limit)
  const rows = await db.update(outboxMessages).set({ payload: {}, status: 'failed', lastError: 'The account link expired before delivery completed.', claimToken: null, lockedUntil: null })
    .where(inArray(outboxMessages.id, ids)).returning({ id: outboxMessages.id })
  return rows.length
}

/** Across cafes: opt-in metadata retention. Never touches financial history, audit, pending or failed work. */
export async function deleteSentOutboxBefore(db: Db, before: Date, limit: number): Promise<number> {
  return deleteOldest(db, outboxMessages, outboxMessages.id, and(eq(outboxMessages.status, 'sent'), lt(outboxMessages.sentAt, before))!, [asc(outboxMessages.sentAt), asc(outboxMessages.id)], limit)
}
