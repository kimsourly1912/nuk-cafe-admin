import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { newId } from '#server/utils/ids'

/**
 * Platform tables (docs/server/data-model.md → Platform, D50): the audit trail, idempotency keys
 * and the outbox. Registered with NuxtHub through the `hub:db:schema:extend` hook (nuxt.config.ts).
 * Column names are snake_case in SQL (NuxtHub's `casing`).
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })
const id = () => text().primaryKey().$defaultFn(() => newId())

/**
 * Append-only record of privileged changes, written in the same batch as the change. The actor
 * is plain text, not a foreign key, so history survives if an account is removed. `metadata` is
 * JSON and never holds secrets or full personal data.
 */
export const auditEvents = sqliteTable('audit_events', {
  id: id(),
  /** `null`: the system (seed task, scheduled jobs). */
  actorId: text(),
  action: text().notNull(),
  targetType: text().notNull(),
  targetId: text(),
  branchId: text(),
  metadata: text({ mode: 'json' }).$type<Record<string, unknown>>(),
  requestId: text(),
  at: instant().notNull().default(nowMs),
}, t => [
  index('audit_events_target_idx').on(t.targetType, t.targetId),
  index('audit_events_at_idx').on(t.at),
  index('audit_events_actor_idx').on(t.actorId, t.at),
])

/**
 * One row per (actor, operation, key): the stored result a retry gets back. Written in the same
 * batch as the action, so the action and its key commit together or not at all.
 */
export const idempotencyKeys = sqliteTable('idempotency_keys', {
  id: id(),
  actorId: text().notNull(),
  operation: text().notNull(),
  key: text().notNull(),
  requestHash: text().notNull(),
  response: text({ mode: 'json' }).$type<unknown>(),
  createdAt: instant().notNull().default(nowMs),
  expiresAt: instant().notNull(),
}, t => [
  uniqueIndex('idempotency_keys_scope_idx').on(t.actorId, t.operation, t.key),
  index('idempotency_keys_expires_at_idx').on(t.expiresAt),
])

export const OUTBOX_STATUSES = ['pending', 'sent', 'failed'] as const
export type OutboxStatus = typeof OUTBOX_STATUSES[number]

/**
 * Must-not-lose side effects (emails, notifications), written in the same batch as the change that
 * causes them and delivered after the commit by `platform:deliver-outbox`, at least once.
 * `lockedUntil` is a delivery claim: two overlapping runs never send the same message at once.
 */
export const outboxMessages = sqliteTable('outbox_messages', {
  id: id(),
  /** The tenant whose change caused it (an order's alert); `null`: the platform's (account emails). D138. */
  tenantId: text().references(() => authSchema!.organization.id, { onDelete: 'restrict' }),
  kind: text().notNull(),
  payload: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text({ enum: OUTBOX_STATUSES }).notNull().default('pending'),
  attempts: integer().notNull().default(0),
  nextAttemptAt: instant().notNull().default(nowMs),
  lockedUntil: instant(),
  lastError: text(),
  createdAt: instant().notNull().default(nowMs),
  sentAt: instant(),
}, t => [
  index('outbox_messages_due_idx').on(t.status, t.nextAttemptAt),
  check('outbox_messages_status_check', sql`${t.status} in ('pending', 'sent', 'failed')`),
])
