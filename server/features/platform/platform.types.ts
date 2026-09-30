import type { Statement } from '#server/utils/batch'

/** Who changed something, as the audit trail records it (usually the access helpers' actor). */
export interface AuditActor {
  /** `null`: the system (seed task, scheduled jobs). */
  userId: string | null
  requestId?: string
}

export interface AuditEntry {
  /** `<feature>.<target>.<verb>`, e.g. `staff.access.update`, `menu.item.update`. */
  action: string
  targetType: string
  targetId?: string | null
  branchId?: string | null
  /** Field names changed, ids, counts: never secrets or full personal data. */
  metadata?: Record<string, unknown>
}

/** An idempotent action's scope: one key per actor and operation. */
export interface IdempotencyScope {
  actorId: string
  /** e.g. `orders.place`, `loyalty.exchange`. */
  operation: string
  /** The client's `Idempotency-Key` (a UUID per user action). */
  key: string
}

/** What an idempotent action produces: the statements to commit and the result to return. */
export interface IdempotentWork<T> {
  statements: Statement[]
  response: T
}

/** Delivers one outbox message. Throwing schedules a retry. Must tolerate a repeat (at-least-once). */
export type OutboxHandler = (message: { id: string, kind: string, payload: Record<string, unknown>, attempt: number }) => Promise<void>

export interface DeliveryReport {
  sent: number
  retried: number
  failed: number
  skipped: number
}
