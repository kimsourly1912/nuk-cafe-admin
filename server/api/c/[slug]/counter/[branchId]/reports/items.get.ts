import { itemSalesQuerySchema } from '#shared/contracts/reports'
import { itemSalesReport } from '#server/features/orders'

/** The branch's Sales by item (D198): the branch is the path's, whatever the query names. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { report: ['read'] })
  return itemSalesReport(useDb(), actor.tenantId, readValidQuery(event, itemSalesQuerySchema, { branchId }))
})
