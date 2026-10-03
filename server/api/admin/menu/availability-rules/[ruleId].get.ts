import { getAvailabilityRule } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return getAvailabilityRule(useDb(), actor.tenantId, readIdParam(event, 'ruleId', 'This availability rule'))
})
