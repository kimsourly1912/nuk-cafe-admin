import { cancelMyOrderSchema } from '#shared/contracts/orders'
import { cancelMyOrder } from '~~/server/features/orders'

/**
 * `{ version }` (header `Idempotency-Key`): the customer cancels their own unpaid order (D45, step
 * 6.5, D106). Paid meanwhile: 409 `ORDER_NOT_CANCELLABLE`; someone else's: 404.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireCustomer(event)
  const orderId = readIdParam(event, 'id', 'This order')
  const key = readIdempotencyKey(event)
  return cancelMyOrder(useDb(), actor, orderId, await readValidBody(event, cancelMyOrderSchema), key)
})
