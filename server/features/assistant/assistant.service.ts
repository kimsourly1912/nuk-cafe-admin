import type { LanguageModel, LanguageModelUsage, SystemModelMessage, UIMessage } from 'ai'
import { convertToModelMessages, isStepCount, jsonSchema, safeValidateUIMessages, streamText, tool } from 'ai'
import type { AssistantChatInput, AssistantFeature, AssistantPageLink, AssistantStatus } from '#shared/contracts/assistant'
import { ASSISTANT_CONVERSATION_MAX, ASSISTANT_QUESTION_MAX, ASSISTANT_TIME_ZONE, ASSISTANT_USAGE_RETENTION_DAYS, conversationTextLength } from '#shared/contracts/assistant'
import type { Db } from '#server/utils/batch'
import { runBatch } from '#server/utils/batch'
import { apiError, ErrorCodes } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import { maintenanceLimit } from '#server/utils/maintenance'
import { localDate } from '#server/utils/weekly-windows'
import type { Actor } from '#server/features/identity'
import { aiLimitReached } from './assistant.errors'
import { pageContext, stableInstructions } from './assistant.prompt'
import type { UsageResult } from './assistant.repository'
import * as repo from './assistant.repository'
import type { AssistantSettings } from './assistant.settings'
import type { AssistantPageKey, PageOptions } from './pages'
import { ASSISTANT_PAGES, pageKeys } from './pages'

/**
 * The assistant's server side (phase 9, docs/plans/ai-assistant.md, D107; groundwork 9.0, D108).
 * Every request to the provider first takes one of the admin's daily slots (a usage row, guarded
 * in the batch), then records how it ended. The AI only suggests: nothing here writes app data.
 */

const DAY_MS = 86_400_000

/** How long one request to the provider may take before it's given up (a stream included). */
export const PROVIDER_TIMEOUT_MS = 30_000

/**
 * Takes one of the admin's slots for today in this cafe (D139), or refuses with 429
 * `AI_LIMIT_REACHED`. Returns the usage row's id, to finish once the provider has answered.
 */
