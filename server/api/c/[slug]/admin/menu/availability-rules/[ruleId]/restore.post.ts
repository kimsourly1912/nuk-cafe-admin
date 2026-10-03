import { availabilityRuleVersionSchema } from '#shared/contracts/menu-availability'
import { restoreAvailabilityRule } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'ruleId', 'This availability rule')
  return restoreAvailabilityRule(useDb(), actor, id, await readValidBody(event, availabilityRuleVersionSchema))
})
