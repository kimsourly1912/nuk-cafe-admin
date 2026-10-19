import { endSupport } from '#server/features/support'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { support: ['grant'] })
  const grantId = readIdParam(event, 'grantId', 'This support access')
  return endSupport(useDb(), actor, grantId)
})
