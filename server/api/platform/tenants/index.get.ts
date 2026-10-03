import { tenantListQuerySchema } from '#shared/contracts/tenants'
import { listTenants } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['read'] })
  const query = readValidQuery(event, tenantListQuerySchema)
  return listTenants(useDb(), query)
})
