import { listAccountSessions } from '#server/features/identity'
import type { SessionStamp, SessionUser } from '#server/features/identity'

/**
 * Where the signed-in account is signed in (Your devices on the account security page, D243): each
 * session's device, when it signed in, and which is this browser. Never a token. A platform route:
 * it names no cafe, and keeps no workspace's day limit (a customer's account may read it too). Not
 * signed in: 401.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return listAccountSessions(useDb(), session?.user as SessionUser | undefined, (session?.session as SessionStamp | undefined)?.id)
})
