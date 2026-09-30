import { and, eq, lt, sql } from 'drizzle-orm'
import type { AiProvider, AssistantFeature, AssistantOutcome } from '#shared/contracts/assistant'
import type { Db, Statement } from '../../utils/batch'
import { requireAtMost } from '../../utils/batch'
import { assistantUsage } from './assistant.schema'

/** All SQL of the assistant (docs/server/architecture.md → Repository). */

export interface NewUsage {
  id: string
  userId: string
  day: string
  feature: AssistantFeature
  provider: AiProvider
  model: string
  at: Date
}

/**
 * The request's usage row and a guard after it: the user's rows that day, this one included, at
 * most `limit`. Two requests racing for the last slot can't both pass (SQLite runs one batch at a
 * time; the guard sees the other's row).
 */
export function reserveUsageStatements(db: Db, usage: NewUsage, limit: number): Statement[] {
  return [
    db.insert(assistantUsage).values({ ...usage, outcome: 'pending' }),
    requireAtMost(db, sql`select count(*) from ${assistantUsage} where ${assistantUsage.userId} = ${usage.userId} and ${assistantUsage.day} = ${usage.day}`, limit),
  ]
}

export interface UsageResult {
  outcome: Exclude<AssistantOutcome, 'pending'>
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
}

/** Fills in how a pending request ended. */
export async function finishUsage(db: Db, id: string, result: UsageResult): Promise<void> {
  await db.update(assistantUsage).set(result).where(and(eq(assistantUsage.id, id), eq(assistantUsage.outcome, 'pending')))
}

/** Removes rows from before `cutoff`; returns how many. */
export async function deleteUsageBefore(db: Db, cutoff: Date): Promise<number> {
  const removed = await db.delete(assistantUsage).where(lt(assistantUsage.at, cutoff)).returning({ id: assistantUsage.id })
  return removed.length
}
