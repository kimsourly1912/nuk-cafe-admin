import { user } from '#auth/schema'
import { sql } from 'drizzle-orm'
import { check, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAt, updatedAt } from '../columns'

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
