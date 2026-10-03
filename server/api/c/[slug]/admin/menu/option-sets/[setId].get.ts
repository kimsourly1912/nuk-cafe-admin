import { getOptionSet } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return getOptionSet(useDb(), actor.tenantId, readIdParam(event, 'setId', 'This option set'))
})
