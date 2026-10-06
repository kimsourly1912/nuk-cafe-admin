import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { createAI } from 'agents/models/ai-sdk'
import type { AISettings } from 'agents/models/ai-sdk'
import { aiNotConfigured } from './assistant.errors'
import type { AssistantSettings } from './assistant.settings'

export type CloudflareAiBinding = AISettings['binding']

/**
 * The only place that names AI providers (D107): the rest of the assistant talks to the AI SDK's
 * `LanguageModel`, whichever provider the settings chose.
 */
export function languageModel(settings: AssistantSettings, binding?: CloudflareAiBinding): LanguageModel {
  const { provider, model, apiKey } = settings
  const baseURL = settings.baseUrl ?? undefined
  switch (provider) {
    case 'cloudflare':
      if (typeof binding?.run !== 'function') throw aiNotConfigured('The Cloudflare AI binding is missing. Configure ai.binding = AI on this Worker.')
      // assistantSettingsFrom validates the complete @cf/vendor/model id before route glue calls us.
      // Help and literal transcription need the answer within the existing output/deadline caps.
      // The provider disables thinking only on models that support this documented option.
      return createAI({ binding })(model as `@cf/${string}`, { reasoningEffort: null })
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(model)
    case 'openai':
      return createOpenAI({ apiKey, baseURL })(model)
    case 'google':
      return createGoogle({ apiKey, baseURL })(model)
    case 'openai-compatible':
      return createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseURL! })(model)
  }
}
