import { getModifierGroup } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return getModifierGroup(useDb(), actor.tenantId, readIdParam(event, 'groupId', 'This add-on group'))
})
