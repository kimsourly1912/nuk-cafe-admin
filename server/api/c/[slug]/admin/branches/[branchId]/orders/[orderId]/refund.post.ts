import { refundOrderSchema } from '#shared/contracts/orders'
import { refundOrder } from '#server/features/orders'

/**
 * `POST /api/admin/branches/{branchId}/orders/{orderId}/refund` `{ version, returnMethod, note }`
 * (header `Idempotency-Key`, D233): the cafe's owner records that a ready or completed order's
 * money went back; answers the order as Order history shows it. Two checks: the admin's own (the
 * order detail's `report: ['read']`, which also refuses a support visit), then `payment:
 * ['refund']`, a branch permission only owners hold (D45), on the order's branch in the path.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { report: ['read'] })
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { payment: ['refund'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  const key = readIdempotencyKey(event)
  return refundOrder(useDb(), actor, orderId, await readValidBody(event, refundOrderSchema), key)
})
