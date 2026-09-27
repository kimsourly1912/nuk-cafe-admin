import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Db, Statement } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { auditEvents, idempotencyKeys, outboxMessages } from './platform.schema'
import type { AuditActor, AuditEntry, IdempotencyScope } from './platform.types'

// --- Audit ---

export function insertAuditStatement(db: Db, actor: AuditActor, entry: AuditEntry): Statement {
  return db.insert(auditEvents).values({
    id: newId(),
    actorId: actor.userId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    branchId: entry.branchId ?? null,
    metadata: entry.metadata ?? null,
    requestId: actor.requestId ?? null,
  })
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
    .where(and(eq(idempotencyKeys.actorId, scope.actorId), eq(idempotencyKeys.operation, scope.operation), eq(idempotencyKeys.key, scope.key)))
    .limit(1)
  return rows[0]
}

export function insertIdempotencyKeyStatement(db: Db, scope: IdempotencyScope, requestHash: string, response: unknown, expiresAt: Date): Statement {
  return db.insert(idempotencyKeys).values({ id: newId(), ...scope, requestHash, response, expiresAt })
}

export async function deleteExpiredIdempotencyKeys(db: Db, now: Date): Promise<number> {
  const rows = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now)).returning({ id: idempotencyKeys.id })
  return rows.length
}

// --- Outbox ---

export function insertOutboxStatement(db: Db, kind: string, payload: Record<string, unknown>): Statement {
  return db.insert(outboxMessages).values({ id: newId(), kind, payload })
}

export interface DueMessage {
  id: string
  kind: string
  payload: Record<string, unknown>
  attempts: number
}

const unclaimed = (now: Date) => or(isNull(outboxMessages.lockedUntil), lte(outboxMessages.lockedUntil, now))

/** Pending messages whose time has come and that no run holds, oldest first. */
export async function findDueMessages(db: Db, now: Date, limit: number): Promise<DueMessage[]> {
  return db
    .select({ id: outboxMessages.id, kind: outboxMessages.kind, payload: outboxMessages.payload, attempts: outboxMessages.attempts })
    .from(outboxMessages)
    .where(and(eq(outboxMessages.status, 'pending'), lte(outboxMessages.nextAttemptAt, now), unclaimed(now)))
    .orderBy(asc(outboxMessages.nextAttemptAt), asc(outboxMessages.id))
    .limit(limit)
}

/**
 * Takes a message for this run until `until`, counting the attempt. `false` when another run got
 * it first: the conditional update changed no row.
 */
export async function claimMessage(db: Db, id: string, now: Date, until: Date): Promise<boolean> {
  const rows = await db.update(outboxMessages)
    .set({ lockedUntil: until, attempts: sql`${outboxMessages.attempts} + 1` })
    .where(and(eq(outboxMessages.id, id), eq(outboxMessages.status, 'pending'), unclaimed(now)))
    .returning({ id: outboxMessages.id })
  return rows.length === 1
}

export async function markSent(db: Db, id: string, now: Date) {
  // The payload is dropped once sent: account emails carry one-time links (D51).
  await db.update(outboxMessages).set({ status: 'sent', sentAt: now, lockedUntil: null, lastError: null, payload: {} }).where(eq(outboxMessages.id, id))
}

export async function markRetry(db: Db, id: string, nextAttemptAt: Date, error: string) {
  await db.update(outboxMessages).set({ nextAttemptAt, lockedUntil: null, lastError: error }).where(eq(outboxMessages.id, id))
}

export async function markFailed(db: Db, id: string, error: string) {
  await db.update(outboxMessages).set({ status: 'failed', lockedUntil: null, lastError: error }).where(eq(outboxMessages.id, id))
}
