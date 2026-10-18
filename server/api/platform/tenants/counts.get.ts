import { countTenants } from '#server/features/tenants'

/** How many cafes each status holds (`{ active, suspended }`), for the list's tabs. */
export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['read'] })
  return countTenants(useDb())
})
