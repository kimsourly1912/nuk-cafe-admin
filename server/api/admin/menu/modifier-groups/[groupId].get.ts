import { getModifierGroup } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return getModifierGroup(useDb(), readIdParam(event, 'groupId', 'This add-on group'))
})
