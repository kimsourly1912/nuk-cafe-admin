import { changeTenantSlugSchema } from '#shared/contracts/tenants'
import { changeTenantSlug } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { tenant: ['update'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const input = await readValidBody(event, changeTenantSlugSchema)
  return changeTenantSlug(useDb(), actor, tenantId, input)
})
