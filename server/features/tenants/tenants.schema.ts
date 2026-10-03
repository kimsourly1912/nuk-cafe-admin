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