export async function startUsage(db: Db, actor: Actor, settings: AssistantSettings, feature: AssistantFeature, now = new Date()): Promise<string> {
  const id = newId()
  const usage: repo.NewUsage = { id, tenantId: actor.tenantId, userId: actor.userId, day: localDate(now, ASSISTANT_TIME_ZONE), feature, provider: settings.provider, model: settings.model, at: now }
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

export async function finishUsage(db: Db, tenantId: string, id: string, result: UsageResult): Promise<void> {
  await db.batch([repo.finishUsageStatement(db, tenantId, id, result)])
}

/** Daily: removes usage rows past their 90 days. */
export async function purgeAssistantUsage(db: Db, now = new Date(), limit = 500): Promise<number> {
  return repo.deleteUsageBefore(db, new Date(now.getTime() - ASSISTANT_USAGE_RETENTION_DAYS * DAY_MS), maintenanceLimit(limit))
}

export interface StreamHooks {
  /** Keeps the Worker alive until the usage row is written (`event.waitUntil`). */
  waitUntil: (promise: Promise<unknown>) => void
  /** Where a provider failure is logged (its cause never reaches the screen). */
  onProviderError: (error: unknown) => void
}

/** How long one answer may take, its link steps included. */
export const CHAT_TIMEOUT_MS = 60_000
/** An answer's length cap (a few short paragraphs), per step. */
const CHAT_MAX_OUTPUT_TOKENS = 1000
/** A text answer, then at most two rounds of links. */
const CHAT_MAX_STEPS = 3

/** `link_to_page`: a button to one of the pages in the list; any other key is refused by the SDK. */
function linkToPage(keys: AssistantPageKey[]) {
  const allowed = new Set<string>(keys)
  return tool({
    description: 'Shows the admin a button that opens a page of the portal. Use a key from the page list.',
    inputSchema: jsonSchema<{ page: AssistantPageKey }>(
      { type: 'object', properties: { page: { type: 'string', enum: keys } }, required: ['page'], additionalProperties: false },
      {
        validate: (value) => {
          const page = (value as { page?: unknown } | null)?.page
          return typeof page === 'string' && allowed.has(page)
            ? { success: true, value: { page: page as AssistantPageKey } }
            : { success: false, error: new Error('Unknown page') }
        },
      },
    ),
    execute: async ({ page }): Promise<AssistantPageLink> => ({ ...ASSISTANT_PAGES[page] }),
  })
}

function chatTools(options: PageOptions) {
  return { link_to_page: linkToPage(pageKeys(options)) }
}

const invalidConversation = (message: string) => apiError(400, ErrorCodes.VALIDATION_FAILED, message)

/**
 * The conversation the browser sent, checked with the SDK's own validation (message shapes, the
 * link tool's inputs and outputs), ending with the admin's question. Only the latest
 * `ASSISTANT_CHAT_MAX_MESSAGES` reach the model (the contract refuses more).
 */
const unreadable = () => invalidConversation('The conversation couldn\'t be read. Clear the chat and ask again.')

type UIPart = UIMessage['parts'][number]

/**
 * An earlier answer as the model will see it, rebuilt from what this product sends (audit S1): its
 * text, its step markers, and its finished links, each link's page taken from our own list, never
 * from the browser. Reasoning is left out (the chat never shows it). Anything else (a file, a
 * source, another tool) is refused. Nothing the browser attached (provider options) is kept.
 */
function answerParts(parts: UIPart[]): UIPart[] {
  const kept: UIPart[] = []
  for (const part of parts) {
    if (part.type === 'text') kept.push({ type: 'text', text: part.text })
    else if (part.type === 'step-start') kept.push({ type: 'step-start' })
    else if (part.type === 'reasoning') continue
    else if (part.type === 'tool-link_to_page') {
      // Unfinished or failed: nothing the model needs. Its input was checked against the tool's schema.
      if (part.state !== 'output-available') continue
      const page = (part.input as { page: AssistantPageKey }).page
      kept.push({ type: 'tool-link_to_page', toolCallId: `link_${kept.length}`, state: 'output-available', input: { page }, output: { ...ASSISTANT_PAGES[page] } })
    }
    else throw unreadable()
  }
  return kept
}

/**
 * The conversation the browser sent, checked with the SDK's own validation (message shapes, the
 * link tool's inputs), ending with the admin's question, then rebuilt from what the product allows:
 * questions are text only, answers as `answerParts` keeps them, and all of it together at most
 * `ASSISTANT_CONVERSATION_MAX` characters. Runs before a daily slot is taken, so a refused
 * conversation costs nothing and reaches no provider.
 */
async function checkConversation(messages: unknown[], tools: ReturnType<typeof chatTools>): Promise<UIMessage[]> {
  const checked = await safeValidateUIMessages({ messages, tools })
  if (!checked.success) throw unreadable()
  const lastIndex = checked.data.length - 1
  if (checked.data[lastIndex]?.role !== 'user') throw invalidConversation('Ask a question.')
  const conversation = checked.data.map((message, index): UIMessage => {
    if (message.role === 'system') throw unreadable()
    if (message.role === 'assistant') return { id: String(index), role: 'assistant', parts: answerParts(message.parts) }
    if (message.parts.some(part => part.type !== 'text')) throw invalidConversation('Questions can only be text.')
    const text = message.parts.map(part => (part.type === 'text' ? part.text : '')).join('')
    if (text.length > ASSISTANT_QUESTION_MAX) throw invalidConversation(`A question can have at most ${ASSISTANT_QUESTION_MAX.toLocaleString('en-US')} characters.`)
    if (index === lastIndex && !text.trim()) throw invalidConversation('Ask a question.')
    return { id: String(index), role: 'user', parts: [{ type: 'text', text }] }
  })
  if (conversationTextLength(conversation) > ASSISTANT_CONVERSATION_MAX) throw invalidConversation('The conversation is too long. Clear the chat and ask again.')
  return conversation
}

/**
 * The help assistant (step 9.1, D109): answers the admin's question from the help guide, with
 * buttons to the pages it mentions, streamed. Takes one of the admin's daily slots first; the
 * conversation lives in the browser and isn't stored (A4).
 */
export async function chatWithAssistant(db: Db, actor: Actor, settings: AssistantSettings, model: LanguageModel, input: AssistantChatInput, context: PageOptions & StreamHooks, now = new Date()) {
  const tools = chatTools(context)
  const conversation = await checkConversation(input.messages, tools)
  const usageId = await startUsage(db, actor, settings, 'chat', now)
  const history = await convertToModelMessages(conversation, { tools, ignoreIncompleteToolCalls: true })
  const instructions: SystemModelMessage[] = [
    // The unchanging start, marked for Anthropic's prompt cache (other providers cache it by themselves).
    { role: 'system', content: await stableInstructions(context), providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
    { role: 'system', content: pageContext(input.page) },
  ]
  return streamText({
    model,
    instructions,
    messages: history,
    tools,
    stopWhen: isStepCount(CHAT_MAX_STEPS),
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    onFinish: ({ totalUsage }) => {
      context.waitUntil(finishUsage(db, actor.tenantId, usageId, usageResult('ok', totalUsage)))
    },
    onError: ({ error }) => {
      context.onProviderError(error)
      context.waitUntil(finishUsage(db, actor.tenantId, usageId, usageResult('error')))
    },
  })
}

/** `GET /api/admin/assistant`: the limit and how much of it the admin used today. */
export async function assistantStatus(db: Db, actor: Actor, settings: AssistantSettings, now = new Date()): Promise<AssistantStatus> {
  return { dailyLimit: settings.dailyLimit, usedToday: await repo.countUsage(db, actor.tenantId, actor.userId, localDate(now, ASSISTANT_TIME_ZONE)) }
}
