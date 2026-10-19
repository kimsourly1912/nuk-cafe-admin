import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { auditEvents, idempotencyKeys, jobCursors, jobRuns, outboxMessages } from './platform.schema'
import type { AuditActor, AuditEntry, AuditFilter, AuditRow, IdempotencyScope, OutboxTarget } from './platform.types'

// --- Audit ---

export function insertAuditStatement(db: Db, actor: AuditActor, entry: AuditEntry): Statement {
  return db.insert(auditEvents).values({
    id: newId(),
    tenantId: actor.tenantId,
    actorId: actor.userId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    branchId: entry.branchId ?? null,
    metadata: entry.metadata ?? null,
    requestId: actor.requestId ?? null,
  })
}

/**
 * Audit rows with one of `actions`, newest first, a page at a time (the platform console's Activity,
 * D191). The action list is the boundary: a cafe's own rows never match it. Served by
 * `audit_events_at_idx`, `audit_events_tenant_idx` (a cafe) and `audit_events_actor_idx` (an actor).
 */
export async function listAuditEvents(db: Db, filter: AuditFilter): Promise<{ rows: AuditRow[], total: number }> {
  const where = and(
    inArray(auditEvents.action, filter.actions),
    filter.actorId ? eq(auditEvents.actorId, filter.actorId) : undefined,
    filter.tenantId ? eq(auditEvents.tenantId, filter.tenantId) : undefined,
    filter.since ? gte(auditEvents.at, filter.since) : undefined,
    filter.before ? lt(auditEvents.at, filter.before) : undefined,
  )
  const [totals, rows] = await Promise.all([
    db.select({ total: count() }).from(auditEvents).where(where) as Promise<{ total: number }[]>,
    db.select({
      id: auditEvents.id,
      at: auditEvents.at,
      tenantId: auditEvents.tenantId,
      actorId: auditEvents.actorId,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      metadata: auditEvents.metadata,
    }).from(auditEvents).where(where)
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(filter.limit).offset(filter.offset) as Promise<AuditRow[]>,
  ])
  return { rows, total: totals[0]?.total ?? 0 }
}

// --- Idempotency ---

export interface StoredIdempotencyKey {
  requestHash: string
  response: unknown
}

/** The stored key, expired or not: a key counts until the expiry task removes it. */
export async function findIdempotencyKey(db: Db, scope: IdempotencyScope): Promise<StoredIdempotencyKey | undefined> {
  const rows: StoredIdempotencyKey[] = await db
    .select({ requestHash: idempotencyKeys.requestHash, response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.tenantId, scope.tenantId), eq(idempotencyKeys.actorId, scope.actorId), eq(idempotencyKeys.operation, scope.operation), eq(idempotencyKeys.key, scope.key)))
    .limit(1)
  return rows[0]
}

export function insertIdempotencyKeyStatement(db: Db, scope: IdempotencyScope, requestHash: string, response: unknown, expiresAt: Date): Statement {
  return db.insert(idempotencyKeys).values({ id: newId(), ...scope, requestHash, response, expiresAt })
}

export async function deleteExpiredIdempotencyKeys(db: Db, now: Date, limit = 500): Promise<number> {
  const rows = await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.id, db.select({ id: idempotencyKeys.id }).from(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now)).orderBy(asc(idempotencyKeys.expiresAt)).limit(limit))).returning({ id: idempotencyKeys.id })
  return rows.length
}

// --- Outbox ---

export function insertOutboxStatement(db: Db, tenantId: string | null, kind: string, payload: Record<string, unknown>): Statement {
  return db.insert(outboxMessages).values({ id: newId(), tenantId, kind, payload })
}

export interface DueMessage {
  id: string
  tenantId: string | null
  kind: string
  payload: Record<string, unknown>
  attempts: number
}

const unclaimed = (now: Date) => or(isNull(outboxMessages.lockedUntil), lte(outboxMessages.lockedUntil, now))

