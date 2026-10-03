import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { AI_PROVIDERS, ASSISTANT_FEATURES, ASSISTANT_OUTCOMES } from '#shared/contracts/assistant'
import { tenantId } from '#server/features/branches/branches.schema'
import { newId } from '#server/utils/ids'

/**
 * The assistant's usage (step 9.0, D108): one row per request to the AI provider, for the daily
 * limit per admin and cost reports. Metadata only: **never the question or the answer** (owner,
 * 2026-09-30). Registered with NuxtHub through the `hub:db:schema:extend` hook.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })

export const assistantUsage = sqliteTable('assistant_usage', {
  id: text().primaryKey().$defaultFn(() => newId()),
  /** The cafe the request was made in: the daily limit counts per admin and cafe (D139). */
  tenantId: tenantId(),
  // Usage is the admin's own data: it goes when the account does.
  userId: text().notNull().references(() => authSchema!.user.id, { onDelete: 'cascade' }),
  /** The local day (`YYYY-MM-DD`, Asia/Phnom_Penh) the request counts in. */
  day: text().notNull(),
  feature: text({ enum: ASSISTANT_FEATURES }).notNull(),
  provider: text({ enum: AI_PROVIDERS }).notNull(),
  model: text().notNull(),
  /** Filled in when the provider answers; `null` while pending, or when a provider doesn't say. */
  inputTokens: integer(),
  outputTokens: integer(),
  cachedInputTokens: integer(),
  outcome: text({ enum: ASSISTANT_OUTCOMES }).notNull().default('pending'),
  at: instant().notNull().default(nowMs),
}, t => [
  check('assistant_usage_feature_check', sql`${t.feature} in ('ping', 'chat', 'menu_item_draft', 'rewrite')`),
  check('assistant_usage_provider_check', sql`${t.provider} in ('anthropic', 'openai', 'google', 'openai-compatible')`),
  check('assistant_usage_outcome_check', sql`${t.outcome} in ('pending', 'ok', 'error')`),
  index('assistant_usage_user_day_idx').on(t.tenantId, t.userId, t.day),
  index('assistant_usage_at_idx').on(t.at),
])
