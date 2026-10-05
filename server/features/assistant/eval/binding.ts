import { fileURLToPath } from 'node:url'
import type { LanguageModel } from 'ai'
import type { CloudflareAiBinding } from '#server/features/assistant/assistant.model'
import { languageModel } from '#server/features/assistant/assistant.model'
import type { AssistantSettings } from '#server/features/assistant/assistant.settings'
import { assistantSettingsFrom } from '#server/features/assistant/assistant.settings'

type Environment = Record<string, string | undefined>

/** An evaluation is metered, even when it uses a binding rather than an external API key. */
export function requireEvaluationAccess(env: Environment) {
  if (env.ASSISTANT_EVAL !== '1' || env.CI) {
    throw new Error('Live assistant evaluation requires ASSISTANT_EVAL=1 outside CI.')
  }
}

export function evaluationSettings(env: Environment): AssistantSettings {
  requireEvaluationAccess(env)
  const settings = assistantSettingsFrom({
    enabled: env.NUXT_AI_ENABLED,
    provider: env.NUXT_AI_PROVIDER,
    model: env.NUXT_AI_MODEL,
    apiKey: env.NUXT_AI_API_KEY,
    baseUrl: env.NUXT_AI_BASE_URL,
    dailyLimit: 1000,
  })
  if (!settings) throw new Error('Configure an enabled evaluation provider/model. Cloudflare needs NUXT_AI_ENABLED=true and Wrangler authentication.')
  return settings
}

export interface EvaluationModel {
  model: LanguageModel
  binding?: CloudflareAiBinding
  dispose: () => Promise<void>
}

/** Node-only evaluation glue. Its isolated Wrangler config has AI only, no app DB/storage. */
export async function openEvaluationModel(settings: AssistantSettings, env: Environment): Promise<EvaluationModel> {
  requireEvaluationAccess(env)
  if (settings.provider !== 'cloudflare') return { model: languageModel(settings), dispose: async () => {} }
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy<{ AI: CloudflareAiBinding }>({
    configPath: env.ASSISTANT_EVAL_WRANGLER_CONFIG || fileURLToPath(new URL('./wrangler.json', import.meta.url)),
    envFiles: [],
    persist: false,
    remoteBindings: true,
  })
  try {
    return { model: languageModel(settings, proxy.env.AI), binding: proxy.env.AI, dispose: () => proxy.dispose() }
  }
  catch (error) {
    await proxy.dispose().catch(() => {})
    throw error
  }
}
