import type { H3Event } from 'h3'
import { assistantOff, assistantSettingsFrom, languageModel } from '#server/features/assistant'
import type { CloudflareAiBinding } from '#server/features/assistant'

/**
 * Route glue for `/api/admin/assistant/**`: disabled means 404; enabled Cloudflare uses the
 * request's AI binding, legacy providers use a key. The caller needs `assistant: ['use']`. Returns the
 * admin, the settings and the provider's model.
 */
export async function requireAssistant(event: H3Event) {
  const settings = assistantSettingsFrom(useRuntimeConfig(event).ai)
  if (!settings) throw assistantOff()
  const actor = await requirePermission(event, { assistant: ['use'] })
  const binding = (event.context.cloudflare as { env?: { AI?: CloudflareAiBinding } } | undefined)?.env?.AI
  return { actor, settings, model: languageModel(settings, binding) }
}
