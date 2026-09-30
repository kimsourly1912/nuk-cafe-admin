import { AI_UNAVAILABLE_MESSAGE, pingAssistant } from '~~/server/features/assistant'

/**
 * `POST /api/admin/assistant/ping` (step 9.0, D108): a tiny streamed answer, to check the whole
 * path (settings, provider, streaming through the Worker, usage) on staging. Counts against the
 * daily limit. Removed in 9.1, when the chat route takes its place.
 */
export default defineEventHandler(async (event) => {
  const { actor, settings, model } = await requireAssistant(event)
  const result = await pingAssistant(useDb(), actor, settings, model, {
    waitUntil: promise => event.waitUntil(promise),
    onProviderError: error => log('error', 'AI provider failed', { provider: settings.provider, model: settings.model, error: String(error) }, event),
  })
  return result.toUIMessageStreamResponse({ onError: () => AI_UNAVAILABLE_MESSAGE })
})
