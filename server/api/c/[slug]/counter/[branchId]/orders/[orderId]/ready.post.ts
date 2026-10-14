import { counterCommandSchema } from '#shared/contracts/orders'
import { markOrderReady } from '#server/features/orders'

/**
 * `{ version }` (header `Idempotency-Key`): Preparing → ready (D101). The customer's Telegram
 * message, when they asked for one, goes right after the answer (D157).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['ready'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  const key = readIdempotencyKey(event)
  const order = await markOrderReady(useDb(), actor, orderId, await readValidBody(event, counterCommandSchema), key)
  sendOrderEventsNow(event, { tenantId: actor.tenantId, orderId }, 'orders.ready')
  return order
})
