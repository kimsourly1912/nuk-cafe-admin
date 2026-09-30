import type { AiProvider } from '#shared/contracts/assistant'
import { AI_PROVIDERS, ASSISTANT_DEFAULT_DAILY_LIMIT } from '#shared/contracts/assistant'
import { aiNotConfigured } from './assistant.errors'

/**
 * The assistant's settings (D107, D108), from runtime config (`NUXT_AI_*`). The provider is a
 * setting, never code: switching providers is changing these values.
 */
export interface AssistantSettings {
  provider: AiProvider
  model: string
  apiKey: string
  /** Required for `openai-compatible`; optional for the others (a proxy such as Cloudflare AI Gateway). */
  baseUrl: string | null
  dailyLimit: number
}

export interface RawAssistantSettings {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  dailyLimit?: number | string
}

const isProvider = (value: string): value is AiProvider => (AI_PROVIDERS as readonly string[]).includes(value)

/**
 * `null` (the assistant is off) without a key. With a key, the rest must be complete: an unknown
 * provider, a missing model, or an OpenAI-compatible provider without its URL is a deployment
 * mistake, refused with 500 `AI_NOT_CONFIGURED` rather than silently switched off.
 */
export function assistantSettingsFrom(raw: RawAssistantSettings): AssistantSettings | null {
  const apiKey = raw.apiKey?.trim()
  if (!apiKey) return null
  const provider = raw.provider?.trim() ?? ''
  if (!isProvider(provider)) throw aiNotConfigured(`NUXT_AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')}.`)
  const model = raw.model?.trim()
  if (!model) throw aiNotConfigured('NUXT_AI_MODEL is missing.')
  const baseUrl = raw.baseUrl?.trim() || null
  if (provider === 'openai-compatible' && !baseUrl) throw aiNotConfigured('NUXT_AI_BASE_URL is required for an OpenAI-compatible provider.')
  const limit = Number(raw.dailyLimit)
  const dailyLimit = Number.isInteger(limit) && limit > 0 ? limit : ASSISTANT_DEFAULT_DAILY_LIMIT
  return { provider, model, apiKey, baseUrl, dailyLimit }
}
