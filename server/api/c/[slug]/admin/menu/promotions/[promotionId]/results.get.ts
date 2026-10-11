import { getPromotion } from '#server/features/menu'
import { promotionResults } from '#server/features/orders'

/** How the promotion did: orders paid and not cancelled with a line at its price (M1, D163). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  const id = readIdParam(event, 'promotionId', 'This promotion')
  // Another cafe's promotion is 404, like a missing one.
  await getPromotion(useDb(), actor.tenantId, id)
  return promotionResults(useDb(), actor.tenantId, id)
})
