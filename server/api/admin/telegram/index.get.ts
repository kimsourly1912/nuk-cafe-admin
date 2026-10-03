import { telegramOverview } from '#server/features/notifications'

/** `GET /api/admin/telegram` (step 8.1c, D112): whether Telegram is set up here, and the chats. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return telegramOverview(useDb(), actor.tenantId, useTelegram(event))
})
