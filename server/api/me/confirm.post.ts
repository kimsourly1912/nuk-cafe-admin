import { confirmIdentitySchema } from '#shared/contracts/account'
import { confirmIdentity } from '#server/features/identity'

/**
 * `{ password }`: confirms this session for dangerous changes for 15 minutes (D246). A platform
 * route: an account's password is the platform's, and one confirmation serves the cafe's admin and
 * the console alike. Checked by Better Auth against this session; rate limited per address.
 */
export default defineEventHandler(async (event) => {
  const input = await readValidBody(event, confirmIdentitySchema)
  const { user, sessionId } = await workspaceSession(event)
  const verifyPassword = (password: string) => serverAuth(event).api.verifyPassword({ headers: event.headers, body: { password } }).then(() => true, () => false)
  return confirmIdentity(useDb(), user, sessionId, input, { verifyPassword, requestId: event.context.requestId as string | undefined })
})
