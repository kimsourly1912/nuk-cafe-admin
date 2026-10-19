import { slugAvailabilityQuerySchema } from '#shared/contracts/tenants'
import { checkSlug } from '#server/features/tenants'

/** Whether a new cafe's web address is free, now and in the address history: advisory, creating decides (D185). */
export default defineEventHandler(async (event) => {
  await requirePlatformPermission(event, { tenant: ['create'] })
  const { slug } = readValidQuery(event, slugAvailabilityQuerySchema)
  return checkSlug(useDb(), slug)
})
