import { getPlatformHealth } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { health: ['read'] })
  return getPlatformHealth(useDb())
})
