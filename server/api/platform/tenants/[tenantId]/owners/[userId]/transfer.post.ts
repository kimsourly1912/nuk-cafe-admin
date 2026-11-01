import { transferOwnerSchema } from '#shared/contracts/tenants'
import { transferOwner } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { owner: ['transfer'] })
  // Who owns a cafe (D246).
  await requireConfirmation(event)
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const userId = readIdParam(event, 'userId', 'This owner')
  const input = await readValidBody(event, transferOwnerSchema)
  return transferOwner(useDb(), actor, tenantId, userId, input)
})
