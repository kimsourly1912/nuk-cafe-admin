import { user } from '#auth/schema'
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * One profile per account (docs/server/data-model.md → Customers & loyalty, D51). Every account
 * is a customer, staff included: the same person can order and earn points (D45). Created with the
 * account (Better Auth's sign-up hook, or staff creation), and again on first use if that failed.
 */
export const customerProfiles = sqliteTable('customer_profiles', {
  userId: text().primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  /** Shown as text and a QR code at the counter, e.g. `7K2M-QX9P`. */
  memberCode: text().notNull(),
  phone: text(),
  marketingOptIn: integer({ mode: 'boolean' }).notNull().default(false),
  anonymizedAt: integer({ mode: 'timestamp_ms' }),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
}, t => [
  uniqueIndex('customer_profiles_member_code_idx').on(t.memberCode),
])
