import { deleteAccountSchema } from '#shared/contracts/account'
import { deleteAccount } from '#server/features/identity'
import type { SessionUser } from '#server/features/identity'
import { hasOrderInProgress, requireNoOrderInProgress } from '#server/features/orders'

/**
 * The signed-in account deletes itself, in every cafe (D237). A platform route: an account is the
 * platform's, not a cafe's. Its password is checked by Better Auth against this session; its orders
 * stay with the cafes, without its name. 204: the session is gone, so the browser is signed out.
 */
export default defineEventHandler(async (event) => {
  const input = await readValidBody(event, deleteAccountSchema)
  const session = await getUserSession(event)
  const user = (session?.user as SessionUser | undefined) ?? null
  const db = useDb()
  const verifyPassword = (password: string) => serverAuth(event).api.verifyPassword({ headers: event.headers, body: { password } }).then(() => true, () => false)
  await deleteAccount(db, user, input, {
    verifyPassword,
    hasOrderInProgress: () => hasOrderInProgress(db, user?.id ?? ''),
    noOrderInProgress: requireNoOrderInProgress(db, user?.id ?? ''),
    requestId: event.context.requestId as string | undefined,
  })
  setResponseStatus(event, 204)
  return null
})
