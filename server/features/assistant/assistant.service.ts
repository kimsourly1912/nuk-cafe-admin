import type { LanguageModel, LanguageModelUsage } from 'ai'
import { streamText } from 'ai'
import type { AssistantFeature } from '#shared/contracts/assistant'
import { ASSISTANT_TIME_ZONE, ASSISTANT_USAGE_RETENTION_DAYS } from '#shared/contracts/assistant'
import type { Db } from '../../utils/batch'
import { runBatch } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { localDate } from '../../utils/weekly-windows'
import type { Actor } from '../identity'
import { aiLimitReached } from './assistant.errors'
import type { UsageResult } from './assistant.repository'
import * as repo from './assistant.repository'
import type { AssistantSettings } from './assistant.settings'

/**
 * The assistant's server side (phase 9, docs/plans/ai-assistant.md, D107; groundwork 9.0, D108).
 * Every request to the provider first takes one of the admin's daily slots (a usage row, guarded
 * in the batch), then records how it ended. The AI only suggests: nothing here writes app data.
 */

const DAY_MS = 86_400_000

/** How long one request to the provider may take before it's given up (a stream included). */
export const PROVIDER_TIMEOUT_MS = 30_000

/**
 * Takes one of the admin's slots for today, or refuses with 429 `AI_LIMIT_REACHED`. Returns the
 * usage row's id, to finish once the provider has answered.
 */
export async function startUsage(db: Db, actor: Actor, settings: AssistantSettings, feature: AssistantFeature, now = new Date()): Promise<string> {
  const id = newId()
  const usage: repo.NewUsage = { id, userId: actor.userId, day: localDate(now, ASSISTANT_TIME_ZONE), feature, provider: settings.provider, model: settings.model, at: now }
  await runBatch(db, repo.reserveUsageStatements(db, usage, settings.dailyLimit), () => aiLimitReached(settings.dailyLimit))
  return id
}

/** The tokens a provider reported, as the usage row stores them (`null` when it didn't say). */
export function usageResult(outcome: UsageResult['outcome'], usage?: LanguageModelUsage): UsageResult {
  return {
    outcome,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
  }
}

export async function finishUsage(db: Db, id: string, result: UsageResult): Promise<void> {
  await repo.finishUsage(db, id, result)
}

/** Daily: removes usage rows past their 90 days. */
export async function purgeAssistantUsage(db: Db, now = new Date()): Promise<number> {
  return repo.deleteUsageBefore(db, new Date(now.getTime() - ASSISTANT_USAGE_RETENTION_DAYS * DAY_MS))
}

export interface StreamHooks {
  /** Keeps the Worker alive until the usage row is written (`event.waitUntil`). */
  waitUntil: (promise: Promise<unknown>) => void
  /** Where a provider failure is logged (its cause never reaches the screen). */
  onProviderError: (error: unknown) => void
}

/**
 * Step 9.0's staging check (D108): a tiny streamed answer through the Worker, recorded like any
 * request. Removed in 9.1, when the chat route takes its place.
 */
export async function pingAssistant(db: Db, actor: Actor, settings: AssistantSettings, model: LanguageModel, hooks: StreamHooks, now = new Date()) {
  const usageId = await startUsage(db, actor, settings, 'ping', now)
  return streamText({
    model,
    prompt: 'Reply with one short sentence confirming you are ready to help cafe staff.',
    maxOutputTokens: 60,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    onFinish: ({ totalUsage }) => {
      hooks.waitUntil(finishUsage(db, usageId, usageResult('ok', totalUsage)))
    },
    onError: ({ error }) => {
      hooks.onProviderError(error)
      hooks.waitUntil(finishUsage(db, usageId, usageResult('error')))
    },
  })
}
