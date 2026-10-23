import { orderHistoryQuerySchema } from '#shared/contracts/reports'
import { orderHistory } from '#server/features/orders'

/** The branch's Order history (D198): the branch is the path's, whatever the query names. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { report: ['read'] })
  return orderHistory(useDb(), actor.tenantId, readValidQuery(event, orderHistoryQuerySchema, { branchId }))
})
