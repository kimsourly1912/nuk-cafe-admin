import { getTenant } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['read'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  return getTenant(useDb(), tenantId)
})