/** Pending messages whose time has come and that no run holds, oldest first. */
export async function findDueMessages(db: Db, now: Date, limit: number, target: OutboxTarget = {}): Promise<DueMessage[]> {
  return db
    .select({ id: outboxMessages.id, tenantId: outboxMessages.tenantId, kind: outboxMessages.kind, payload: outboxMessages.payload, attempts: outboxMessages.attempts })
    .from(outboxMessages)
    .where(and(eq(outboxMessages.status, 'pending'), lte(outboxMessages.nextAttemptAt, now), unclaimed(now), target.kinds ? inArray(outboxMessages.kind, target.kinds) : undefined, target.ids ? inArray(outboxMessages.id, target.ids) : undefined, target.order ? and(eq(outboxMessages.tenantId, target.order.tenantId), sql`json_extract(${outboxMessages.payload}, '$.orderId') = ${target.order.orderId}`) : undefined))
    .orderBy(asc(outboxMessages.nextAttemptAt), asc(outboxMessages.id))
    .limit(limit)
}

/**
 * Takes a message for this run until `until`, counting the attempt. `false` when another run got
 * it first: the conditional update changed no row.
 */
export async function claimMessage(db: Db, id: string, now: Date, until: Date): Promise<{ token: string, attempt: number } | undefined> {
  const token = newId()
  const [row] = await db.update(outboxMessages)
    .set({ claimToken: token, lockedUntil: until, attempts: sql`${outboxMessages.attempts} + 1` })
    .where(and(eq(outboxMessages.id, id), eq(outboxMessages.status, 'pending'), lte(outboxMessages.nextAttemptAt, now), unclaimed(now)))
    .returning({ attempt: outboxMessages.attempts })
  return row ? { token, attempt: row.attempt } : undefined
}

const ownsClaim = (id: string, token: string) => and(eq(outboxMessages.id, id), eq(outboxMessages.status, 'pending'), eq(outboxMessages.claimToken, token))

export async function markSent(db: Db, id: string, token: string, now: Date): Promise<boolean> {
  // Drop one-time links once sent; an expired worker must not clear another claim's payload.
  const rows = await db.update(outboxMessages).set({ status: 'sent', sentAt: now, lockedUntil: null, claimToken: null, lastError: null, payload: {} }).where(ownsClaim(id, token)).returning({ id: outboxMessages.id })
  return rows.length === 1
}

export async function markRetry(db: Db, id: string, token: string, nextAttemptAt: Date, error: string): Promise<boolean> {
  const rows = await db.update(outboxMessages).set({ nextAttemptAt, lockedUntil: null, claimToken: null, lastError: error }).where(ownsClaim(id, token)).returning({ id: outboxMessages.id })
  return rows.length === 1
}

export async function markFailed(db: Db, id: string, token: string, error: string): Promise<boolean> {
  const rows = await db.update(outboxMessages).set({ status: 'failed', lockedUntil: null, claimToken: null, lastError: error }).where(ownsClaim(id, token)).returning({ id: outboxMessages.id })
  return rows.length === 1
}

export async function readJobCursor(db: Db, job: string): Promise<string | null> {
  const [row] = await db.select({ cursor: jobCursors.cursor }).from(jobCursors).where(eq(jobCursors.job, job))
  return row?.cursor ?? null
}

export async function saveJobCursor(db: Db, job: string, cursor: string | null, result: { processed?: number, failures?: number, now?: Date } = {}) {
  const now = result.now ?? new Date()
  const processed = result.processed ?? 0
  const failures = result.failures ?? 0
  const succeededAt = failures === 0 || processed > failures ? now : null
  await db.insert(jobCursors).values({ job, cursor, updatedAt: now, succeededAt, processed, failures }).onConflictDoUpdate({
    target: jobCursors.job,
    set: { cursor, updatedAt: now, succeededAt: succeededAt ?? jobCursors.succeededAt, processed, failures },
  })
}

/** Expired one-time email links have no reason to remain in failed/pending payloads. */
export async function redactExpiredMail(db: Db, now: Date, limit: number): Promise<number> {
  const expired = or(
    and(eq(outboxMessages.kind, 'identity.reset-password'), lt(outboxMessages.createdAt, new Date(now.getTime() - 3600_000))),
    and(eq(outboxMessages.kind, 'identity.verify-email'), lt(outboxMessages.createdAt, new Date(now.getTime() - 86400_000))),
  )
  const ids = db.select({ id: outboxMessages.id }).from(outboxMessages)
    .where(and(expired, sql`${outboxMessages.payload} <> '{}'`, unclaimed(now))).orderBy(asc(outboxMessages.createdAt)).limit(limit)
  const rows = await db.update(outboxMessages).set({ payload: {}, status: 'failed', lastError: 'The account link expired before delivery completed.', claimToken: null, lockedUntil: null })
    .where(inArray(outboxMessages.id, ids)).returning({ id: outboxMessages.id })
  return rows.length
}

