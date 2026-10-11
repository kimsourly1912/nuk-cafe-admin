import { listPromotions } from '#server/features/menu'

/** Every promotion, newest start first (the library is small: the page filters by phase). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return listPromotions(useDb(), actor.tenantId)
})
