import { sql } from 'drizzle-orm'
import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { tenantId } from '#server/features/branches/branches.schema'

/**
 * The sample menu load (D94): at most one row per tenant (`id = 'menu'`, D139), from the first
 * step until a reset.
 * It remembers the size of an unfinished load, so "Continue loading" isn't refused because the menu
 * already has the records it created, and `lockedUntil` keeps two loads (two tabs, two admins) from
 * running steps at the same time. Registered through the `hub:db:schema:extend` hook.
 */

const instant = () => integer({ mode: 'timestamp_ms' })

export const SAMPLE_MENU_RUN_ID = 'menu'

export const sampleDataRuns = sqliteTable('sample_data_runs', {
  tenantId: tenantId(),
  id: text().notNull(),
  size: text({ enum: ['small', 'standard', 'large'] }).notNull(),
  startedBy: text().notNull(),
  startedAt: instant().notNull(),
  /** Set once every record exists. */
  finishedAt: instant(),
  /** While a step runs; a step that died frees it when this passes. */
  lockedUntil: instant(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  check('sample_data_runs_size_check', sql`${t.size} in ('small', 'standard', 'large')`),
])
