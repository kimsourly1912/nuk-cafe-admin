import { getCounterOrder } from '#server/features/orders'

/** One of the branch's orders, whatever its status (D101). */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['read'] })
  return getCounterOrder(useDb(), actor, readIdParam(event, 'orderId', 'This order'))
})
