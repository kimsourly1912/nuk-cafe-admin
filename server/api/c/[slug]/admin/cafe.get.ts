import { getCafeSettings } from '#server/features/tenants'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return getCafeSettings(useDb(), actor.tenantId)
})
