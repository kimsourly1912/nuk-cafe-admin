import { removeOwnerSchema } from '#shared/contracts/tenants'
import { removeOwner } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { owner: ['remove'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const userId = readIdParam(event, 'userId', 'This owner')
  const input = await readValidBody(event, removeOwnerSchema)
  return removeOwner(useDb(), actor, tenantId, userId, input)
})
