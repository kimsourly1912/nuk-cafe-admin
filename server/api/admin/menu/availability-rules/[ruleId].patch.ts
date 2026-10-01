import { updateAvailabilityRuleSchema } from '#shared/contracts/menu-availability'
import { updateAvailabilityRule } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'ruleId', 'This availability rule')
  return updateAvailabilityRule(useDb(), actor, id, await readValidBody(event, updateAvailabilityRuleSchema))
})
