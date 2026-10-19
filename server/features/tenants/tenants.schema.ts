import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'

/**
 * The platform console's own table (D142). A cafe (tenant) is Better Auth's `organization`
 * (D134); this keeps every web address a cafe has ever had, the current one included, so an
 * address is never given to a second cafe and an old one keeps redirecting to its cafe's current
 * address (printed menus, bookmarks, Telegram messages already sent).
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

export const tenantSlugs = sqliteTable('tenant_slugs', {
  slug: text().primaryKey(),
  tenantId: text().notNull().references(() => authSchema!.organization.id, { onDelete: 'restrict' }),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull().default(nowMs),
}, t => [
  index('tenant_slugs_tenant_idx').on(t.tenantId),
])

/**
 * The platform team's internal notes about a cafe (step P2, D189): a contact person, a phone and
 * free text. Platform-only: not on `organization`, whose fields Better Auth's organization
 * endpoints answer to the cafe's members. One row per cafe, made at the first save, versioned on
 * its own (a pause doesn't conflict with a note).
 */
export const tenantNotes = sqliteTable('tenant_notes', {
  tenantId: text().primaryKey().references(() => authSchema!.organization.id, { onDelete: 'restrict' }),
  contactName: text(),
  /** E.164. */
  contactPhone: text(),
  notes: text(),
  version: integer().notNull().default(1),
  updatedAt: integer({ mode: 'timestamp_ms' }).notNull().default(nowMs),
  /** The super admin who saved last (plain text, as the audit's actor). */
  updatedBy: text(),
})
