import { payOrderSchema } from '#shared/contracts/orders'
import { payOrder } from '#server/features/orders'

/**
 * `{ version, method, khrPerUsd? | reference? }` (header `Idempotency-Key`): records the payment,
 * which starts preparation (D45, D101). Answers the order as it is now.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { payment: ['collect'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  const key = readIdempotencyKey(event)
  return payOrder(useDb(), actor, orderId, await readValidBody(event, payOrderSchema), key)
})
