import { availabilityRuleVersionSchema } from '#shared/contracts/menu-availability'
import { archiveAvailabilityRule } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'ruleId', 'This availability rule')
  return archiveAvailabilityRule(useDb(), actor, id, await readValidBody(event, availabilityRuleVersionSchema))
})
