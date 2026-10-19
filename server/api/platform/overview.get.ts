import { getPlatformOverview } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['read'], account: ['read'] })
  return getPlatformOverview(useDb(), useRuntimeConfig(event).public.cafeTimeZone)
})
