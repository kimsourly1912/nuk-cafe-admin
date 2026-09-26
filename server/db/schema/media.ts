import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAt, id } from '../columns'

export const MEDIA_STATES = ['temporary', 'attached'] as const

/**
 * Metadata of a file stored in R2 (blob). An upload starts `temporary` and becomes `attached`
 * when a record references it; the bytes never go into the database.
 */
export const mediaAssets = sqliteTable('media_assets', {
  id: id(),
  objectKey: text().notNull().unique(),
  mimeType: text().notNull(),
  byteSize: integer().notNull(),
  state: text({ enum: MEDIA_STATES }).notNull().default('temporary'),
  uploadedBy: text(),
  createdAt: createdAt(),
}, t => [
  check('media_assets_state_check', sql`${t.state} in ('temporary', 'attached')`),
  check('media_assets_size_check', sql`${t.byteSize} > 0`),
  index('media_assets_state_idx').on(t.state, t.createdAt),
])
