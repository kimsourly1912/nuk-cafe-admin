import { suspendTenantSchema } from '#shared/contracts/tenants'
import { suspendTenant } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { tenant: ['suspend'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const input = await readValidBody(event, suspendTenantSchema)
  return suspendTenant(useDb(), actor, tenantId, input)
})
