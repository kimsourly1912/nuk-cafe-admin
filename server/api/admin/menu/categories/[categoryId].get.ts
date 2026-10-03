import { getCategory } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  const id = readIdParam(event, 'categoryId', 'This category')
  return getCategory(useDb(), actor.tenantId, id)
})
