import { getItem } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return getItem(useDb(), actor.tenantId, readIdParam(event, 'itemId', 'This menu item'))
})
