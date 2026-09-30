import { itemSalesQuerySchema } from '#shared/contracts/reports'
import { itemSalesExport } from '#server/features/orders'

/** `GET /api/admin/reports/items.csv` (8.1b, D111): Sales by item as CSV, every matching row. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { report: ['export'] })
  const { filename, csv } = await itemSalesExport(useDb(), readValidQuery(event, itemSalesQuerySchema))
  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  })
  return csv
})
