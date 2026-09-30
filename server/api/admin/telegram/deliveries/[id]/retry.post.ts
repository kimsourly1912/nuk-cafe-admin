import { retryDelivery } from '~~/server/features/notifications'

/** Retry a failed delivery: its saved message, sent again now. */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return retryDelivery(useDb(), api, actor, readIdParam(event, 'id', 'This message'))
})
