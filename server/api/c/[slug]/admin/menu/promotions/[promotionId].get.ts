import { getPromotion } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return getPromotion(useDb(), actor.tenantId, readIdParam(event, 'promotionId', 'This promotion'))
})
