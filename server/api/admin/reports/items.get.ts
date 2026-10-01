import { itemSalesQuerySchema } from '#shared/contracts/reports'
import { itemSalesReport } from '#server/features/orders'

/** `GET /api/admin/reports/items` (step 8.1, D110): Sales by item, filtered, sorted, a page. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { report: ['read'] })
  return itemSalesReport(useDb(), readValidQuery(event, itemSalesQuerySchema))
})
