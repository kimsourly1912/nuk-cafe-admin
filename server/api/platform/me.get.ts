import { platformSession } from '#server/features/identity'

/**
 * The platform console's session check (D142): who is signed in, and whether they must change a
 * temporary password first. The only platform route that answers while a temporary password is in
 * place. A day from sign-in at most (D243).
 */
export default defineEventHandler(async (event) => {
  const { user } = await workspaceSession(event)
  return platformSession(user)
})
