import { sendTestMessage } from '#server/features/notifications'

/** Send test: a short message to a connected chat. */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return sendTestMessage(useDb(), api, actor, readIdParam(event, 'id', 'This Telegram chat'))
})
