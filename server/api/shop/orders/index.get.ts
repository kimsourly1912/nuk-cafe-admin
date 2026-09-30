import { customerOrdersQuerySchema } from '#shared/contracts/orders'
import { listMyOrders } from '~~/server/features/orders'

/**
 * `GET /api/shop/orders?page=&pageSize=`: the signed-in customer's orders still in play, and a page
 * of the finished ones, newest first (step 6.5, D106).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireSignedIn(event)
  return listMyOrders(useDb(), actor, readValidQuery(event, customerOrdersQuerySchema))
})
