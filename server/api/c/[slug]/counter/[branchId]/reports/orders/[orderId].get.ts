import { orderHistoryDetail } from '#server/features/orders'

/** One order of the branch (D198); another branch's order is not found. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { report: ['read'] })
  return orderHistoryDetail(useDb(), actor.tenantId, readIdParam(event, 'orderId', 'This order'), { branchId })
})
