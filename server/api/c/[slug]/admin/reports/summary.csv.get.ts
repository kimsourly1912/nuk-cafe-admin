import { reportPeriodQuerySchema } from '#shared/contracts/reports'
import { summaryExport } from '#server/features/orders'

/** `GET /api/admin/reports/summary.csv` (8.1b, D111): the Summary as CSV, every matching row. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { report: ['export'] })
  const { filename, csv } = await summaryExport(useDb(), actor.tenantId, readValidQuery(event, reportPeriodQuerySchema))
  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  })
  return csv
})
