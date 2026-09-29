import { cancelOrderSchema } from '#shared/contracts/orders'
import { cancelOrderAtCounter } from '~~/server/features/orders'

/**
 * `{ version, reason, note?, returnMethod? }` (header `Idempotency-Key`): cancels an order that
 * isn't ready yet; a paid one says how the money went back (Q36, D101).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['cancel'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  const key = readIdempotencyKey(event)
  return cancelOrderAtCounter(useDb(), actor, orderId, await readValidBody(event, cancelOrderSchema), key)
})
