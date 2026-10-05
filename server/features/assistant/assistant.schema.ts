import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { AI_PROVIDERS, ASSISTANT_FEATURES, ASSISTANT_OUTCOMES } from '#shared/contracts/assistant'
import { ASSISTANT_IMPORT_FAILURES, ASSISTANT_IMPORT_REVIEW_STATES, ASSISTANT_IMPORT_TYPES } from '#shared/contracts/assistant-import'
import type { AssistantImportReviewRow } from '#shared/contracts/assistant-import'
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
  check('assistant_usage_feature_check', sql`${t.feature} in ('ping', 'chat', 'menu_item_draft', 'rewrite', 'menu_import')`),
  check('assistant_usage_provider_check', sql`${t.provider} in ('anthropic', 'openai', 'google', 'openai-compatible', 'cloudflare')`),
  check('assistant_usage_outcome_check', sql`${t.outcome} in ('pending', 'ok', 'error')`),
  index('assistant_usage_user_day_idx').on(t.tenantId, t.userId, t.day),
  index('assistant_usage_at_idx').on(t.at),
])

/** Private, creator-owned source sessions; content/review data is never usage/audit metadata. */
export const assistantImports = sqliteTable('assistant_imports', {
  id: text().primaryKey(),
  tenantId: tenantId(),
  userId: text().notNull().references(() => authSchema!.user.id, { onDelete: 'cascade' }),
  objectKey: text().notNull().unique(),
  fileName: text().notNull(),
  mimeType: text({ enum: ASSISTANT_IMPORT_TYPES }).notNull(),
  byteSize: integer().notNull(),
  state: text({ enum: ['uploading', 'uploaded'] }).notNull().default('uploading'),
  reviewState: text({ enum: ASSISTANT_IMPORT_REVIEW_STATES }).notNull().default('none'),
  extractionId: text(),
  extractionDeadline: instant(),
  extractionError: text({ enum: ASSISTANT_IMPORT_FAILURES }),
  /** Private review/evidence, erased with the source. Never put this JSON in logs or audits. */
  reviewRows: text({ mode: 'json' }).$type<AssistantImportReviewRow[]>(),
  version: integer().notNull().default(1),
  createdAt: instant().notNull(),
  expiresAt: instant().notNull(),
}, t => [
  check('assistant_imports_type_check', sql`${t.mimeType} in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')`),
  check('assistant_imports_size_check', sql`${t.byteSize} > 0 and ${t.byteSize} <= 5242880`),
  check('assistant_imports_state_check', sql`${t.state} in ('uploading', 'uploaded')`),
  check('assistant_imports_version_check', sql`${t.version} >= 1`),
  check('assistant_imports_review_state_check', sql`${t.reviewState} in ('none', 'processing', 'ready', 'failed')`),
  index('assistant_imports_owner_idx').on(t.tenantId, t.userId, t.expiresAt),
  index('assistant_imports_processing_idx').on(t.tenantId, t.userId, t.reviewState, t.extractionDeadline),
])

/**
 * Operational object-deletion ledger, not a tenant content table. Deliberately no identity FK:
 * its server-generated key must survive cascades until R2 confirms byte deletion (D152).
 * Contains no filename, document body or review; expiresAt never extends after upload.
 */
export const assistantImportObjects = sqliteTable('assistant_import_objects', {
  objectKey: text().primaryKey(),
  createdAt: instant().notNull(),
  expiresAt: instant().notNull(),
  deleteRequested: integer({ mode: 'boolean' }).notNull().default(false),
}, t => [
  index('assistant_import_objects_expiry_idx').on(t.expiresAt),
])

/** Short processing leases survive source discard so it cannot unlock a second remote call. */
export const assistantImportLeases = sqliteTable('assistant_import_leases', {
  tenantId: tenantId(),
  userId: text().notNull().references(() => authSchema!.user.id, { onDelete: 'cascade' }),
  extractionId: text().notNull(),
  deadline: instant().notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.userId] })])
