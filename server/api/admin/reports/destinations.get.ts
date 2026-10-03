import type { TelegramDestination } from '#shared/contracts/notifications'
import { listDestinations } from '#server/features/notifications'

/**
 * `GET /api/admin/reports/destinations`: where Send to Telegram can send (report: ['export'], not
 * the Telegram page's settings permission). Telegram off: `enabled: false`, no chats.
 */
export default defineEventHandler(async (event): Promise<{ enabled: boolean, destinations: TelegramDestination[] }> => {
  const actor = await requirePermission(event, { report: ['export'] })
  if (!useTelegram(event)) return { enabled: false, destinations: [] }
  return { enabled: true, destinations: await listDestinations(useDb(), actor.tenantId) }
})
