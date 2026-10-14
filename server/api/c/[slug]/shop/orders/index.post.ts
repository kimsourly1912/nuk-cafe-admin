import { placeOrderSchema } from '#shared/contracts/orders'
import { getOrder, placeOrder } from '#server/features/orders'

/**
 * `POST /api/shop/orders` (header `Idempotency-Key`) `{ branchId, tableToken?, lines,
 * expectedTotalMinor }`: places the order for the signed-in customer or guest (D156).
 * 201 with the order; a retry with the same key answers 200 with the same order. The cafe's
 * Telegram alert is sent right after the answer (D150).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireCustomer(event)
  const key = readIdempotencyKey(event)
  const input = await readValidBody(event, placeOrderSchema)
  const { orderId, replayed } = await placeOrder(useDb(), actor, input, key)
  if (!replayed) sendOrderEventsNow(event, { tenantId: actor.tenantId, orderId }, 'orders.placed')
  setResponseStatus(event, replayed ? 200 : 201)
  return getOrder(useDb(), actor, orderId)
})
