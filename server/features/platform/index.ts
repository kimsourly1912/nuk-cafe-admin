export { auditStatement, deliverOutbox, expireIdempotencyKeys, outboxStatement, withIdempotency } from './platform.service'
export { idempotencyKeyRequired } from './platform.errors'
export { OUTBOX_MAX_ATTEMPTS, retryDelayMs } from './platform.rules'
export type { AuditActor, AuditEntry, DeliveryReport, IdempotencyScope, IdempotentWork, OutboxHandler } from './platform.types'
