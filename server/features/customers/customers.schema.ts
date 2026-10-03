import { user } from '#auth/schema'
import { sql } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { tenantId } from '#server/features/branches/branches.schema'

/**
 * One profile per account **and tenant** (docs/server/data-model.md → Customers & loyalty, D51,
 * D137): the account is the platform's, the member code, phone and marketing choice are each cafe's.
 * Every account is a customer, staff included: the same person can order and earn points (D45).
 * Created with the account (Better Auth's sign-up hook, or staff creation), and in a cafe on first
 * use there.
 */
export const customerProfiles = sqliteTable('customer_profiles', {
  tenantId: tenantId(),
  userId: text().notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Shown as text and a QR code at the counter, e.g. `7K2M-QX9P`. */
  memberCode: text().notNull(),
  phone: text(),
  marketingOptIn: integer({ mode: 'boolean' }).notNull().default(false),
  anonymizedAt: integer({ mode: 'timestamp_ms' }),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
}, t => [
  primaryKey({ columns: [t.tenantId, t.userId] }),
  // Member codes are unique within a cafe: the counter looks them up there.
  uniqueIndex('customer_profiles_member_code_idx').on(t.tenantId, t.memberCode),
])
