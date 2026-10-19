import { activityQuerySchema } from '#shared/contracts/platform-activity'
import { listPlatformActivity } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { activity: ['read'] })
  const query = readValidQuery(event, activityQuerySchema)
  return listPlatformActivity(useDb(), query, useRuntimeConfig(event).public.cafeTimeZone)
})
