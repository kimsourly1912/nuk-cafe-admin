import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { newId } from '#server/utils/ids'
import { tenantId } from '#server/features/branches/branches.schema'

/**
 * Uploaded files (docs/server/data-model.md → Media, D57). The bytes live in R2 (NuxtHub blob);
 * this row is what the database knows about them. Registered with NuxtHub through the
 * `hub:db:schema:extend` hook; column names are snake_case in SQL.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })

export const MEDIA_STATES = ['temporary', 'attached'] as const

/**
 * An upload is `temporary` until a record references it (`attached`); releasing it (the record
 * dropped or replaced it) makes it temporary again. Temporary assets whose state is older than
 * 24 hours are deleted, row and object, by `media:purge-temporary`.
 */
export const mediaAssets = sqliteTable('media_assets', {
  id: text().primaryKey().$defaultFn(() => newId()),
  // The tenant that uploaded it (D136); its object key starts with `t/<tenantId>/` since then.
  tenantId: tenantId(),
  objectKey: text().notNull().unique(),
  mimeType: text().notNull(),
  byteSize: integer().notNull(),
  /** Hex SHA-256 of the bytes, for integrity checks and spotting duplicates later. */
  sha256: text().notNull(),
  state: text({ enum: MEDIA_STATES }).notNull().default('temporary'),
  uploadedBy: text(),
  createdAt: instant().notNull().default(nowMs),
  /** When `state` last changed: the 24 hours of a temporary asset count from here. */
  stateChangedAt: instant().notNull().default(nowMs),
}, t => [
  check('media_assets_state_check', sql`${t.state} in ('temporary', 'attached')`),
  check('media_assets_size_check', sql`${t.byteSize} > 0`),
  index('media_assets_purge_idx').on(t.state, t.stateChangedAt),
  index('media_assets_tenant_idx').on(t.tenantId, t.createdAt),
])
