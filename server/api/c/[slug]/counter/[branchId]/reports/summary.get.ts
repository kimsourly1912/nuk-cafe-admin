import { reportPeriodQuerySchema } from '#shared/contracts/reports'
import { reportSummary } from '#server/features/orders'

/** The branch's Summary (D198): the branch is the path's, whatever the query names. */
export default defineEventHandler(async (event) => {
  const branchId = readIdParam(event, 'branchId', 'The branch')
  const actor = await requireBranchPermission(event, branchId, { report: ['read'] })
  return reportSummary(useDb(), actor.tenantId, readValidQuery(event, reportPeriodQuerySchema, { branchId }))
})
