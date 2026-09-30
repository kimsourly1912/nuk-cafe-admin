import type { Update } from 'grammy/types'
import { handleUpdate, secretMatches } from '#server/features/notifications'

/**
 * Telegram's webhook (step 8.1c, D112). Not a browser request: no session and no origin check
 * (`/api/webhooks/` is exempt); Telegram proves itself with the secret it was given in
 * `setWebhook`, sent in `X-Telegram-Bot-Api-Secret-Token`. Anything else is 401 before the body is
 * read. An error answers 500, so Telegram retries: every handler can take a repeat.
 */
export default defineEventHandler(async (event) => {
  const { settings, api } = requireTelegram(event)
  if (!secretMatches(getHeader(event, 'x-telegram-bot-api-secret-token'), settings.webhookSecret)) {
    throw apiError(401, 'UNAUTHENTICATED', 'Unknown sender.')
  }
  const update = await readBody<Update>(event)
  if (!update || typeof update !== 'object' || typeof update.update_id !== 'number') return { ok: true }
  await handleUpdate(useDb(), api, settings, update)
  return { ok: true }
})
