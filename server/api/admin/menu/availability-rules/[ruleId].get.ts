import { getAvailabilityRule } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return getAvailabilityRule(useDb(), readIdParam(event, 'ruleId', 'This availability rule'))
})
