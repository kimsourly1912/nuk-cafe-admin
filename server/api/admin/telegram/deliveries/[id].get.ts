import { deliverySnapshot } from '#server/features/notifications'

/** View snapshot: a delivery's saved message, as text. */
export default defineEventHandler(async (event) => {
  requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return deliverySnapshot(useDb(), actor.tenantId, readIdParam(event, 'id', 'This message'))
})
