import { listOwners } from '#server/features/tenants'

/** Everyone who owns a cafe, with their cafes: New cafe's "An existing owner" (D146). */
export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['create'] })
  return listOwners(useDb())
})
