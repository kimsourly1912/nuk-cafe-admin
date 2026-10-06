import type { LanguageModel, LanguageModelUsage, SystemModelMessage, UIMessage } from 'ai'
import { convertToModelMessages, createUIMessageStream, generateText, isStepCount, jsonSchema, NoObjectGeneratedError, Output, safeValidateUIMessages, streamText, tool } from 'ai'
import type { AssistantChatInput, AssistantFeature, AssistantPageLink, AssistantStatus } from '#shared/contracts/assistant'
import { ASSISTANT_QUESTION_MAX, ASSISTANT_TIME_ZONE, ASSISTANT_USAGE_RETENTION_DAYS } from '#shared/contracts/assistant'
import type { Db } from '#server/utils/batch'
import { runBatch } from '#server/utils/batch'
import { apiError, ErrorCodes } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import { localDate } from '#server/utils/weekly-windows'
import type { Actor } from '#server/features/identity'
import { aiLimitReached, providerFailureMessage } from './assistant.errors'
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
export async function startUsage(db: Db, actor: Actor, settings: AssistantSettings, feature: AssistantFeature, now = new Date(), importPage?: { sourceId: string, pageNumber: number }): Promise<string> {
  const id = newId()
  const usage: repo.NewUsage = { id, tenantId: actor.tenantId, userId: actor.userId, day: localDate(now, ASSISTANT_TIME_ZONE), feature, provider: settings.provider, model: settings.model, at: now,
    ...(importPage ? { importSourceId: importPage.sourceId, sourcePageNumber: importPage.pageNumber } : {}) }
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
  /** Optional request cancellation; the provider deadline still applies. */
  abortSignal?: AbortSignal
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
async function checkConversation(messages: unknown[], tools: ReturnType<typeof chatTools>): Promise<UIMessage[]> {
  const checked = await safeValidateUIMessages({ messages, tools })
  if (!checked.success) throw invalidConversation('The conversation couldn\'t be read. Clear the chat and ask again.')
  const conversation = checked.data
  const last = conversation.at(-1)
  if (last?.role !== 'user') throw invalidConversation('Ask a question.')
  for (const message of conversation) {
    if (message.role === 'system') throw invalidConversation('The conversation couldn\'t be read. Clear the chat and ask again.')
    if (message.role !== 'user') continue
    const text = message.parts.map(part => (part.type === 'text' ? part.text : '')).join('')
    if (text.length > ASSISTANT_QUESTION_MAX) throw invalidConversation(`A question can have at most ${ASSISTANT_QUESTION_MAX.toLocaleString('en-US')} characters.`)
    if (message === last && !text.trim()) throw invalidConversation('Ask a question.')
  }
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
    maxRetries: settings.provider === 'cloudflare' ? 0 : 1,
    abortSignal: context.abortSignal
      ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(CHAT_TIMEOUT_MS)])
      : AbortSignal.timeout(CHAT_TIMEOUT_MS),
    onEnd: ({ usage }) => {
      context.waitUntil(finishUsage(db, usageId, usageResult('ok', usage)))
    },
    onError: ({ error }) => {
      context.onProviderError(error)
      context.waitUntil(finishUsage(db, usageId, usageResult('error')))
    },
    onAbort: () => {
      context.waitUntil(finishUsage(db, usageId, usageResult('error')))
    },
  })
}

/**
 * Workers AI: one validated structured answer, then server-owned navigation buttons (D161).
 * No native tool rounds, partial JSON or provider-created paths reach the browser.
 */
export async function chatWithCloudflareAssistant(db: Db, actor: Actor, settings: AssistantSettings, model: LanguageModel, input: AssistantChatInput, context: PageOptions & StreamHooks, now = new Date()) {
  const conversation = await checkConversation(input.messages, chatTools(context))
  const instructions = `${await stableInstructions(context, true)}\n\n${pageContext(input.page)}`
  const usageId = await startUsage(db, actor, settings, 'chat', now)
  const keys = pageKeys(context)
  const allowed = new Set<string>(keys)
  type Answer = { answer: string, pages: AssistantPageKey[] }
  const schema = jsonSchema<Answer>({
    type: 'object', additionalProperties: false, required: ['answer', 'pages'],
    properties: { answer: { type: 'string', minLength: 1, maxLength: 6000 }, pages: { type: 'array', maxItems: 3, items: { type: 'string', enum: keys } } },
  }, {
    validate(value) {
      const data = value as Partial<Answer> | null
      return data && typeof data === 'object' && Object.keys(data).length === 2
        && typeof data.answer === 'string' && !!data.answer.trim() && data.answer.length <= 6000
        && Array.isArray(data.pages) && data.pages.length <= 3 && data.pages.every(page => typeof page === 'string' && allowed.has(page))
        ? { success: true, value: { answer: data.answer, pages: [...new Set(data.pages)] } }
        : { success: false, error: new Error('Invalid help answer') }
    },
  })
  const answer = (async () => {
    let usage: LanguageModelUsage | undefined
    let outcome: UsageResult['outcome'] = 'error'
    try {
      context.abortSignal?.throwIfAborted()
      const result = await generateText({
        model, instructions,
        // Previous server-generated buttons are UI state, not new instructions/tool rounds.
        messages: conversation.map(message => ({ role: message.role as 'user' | 'assistant', content: message.parts.filter(part => part.type === 'text').map(part => part.text).join('') })),
        output: Output.object({ name: 'portal_help', schema }),
        maxOutputTokens: 1500, maxRetries: 0,
        abortSignal: context.abortSignal ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(CHAT_TIMEOUT_MS)]) : AbortSignal.timeout(CHAT_TIMEOUT_MS),
        telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
        include: { requestBody: false, requestMessages: false, responseBody: false },
      })
      usage = result.usage
      if (result.finishReason !== 'stop') throw new Error('Incomplete help answer')
      const output = result.output
      context.abortSignal?.throwIfAborted()
      outcome = 'ok'
      return { text: output.answer, pages: output.pages, links: output.pages.map(page => ({ ...ASSISTANT_PAGES[page] })), usage }
    }
    catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) usage = error.usage
      context.onProviderError(error)
      throw error
    }
    finally { context.waitUntil(finishUsage(db, usageId, usageResult(outcome, usage))) }
  })()
  // The UI stream observes failures; eval callers may consume answer instead of the stream.
  void answer.catch(() => {})
  const stream = createUIMessageStream({
    onError: error => providerFailureMessage(settings.provider, error),
    async execute({ writer }) {
      const result = await answer
      writer.write({ type: 'start', messageId: newId() })
      writer.write({ type: 'start-step' })
      writer.write({ type: 'text-start', id: 'answer' })
      writer.write({ type: 'text-delta', id: 'answer', delta: result.text })
      writer.write({ type: 'text-end', id: 'answer' })
      for (const page of result.pages) {
        const toolCallId = newId()
        writer.write({ type: 'tool-input-available', toolCallId, toolName: 'link_to_page', input: { page } })
        writer.write({ type: 'tool-output-available', toolCallId, output: { ...ASSISTANT_PAGES[page] } })
      }
      writer.write({ type: 'finish-step' })
      writer.write({ type: 'finish', finishReason: 'stop' })
    },
  })
  return { stream, answer }
}

/** `GET /api/admin/assistant`: the limit and how much of it the admin used today. */
export async function assistantStatus(db: Db, actor: Actor, settings: AssistantSettings, now = new Date()): Promise<AssistantStatus> {
  return { dailyLimit: settings.dailyLimit, usedToday: await repo.countUsage(db, actor.tenantId, actor.userId, localDate(now, ASSISTANT_TIME_ZONE)) }
}
