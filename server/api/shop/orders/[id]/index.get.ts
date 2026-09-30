import { getOrder } from '#server/features/orders'

/** `GET /api/shop/orders/{id}`: one of the signed-in customer's orders; anyone else's is 404 (D99). */
export default defineEventHandler(async (event) => {
  const actor = await requireSignedIn(event)
  return getOrder(useDb(), actor, readIdParam(event, 'id', 'This order'))
})
