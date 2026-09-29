import { counterCommandSchema } from '#shared/contracts/orders'
import { completeOrder } from '~~/server/features/orders'

/** `{ version }` (header `Idempotency-Key`): Ready → completed (handed to the customer) (D101). */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['complete'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  const key = readIdempotencyKey(event)
  return completeOrder(useDb(), actor, orderId, await readValidBody(event, counterCommandSchema), key)
})
