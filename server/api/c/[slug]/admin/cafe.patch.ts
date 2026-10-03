import { updateCafeSchema } from '#shared/contracts/cafe'
import { updateCafeSettings } from '#server/features/tenants'

/** The cafe's name and logo (D143); its address is the platform team's to change. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  const input = await readValidBody(event, updateCafeSchema)
  return updateCafeSettings(useDb(), actor, input)
})
