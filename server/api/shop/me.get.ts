import { ensureProfile } from '~~/server/features/customers'

/**
 * The signed-in customer's own profile: member code (shown as a QR at the counter) and whether
 * the email is verified. Reading works before verification; ordering doesn't (D51).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireSignedIn(event)
  const session = await getUserSession(event)
  const profile = await ensureProfile(useDb(), actor.userId)
  return {
    name: session!.user.name,
    email: session!.user.email,
    emailVerified: session!.user.emailVerified,
    ...profile,
  }
})
