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
  /** Cloudflare requires explicit enablement; legacy providers default to the presence of a key. */
  enabled?: boolean | string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  dailyLimit?: number | string
}

const isProvider = (value: string): value is AiProvider => (AI_PROVIDERS as readonly string[]).includes(value)

/**
 * Cloudflare needs explicit enablement and an AI binding, not an API key. Legacy providers stay
 * off without a key. Once enabled, the rest must be complete: an unknown
 * provider, a missing model, or an OpenAI-compatible provider without its URL is a deployment
 * mistake, refused with 500 `AI_NOT_CONFIGURED` rather than silently switched off.
 */
export function assistantSettingsFrom(raw: RawAssistantSettings): AssistantSettings | null {
  const provider = raw.provider?.trim() ?? ''
  if (raw.enabled !== undefined && ![true, false, 'true', 'false', ''].includes(raw.enabled)) {
    throw aiNotConfigured('NUXT_AI_ENABLED must be true or false.')
  }
  if (raw.enabled === false || raw.enabled === 'false') return null
  const enabled = raw.enabled === true || raw.enabled === 'true'
  const apiKey = provider === 'cloudflare' ? '' : raw.apiKey?.trim() ?? ''
  if (provider === 'cloudflare' ? !enabled : !apiKey && !enabled) return null
  if (!isProvider(provider)) throw aiNotConfigured(`NUXT_AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')}.`)
  if (provider !== 'cloudflare' && !apiKey) throw aiNotConfigured('NUXT_AI_API_KEY is missing.')
  const model = raw.model?.trim()
  if (!model) throw aiNotConfigured('NUXT_AI_MODEL is missing.')
  if (provider === 'cloudflare' && !/^@cf\/[a-z0-9-]+\/[a-z0-9._-]+$/.test(model)) {
    throw aiNotConfigured('NUXT_AI_MODEL must be a Workers AI model id starting with @cf/.')
  }
  const baseUrl = raw.baseUrl?.trim() || null
  if (provider === 'cloudflare' && baseUrl) throw aiNotConfigured('Cloudflare uses the AI binding; NUXT_AI_BASE_URL must be empty.')
  if (provider === 'openai-compatible' && !baseUrl) throw aiNotConfigured('NUXT_AI_BASE_URL is required for an OpenAI-compatible provider.')
  const limit = Number(raw.dailyLimit)
  const dailyLimit = Number.isInteger(limit) && limit > 0 ? limit : ASSISTANT_DEFAULT_DAILY_LIMIT
  return { provider, model, apiKey, baseUrl, dailyLimit }
}
