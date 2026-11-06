import { listKhqrReviews } from '#server/features/orders'

/**
 * `GET /api/admin/khqr/reviews` (D266): KHQR payments an order couldn't take, for the cafe's owners
 * (`payment: ['review']`). Not a support permission: a platform support visit is refused.
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { payment: ['review'] })
  return listKhqrReviews(useDb(), actor.tenantId)
})
