import type { NotificationDeliveries } from '#shared/contracts/notifications'
import { listDeliveries } from '#server/features/notifications'

/** The delivery history: the latest 50 messages, newest first (D113). */
export default defineEventHandler(async (event): Promise<NotificationDeliveries> => {
  requireTelegram(event)
  await requirePermission(event, { settings: ['manage'] })
  return { deliveries: await listDeliveries(useDb()) }
})
