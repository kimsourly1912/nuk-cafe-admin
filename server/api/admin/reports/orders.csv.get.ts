import { orderHistoryQuerySchema } from '#shared/contracts/reports'
import { orderHistoryExport } from '~~/server/features/orders'

/** `GET /api/admin/reports/orders.csv` (8.1b, D111): Order history as CSV, every matching row. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { report: ['export'] })
  const { filename, csv } = await orderHistoryExport(useDb(), readValidQuery(event, orderHistoryQuerySchema))
  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  })
  return csv
})
