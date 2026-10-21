import { and, asc, count, eq, lt } from 'drizzle-orm'
import type { AiProvider, AssistantFeature, AssistantOutcome } from '#shared/contracts/assistant'
import type { Db, Statement } from '#server/utils/batch'
import { deleteOldest, requireAtMost } from '#server/utils/batch'
import { byId, inTenant } from '#server/utils/query'
import { assistantUsage } from './assistant.schema'

// --- Row types ---

export interface NewUsage {
  id: string
  tenantId: string
  userId: string
  day: string
  feature: AssistantFeature
  provider: AiProvider
  model: string
  at: Date
}

export interface UsageResult {
  outcome: Exclude<AssistantOutcome, 'pending'>
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
}

// --- Columns and conditions ---

const usageOnDay = (tenantId: string, userId: string, day: string) => inTenant(assistantUsage, tenantId, eq(assistantUsage.userId, userId), eq(assistantUsage.day, day))

// --- Reads ---

/** The user's requests in a cafe on a local day (every outcome counts against the limit). */
export async function countUsage(db: Db, tenantId: string, userId: string, day: string): Promise<number> {
  const [row] = await db.select({ count: count() }).from(assistantUsage).where(usageOnDay(tenantId, userId, day))
  return row?.count ?? 0
}

// --- Write statements ---

/**
 * The request's usage row and a guard after it: the user's rows that day in this cafe, this one
 * included, at most `limit`. Two requests racing for the last slot can't both pass (SQLite runs one batch at a
 * time; the guard sees the other's row).
 */
export function reserveUsageStatements(db: Db, usage: NewUsage, limit: number): Statement[] {
  return [
    db.insert(assistantUsage).values({ ...usage, outcome: 'pending' }),
    requireAtMost(db, db.$count(assistantUsage, usageOnDay(usage.tenantId, usage.userId, usage.day)), limit),
  ]
}

/** Fills in how a pending request ended. */
export function finishUsageStatement(db: Db, tenantId: string, id: string, result: UsageResult): Statement {
  return db.update(assistantUsage).set(result).where(and(byId(assistantUsage, tenantId, id), eq(assistantUsage.outcome, 'pending')))
}

// --- Background-task writes ---

/** Across cafes: bounded retention of usage metadata, using assistant_usage_at_idx. */
export async function deleteUsageBefore(db: Db, cutoff: Date, limit: number): Promise<number> {
  return deleteOldest(db, assistantUsage, assistantUsage.id, lt(assistantUsage.at, cutoff), [asc(assistantUsage.at), asc(assistantUsage.id)], limit)
}
