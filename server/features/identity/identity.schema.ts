import { user } from '#auth/schema'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { tenantId } from '#server/features/branches/branches.schema'

/**
 * When a person last opened **this cafe's** admin or counter (account security step 4, D248), for
 * the owner's Staff page. Per cafe on purpose: an account's sign-in is the platform's, and showing
 * it would tell one cafe's owner when the person was active at another cafe. Written by the
 * workspaces' `/me` checks at most once an hour; kept when access changes (the `member` row is
 * replaced then), so it stays "last time here".
 */
export const workspaceVisits = sqliteTable('workspace_visits', {
  tenantId: tenantId(),
  userId: text().notNull().references(() => user.id, { onDelete: 'cascade' }),
  lastActiveAt: integer({ mode: 'timestamp_ms' }).notNull(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.userId] }),
])
