import { createAvailabilityRuleSchema } from '#shared/contracts/menu-availability'
import { createAvailabilityRule } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const rule = await createAvailabilityRule(useDb(), actor, await readValidBody(event, createAvailabilityRuleSchema))
  setResponseStatus(event, 201)
  return rule
})
