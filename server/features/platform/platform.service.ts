import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation } from '#server/utils/batch'
import { idempotencyMismatch } from './platform.errors'
import * as repo from './platform.repository'
import { describeError, hashRequest, IDEMPOTENCY_TTL_MS, OUTBOX_CLAIM_MS, OUTBOX_MAX_ATTEMPTS, retryDelayMs } from './platform.rules'
import type { AuditActor, AuditEntry, DeliveryReport, IdempotencyScope, IdempotentWork, OutboxHandler } from './platform.types'

/**
 * Cross-cutting write helpers every feature uses (docs/server/architecture.md → Writing data,
 * D50): audit rows and outbox messages as statements for the caller's batch, idempotent actions,
 * and delivery of the outbox.
 */

/** An audit row, to put **in the same batch** as the change it records. */
export function auditStatement(db: Db, actor: AuditActor, entry: AuditEntry): Statement {
  return repo.insertAuditStatement(db, actor, entry)
}

/**
 * A must-not-lose side effect (an email, a notification), to put **in the same batch** as the
 * change that causes it. Delivered after the commit, at least once, by `platform:deliver-outbox`.
 * The payload holds ids and what the handler needs, never secrets it could look up instead.
 */
export function outboxStatement(db: Db, kind: string, payload: Record<string, unknown>): Statement {
  return repo.insertOutboxStatement(db, kind, payload)
}

/**
 * Runs an action at most once per `Idempotency-Key` (architecture.md → Idempotency):
 * - a key seen before with the same request returns the stored response (`replayed: true`) and
 *   runs nothing;
 * - a key seen before with a different request is 422 `IDEMPOTENCY_MISMATCH`;
 * - otherwise `work()` builds the action's statements and response, and the key is stored **in the
 *   same batch**: the action and its key commit together or not at all. Two identical requests at
 *   once: the second batch fails on the key's unique index, changes nothing, and replays the first.
 *
 * `request` is what makes two calls "the same" (usually the validated body plus path ids).
 * `work().response` must be JSON: it's stored and returned as is on a replay.
 */
export async function withIdempotency<T>(
  db: Db,
  scope: IdempotencyScope,
  request: unknown,
  work: () => Promise<IdempotentWork<T>>,
  options: { onStale?: () => Error, now?: Date } = {},
): Promise<{ response: T, replayed: boolean }> {
  const requestHash = await hashRequest(request)
  const replay = async () => {
    const stored = await repo.findIdempotencyKey(db, scope)
    if (!stored) return undefined
    if (stored.requestHash !== requestHash) throw idempotencyMismatch()
    return { response: stored.response as T, replayed: true }
  }

  const earlier = await replay()
  if (earlier) return earlier

  const { statements, response } = await work()
  const expiresAt = new Date((options.now ?? new Date()).getTime() + IDEMPOTENCY_TTL_MS)
  try {
    // One atomic batch: the key and the action commit together or not at all.
    await db.batch([repo.insertIdempotencyKeyStatement(db, scope, requestHash, response, expiresAt), ...statements])
  }
  catch (error) {
    if (isUniqueViolation(error)) {
      const concurrent = await replay()
      if (concurrent) return concurrent
    }
    if (options.onStale && isStaleWrite(error)) throw options.onStale()
    throw error
  }
  return { response, replayed: false }
}

/** Removes keys past their 24 hours. Returns how many. */
export async function expireIdempotencyKeys(db: Db, now = new Date()): Promise<number> {
  return repo.deleteExpiredIdempotencyKeys(db, now)
}

/**
 * Delivers due outbox messages. Each is claimed first (a conditional update), so overlapping runs
 * never send it at once. Success marks it `sent`; a failure (or no handler for its kind) retries
 * with backoff (1, 2, 4 … minutes, at most 6 h) and, after `OUTBOX_MAX_ATTEMPTS`, marks it
 * `failed`. A run that dies mid-send leaves the claim to expire, and the message is sent again:
 * delivery is **at least once**, so handlers must tolerate a repeat (e.g. pass the message id as
 * the mail provider's idempotency key).
 */
export async function deliverOutbox(
  db: Db,
  handlers: Record<string, OutboxHandler>,
  options: { now?: Date, limit?: number } = {},
): Promise<DeliveryReport & { failures: { id: string, kind: string, attempt: number, error: string, final: boolean }[] }> {
  const now = options.now ?? new Date()
  const report = { sent: 0, retried: 0, failed: 0, skipped: 0, failures: [] as { id: string, kind: string, attempt: number, error: string, final: boolean }[] }

  for (const message of await repo.findDueMessages(db, now, options.limit ?? 25)) {
    if (!await repo.claimMessage(db, message.id, now, new Date(now.getTime() + OUTBOX_CLAIM_MS))) {
      report.skipped++
      continue
    }
    const attempt = message.attempts + 1
    try {
      const handler = handlers[message.kind]
      if (!handler) throw new Error(`No handler for outbox messages of kind "${message.kind}"`)
      await handler({ id: message.id, kind: message.kind, payload: message.payload, attempt })
      await repo.markSent(db, message.id, new Date())
      report.sent++
    }
    catch (error) {
      const text = describeError(error)
      const final = attempt >= OUTBOX_MAX_ATTEMPTS
      if (final) {
        await repo.markFailed(db, message.id, text)
        report.failed++
      }
      else {
        await repo.markRetry(db, message.id, new Date(now.getTime() + retryDelayMs(attempt)), text)
        report.retried++
      }
      report.failures.push({ id: message.id, kind: message.kind, attempt, error: text, final })
    }
  }
  return report
}
