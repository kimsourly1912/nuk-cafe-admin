import { resumeTenantSchema } from '#shared/contracts/tenants'
import { resumeTenant } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { tenant: ['suspend'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const input = await readValidBody(event, resumeTenantSchema)
  return resumeTenant(useDb(), actor, tenantId, input)
})
