import { getCounterOrderHistory } from '#server/features/orders'

/** One of the branch's orders with every step and who took it (step 10.2, D117). */
export default defineEventHandler(async (event) => {
  const actor = await requireBranchPermission(event, readIdParam(event, 'branchId', 'The branch'), { order: ['read'] })
  return getCounterOrderHistory(useDb(), actor, readIdParam(event, 'orderId', 'This order'))
})
