import { openSupportSchema } from '#shared/contracts/support'
import { openSupportVisit } from '#server/features/support'

/**
 * Opens a support visit to the cafe (P5, D193) after a fresh code from the super admin's
 * authenticator app, checked by Better Auth against the signed-in session.
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePlatformPermission(event, { support: ['open'] })
  const tenantId = readIdParam(event, 'tenantId', 'The cafe')
  const { code } = await readValidBody(event, openSupportSchema)
  const { sessionId } = await supportRequestOf(event, tenantId)
  if (!sessionId) throw createError({ statusCode: 401 })
  const verifyCode = () => serverAuth(event).api.verifyTOTP({ headers: event.headers, body: { code } }).then(() => true, () => false)
  return openSupportVisit(useDb(), { ...actor, sessionId }, tenantId, verifyCode)
})
