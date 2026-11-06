import { recordKhqrReturnSchema } from '#shared/contracts/orders'
import { recordKhqrReturn } from '#server/features/orders'

/**
 * `POST /api/admin/khqr/reviews/{id}/return` `{ version, method, currency, amount, returnedAt,
 * reference, note }` (header `Idempotency-Key`, D266): an owner records how a review case's money
 * went back. Records only: nothing is sent to the customer's bank.
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { payment: ['review'] })
  const id = readIdParam(event, 'reviewId', 'This payment to review')
  const key = readIdempotencyKey(event)
  return recordKhqrReturn(useDb(), actor, id, await readValidBody(event, recordKhqrReturnSchema), key)
})
