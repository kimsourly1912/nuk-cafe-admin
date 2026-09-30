import * as v from 'valibot'

/**
 * The AI assistant (phase 9, docs/plans/ai-assistant.md, D107): admins only, any supported AI
 * provider chosen by settings, and the AI only ever suggests. Step 9.0 (D108): the groundwork.
 */

/** Providers the assistant supports (covered by the plan's quality check). */
export const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'openai-compatible'] as const
export type AiProvider = typeof AI_PROVIDERS[number]

/** What a usage row was for. `ping` is 9.0's staging check. */
export const ASSISTANT_FEATURES = ['ping', 'chat', 'menu_item_draft', 'rewrite'] as const
export type AssistantFeature = typeof ASSISTANT_FEATURES[number]

/** `pending` while the provider answers; then `ok` or `error`. */
export const ASSISTANT_OUTCOMES = ['pending', 'ok', 'error'] as const
export type AssistantOutcome = typeof ASSISTANT_OUTCOMES[number]

/** Requests per admin per day unless `NUXT_AI_DAILY_LIMIT` says otherwise (owner, 2026-09-30). */
export const ASSISTANT_DEFAULT_DAILY_LIMIT = 100
/** The day the limit counts in, and resets at midnight of: the cafe's zone. */
export const ASSISTANT_TIME_ZONE = 'Asia/Phnom_Penh'
/** Usage rows are kept this long (cost reports), then removed by `assistant:purge-usage`. */
export const ASSISTANT_USAGE_RETENTION_DAYS = 90

/** `GET /api/admin/assistant` (9.1, D109): the assistant is on here, and today's use. 404 when off. */
export interface AssistantStatus {
  dailyLimit: number
  usedToday: number
}

/** The conversation the model sees: the latest messages only (the browser keeps the rest on screen). */
export const ASSISTANT_CHAT_MAX_MESSAGES = 20
/** Longest question, in characters. */
export const ASSISTANT_QUESTION_MAX = 2000

/**
 * `POST /api/admin/assistant/chat` (9.1): the AI SDK's chat messages (checked on the server with
 * the SDK's own validation) and the admin page the question was asked on.
 */
export const assistantChatSchema = v.object({
  messages: v.pipe(v.array(v.unknown()), v.minLength(1, 'Ask a question'), v.maxLength(ASSISTANT_CHAT_MAX_MESSAGES, `At most ${ASSISTANT_CHAT_MAX_MESSAGES} messages`)),
  page: v.pipe(v.string(), v.maxLength(300), v.regex(/^\/admin(?:[/?#]|$)/, 'An admin page')),
})
export type AssistantChatInput = v.InferOutput<typeof assistantChatSchema>

/** What `link_to_page` returns: a page of the portal the answer points to. */
export interface AssistantPageLink {
  title: string
  path: string
}
