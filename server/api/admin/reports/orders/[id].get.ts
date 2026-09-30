import { orderHistoryDetail } from '#server/features/orders'

/** `GET /api/admin/reports/orders/{id}` (step 8.1, D110): one order, its payment and its steps. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { report: ['read'] })
  return orderHistoryDetail(useDb(), readIdParam(event, 'id', 'This order'))
})
