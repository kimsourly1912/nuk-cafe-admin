import { getCafeSupport } from '#server/features/support'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { support: ['grant'] })
  return getCafeSupport(useDb(), actor.tenantId)
})
