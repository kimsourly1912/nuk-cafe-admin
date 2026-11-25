import { keepSignedIn } from '#server/features/identity'

/**
 * Keep me signed in (D286): asked by the admin's sign-in page right after the sign-in succeeded
 * (password, two-step code or Google). An owner's session then lasts 30 days from sign-in in the
 * workspaces instead of one. A platform route, like `/api/me/confirm`: the session is the account's,
 * not a cafe's. No body; the server decides who may.
 */
export default defineEventHandler(async (event) => {
  const { user, stamp } = await workspaceSession(event)
  return keepSignedIn(useDb(), user, stamp, { requestId: event.context.requestId as string | undefined })
})