/** Opt-in metadata retention. Never touches financial history, audit, pending or failed work. */
export async function deleteSentOutboxBefore(db: Db, before: Date, limit: number): Promise<number> {
  const ids = db.select({ id: outboxMessages.id }).from(outboxMessages)
    .where(and(eq(outboxMessages.status, 'sent'), lt(outboxMessages.sentAt, before))).orderBy(asc(outboxMessages.sentAt)).limit(limit)
  const rows = await db.delete(outboxMessages).where(inArray(outboxMessages.id, ids)).returning({ id: outboxMessages.id })
  return rows.length
}

export async function jobProgress(db: Db, job: string) {
  const [row] = await db.select({ activityAt: jobCursors.updatedAt, succeededAt: jobCursors.succeededAt, processed: jobCursors.processed, failures: jobCursors.failures })
    .from(jobCursors).where(eq(jobCursors.job, job))
  return row
}

/** Age is about overdue work, not intentionally scheduled future retries. */
export async function oldestDueOutbox(db: Db, now: Date): Promise<Date | null> {
  const [row] = await db.select({ at: sql<number | null>`min(${outboxMessages.nextAttemptAt})` }).from(outboxMessages)
    .where(and(eq(outboxMessages.status, 'pending'), lte(outboxMessages.nextAttemptAt, now)))
  return row?.at == null ? null : new Date(row.at)
}

// --- System health (P4, D192): counts and dates, never a payload or an error's text ---

/** A success within this long of the last one isn't written again while nothing failed. */
export const JOB_RUN_SUCCESS_EVERY_MS = 5 * 60_000

/** Records a job's run: a failure always, a success only when the last one is older than the interval or a failure came between. */
export async function recordJobRun(db: Db, job: string, outcome: 'success' | 'failure', now: Date) {
  if (outcome === 'failure') {
    await db.insert(jobRuns).values({ job, lastRunAt: now, lastFailureAt: now, failuresInARow: 1 }).onConflictDoUpdate({
      target: jobRuns.job,
      set: { lastRunAt: now, lastFailureAt: now, failuresInARow: sql`${jobRuns.failuresInARow} + 1` },
    })
    return
  }
  await db.insert(jobRuns).values({ job, lastRunAt: now, lastSuccessAt: now, failuresInARow: 0 }).onConflictDoUpdate({
    target: jobRuns.job,
    set: { lastRunAt: now, lastSuccessAt: now, failuresInARow: 0 },
    setWhere: sql`${jobRuns.failuresInARow} > 0 or ${jobRuns.lastSuccessAt} is null or ${jobRuns.lastSuccessAt} <= ${now.getTime() - JOB_RUN_SUCCESS_EVERY_MS}`,
  })
}

export interface JobRunRow {
  job: string
  lastRunAt: Date
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  failuresInARow: number
}

export async function jobRunRows(db: Db): Promise<JobRunRow[]> {
  return db.select().from(jobRuns)
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

/** Unsent outbox messages per kind and cafe (`outbox_messages_due_idx` by status); sent ones are not read. */
export async function outboxHealth(db: Db): Promise<OutboxHealthRow[]> {
  const rows = await db.select({
    kind: outboxMessages.kind,
    tenantId: outboxMessages.tenantId,
    waiting: sql<number>`sum(case when ${outboxMessages.status} = 'pending' and ${outboxMessages.attempts} = 0 then 1 else 0 end)`.mapWith(Number),
    failing: sql<number>`sum(case when ${outboxMessages.status} = 'pending' and ${outboxMessages.attempts} > 0 then 1 else 0 end)`.mapWith(Number),
    dead: sql<number>`sum(case when ${outboxMessages.status} = 'failed' then 1 else 0 end)`.mapWith(Number),
    oldestAt: sql<number | null>`min(${outboxMessages.createdAt})`,
  }).from(outboxMessages)
    .where(inArray(outboxMessages.status, ['pending', 'failed']))
    .groupBy(outboxMessages.kind, outboxMessages.tenantId)
  return rows.map(row => ({ ...row, oldestAt: row.oldestAt == null ? null : new Date(row.oldestAt) }))
}
