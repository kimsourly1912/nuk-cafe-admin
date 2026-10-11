import { listPosts } from '#server/features/marketing'

/** The promotion's posts to channels, latest first (M2a, D164). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return listPosts(useDb(), actor.tenantId, readIdParam(event, 'promotionId', 'This promotion'))
})
