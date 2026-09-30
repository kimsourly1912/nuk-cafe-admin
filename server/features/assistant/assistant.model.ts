import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { AssistantSettings } from './assistant.settings'

/**
 * The only place that names AI providers (D107): the rest of the assistant talks to the AI SDK's
 * `LanguageModel`, whichever provider the settings chose.
 */
export function languageModel(settings: AssistantSettings): LanguageModel {
  const { provider, model, apiKey } = settings
  const baseURL = settings.baseUrl ?? undefined
  switch (provider) {
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
