import { platformSession } from '#server/features/identity'

/**
 * The platform console's session check (D142): who is signed in, and whether they must change a
 * temporary password first. The only platform route that answers while a temporary password is in
 * place.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return platformSession(session?.user as Parameters<typeof platformSession>[0])
})
