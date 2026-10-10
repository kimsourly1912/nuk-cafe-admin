import { createOrderReadyLink } from '#server/features/notifications'
import { getOrder } from '#server/features/orders'

/**
 * `POST /api/shop/orders/{id}/telegram`: a one-time link to the bot that will say when this order
 * is ready (D157). Their own order only (404 otherwise); 409 once it's ready, finished or
 * cancelled; 404 on a server without a bot.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireCustomer(event)
  const { settings } = requireTelegram(event)
  const order = await getOrder(useDb(), actor, readIdParam(event, 'id', 'This order'))
  return createOrderReadyLink(useDb(), actor.tenantId, order, settings)
})
