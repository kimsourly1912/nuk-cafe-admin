import { assistantChatSchema } from '#shared/contracts/assistant'
import { AI_UNAVAILABLE_MESSAGE, chatWithAssistant } from '~~/server/features/assistant'

/**
 * `POST /api/admin/assistant/chat` (step 9.1, D109): the help assistant's answer to the latest
 * question, as the AI SDK's UI message stream (text, and `link_to_page` buttons). Counts against the
 * admin's daily limit. A provider failure ends the stream with a plain error message.
 */
export default defineEventHandler(async (event) => {
  const { actor, settings, model } = await requireAssistant(event)
  const input = await readValidBody(event, assistantChatSchema)
  const result = await chatWithAssistant(useDb(), actor, settings, model, input, {
    sampleData: useRuntimeConfig(event).public.sampleData.enabled,
    waitUntil: promise => event.waitUntil(promise),
    onProviderError: error => log('error', 'AI provider failed', { provider: settings.provider, model: settings.model, error: String(error) }, event),
  })
  return result.toUIMessageStreamResponse({ onError: () => AI_UNAVAILABLE_MESSAGE })
})
