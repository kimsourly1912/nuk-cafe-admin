import type { H3Event } from 'h3'
import { assistantOff, assistantSettingsFrom, languageModel } from '#server/features/assistant'

/**
 * Route glue for `/api/admin/assistant/**` (phase 9, D107, D108): without an AI key the assistant
 * doesn't exist (404); with one, the caller needs `assistant: ['use']` (admins). Returns the
 * admin, the settings and the provider's model.
 */
export async function requireAssistant(event: H3Event) {
  const settings = assistantSettingsFrom(useRuntimeConfig(event).ai)
  if (!settings) throw assistantOff()
  const actor = await requirePermission(event, { assistant: ['use'] })
  return { actor, settings, model: languageModel(settings) }
}
