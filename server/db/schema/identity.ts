import { user } from '#auth/schema'
import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAt, id, timestamp, updatedAt } from '../columns'

export const STAFF_ROLES = ['admin'] as const
export const STAFF_STATUSES = ['active', 'disabled'] as const

/**
 * A Better Auth user who works at the cafe. Having a login is not staff access: customers sign
 * up through the same auth routes, so access comes only from an active row here (D40).
 * One role per person for now; branch assignments come with a second branch.
 */
export const staffProfiles = sqliteTable('staff_profiles', {
  userId: text().primaryKey().references(() => user.id, { onDelete: 'restrict' }),
  displayName: text().notNull(),
  role: text({ enum: STAFF_ROLES }).notNull(),
  status: text({ enum: STAFF_STATUSES }).notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  check('staff_profiles_role_check', sql`${t.role} in ('admin')`),
  check('staff_profiles_status_check', sql`${t.status} in ('active', 'disabled')`),
])

/**
 * Append-only record of privileged changes. The actor is kept as plain text, not a foreign key,
 * so history survives if an account is removed. Metadata is JSON and must never hold secrets.
 */
export const auditEvents = sqliteTable('audit_events', {
  id: id(),
  actorUserId: text(),
  action: text().notNull(),
  targetType: text().notNull(),
  targetId: text(),
  metadata: text({ mode: 'json' }).$type<Record<string, unknown>>(),
  occurredAt: timestamp().notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
}, t => [
  index('audit_events_target_idx').on(t.targetType, t.targetId),
  index('audit_events_occurred_at_idx').on(t.occurredAt),
])
