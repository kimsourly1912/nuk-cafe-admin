import { sql } from 'drizzle-orm'
import { foreignKey, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { tenantId } from '#server/features/branches/branches.schema'
import { newId } from '#server/utils/ids'

/**
 * Support access (step P5, D193): a cafe's owner allows the platform team to look at the cafe, for
 * 24 hours, read-only; a super admin then opens a visit with a fresh two-step code. Nothing here is
 * deleted: grants and visits are the cafe's record of who looked and when.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })

/** An owner's permission for the platform team to look at the cafe, until `expiresAt` or `endedAt`. */
export const supportGrants = sqliteTable('support_grants', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  /** The owner who allowed it (plain text, as the audit's actor). */
  grantedBy: text().notNull(),
  grantedAt: instant().notNull().default(nowMs),
  expiresAt: instant().notNull(),
  endedAt: instant(),
  endedBy: text(),
}, t => [
  unique('support_grants_tenant_id_unique').on(t.tenantId, t.id),
  index('support_grants_tenant_idx').on(t.tenantId, t.grantedAt),
])

/**
 * A super admin's visit under a grant: bound to the Better Auth session that opened it (another
 * device or a new sign-in needs a new code), and shorter than the grant.
 */
export const supportVisits = sqliteTable('support_visits', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  grantId: text().notNull(),
  /** The super admin (plain text, as the audit's actor). */
  userId: text().notNull(),
  sessionId: text().notNull(),
  openedAt: instant().notNull().default(nowMs),
  expiresAt: instant().notNull(),
  closedAt: instant(),
}, t => [
  foreignKey({ name: 'support_visits_grant_fk', columns: [t.tenantId, t.grantId], foreignColumns: [supportGrants.tenantId, supportGrants.id] }).onDelete('restrict'),
  index('support_visits_session_idx').on(t.sessionId, t.tenantId),
  index('support_visits_grant_idx').on(t.grantId),
])
