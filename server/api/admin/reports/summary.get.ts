import { reportPeriodQuerySchema } from '#shared/contracts/reports'
import { reportSummary } from '#server/features/orders'

/** `GET /api/admin/reports/summary?branchId&from&to` (step 8.1, D110): the period's sales at a glance. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { report: ['read'] })
  return reportSummary(useDb(), actor.tenantId, readValidQuery(event, reportPeriodQuerySchema))
})
