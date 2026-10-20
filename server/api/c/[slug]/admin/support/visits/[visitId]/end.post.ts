import { endSupportVisit } from '#server/features/support'

/** The owner shuts out one platform visit now, leaving the grant (and other visits) as they are. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { support: ['grant'] })
  const visitId = readIdParam(event, 'visitId', 'This visit')
  return endSupportVisit(useDb(), actor, visitId)
})
