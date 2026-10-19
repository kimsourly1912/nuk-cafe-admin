import { closeSupportVisits } from '#server/features/support'

/** Leaves the cafe: closes this session's support visits there (P5, D193). */
export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { support: ['open'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const { sessionId } = await supportRequestOf(event, tenantId)
  if (sessionId) await closeSupportVisits(useDb(), { ...actor, sessionId }, tenantId)
  return { closed: true }
})
