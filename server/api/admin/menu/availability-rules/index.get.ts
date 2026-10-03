import { availabilityRuleListQuerySchema } from '#shared/contracts/menu-availability'
import { listAvailabilityRules } from '#server/features/menu'

/** The availability rules library, by name (`?status=active|archived|all`, default active). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return listAvailabilityRules(useDb(), actor.tenantId, readValidQuery(event, availabilityRuleListQuerySchema))
})
