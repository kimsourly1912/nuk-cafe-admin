import { deliverySnapshot } from '#server/features/notifications'

/** View snapshot: a delivery's saved message, as text. */
export default defineEventHandler(async (event) => {
  requireTelegram(event)
  await requirePermission(event, { settings: ['manage'] })
  return deliverySnapshot(useDb(), readIdParam(event, 'id', 'This message'))
})
