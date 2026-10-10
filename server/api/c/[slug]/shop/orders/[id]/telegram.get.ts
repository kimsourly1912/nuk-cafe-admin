import { orderReadyAlert } from '#server/features/notifications'
import { getOrder } from '#server/features/orders'

/**
 * `GET /api/shop/orders/{id}/telegram`: whether the customer asked for "Your order is ready" on
 * Telegram (D157). Their own order only: anyone else's is 404, like the order itself.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireSignedIn(event)
  const order = await getOrder(useDb(), actor, readIdParam(event, 'id', 'This order'))
  return orderReadyAlert(useDb(), actor.tenantId, order.id, useTelegram(event))
})
