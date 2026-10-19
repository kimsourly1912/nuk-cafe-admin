import { updateTenantNotesSchema } from '#shared/contracts/tenants'
import { updateTenantNotes } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { notes: ['update'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const input = await readValidBody(event, updateTenantNotesSchema)
  return updateTenantNotes(useDb(), actor, tenantId, input)
})
