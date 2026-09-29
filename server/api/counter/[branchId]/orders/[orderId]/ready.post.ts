import { counterCommandSchema } from '#shared/contracts/orders'
import { markOrderReady } from '~~/server/features/orders'

/** `{ version }` (header `Idempotency-Key`): Preparing → ready (D101). */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['ready'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  const key = readIdempotencyKey(event)
  return markOrderReady(useDb(), actor, orderId, await readValidBody(event, counterCommandSchema), key)
})
