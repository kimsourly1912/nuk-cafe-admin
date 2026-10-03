import { orderHistoryQuerySchema } from '#shared/contracts/reports'
import { orderHistory } from '#server/features/orders'

/** `GET /api/admin/reports/orders` (step 8.1, D110): orders placed in the period, filtered. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { report: ['read'] })
  return orderHistory(useDb(), actor.tenantId, readValidQuery(event, orderHistoryQuerySchema))
})
