import { addOwnerSchema } from '#shared/contracts/tenants'
import { addOwner } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { owner: ['add'] })
  // Who owns a cafe (D246).
  await requireConfirmation(event)
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const input = await readValidBody(event, addOwnerSchema)
  return addOwner(useDb(), actor, tenantId, input)
})
