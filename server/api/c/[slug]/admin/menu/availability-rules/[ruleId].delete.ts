import { availabilityRuleVersionSchema } from '#shared/contracts/menu-availability'
import { deleteAvailabilityRule } from '#server/features/menu'

/** `{ version }`: deletes an archived rule no item or category names (D200); else 409. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'ruleId', 'This availability rule')
  await deleteAvailabilityRule(useDb(), actor, id, await readValidBody(event, availabilityRuleVersionSchema))
  setResponseStatus(event, 204)
  return null
})
