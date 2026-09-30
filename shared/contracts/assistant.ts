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
