import { createKhqrSchema } from '#shared/contracts/orders'
import { createKhqrCharge } from '#server/features/orders'

/**
 * `{ currency }`: the KHQR for this unpaid order, the open one or a new one (step 10.15, D130). The
 * cashier shows it; the payment is recorded by `pay` once the money arrives.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { payment: ['collect'] })
  const orderId = readIdParam(event, 'orderId', 'This order')
  return createKhqrCharge(useDb(), actor, orderId, await readValidBody(event, createKhqrSchema))
})
