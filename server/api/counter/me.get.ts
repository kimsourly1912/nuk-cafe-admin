import { counterSession } from '#server/features/identity'

/**
 * The counter app's session check (D102): who is signed in and the branches they work at. Answers
 * on a temporary password too, so the app can ask for a new one.
 */
export default defineEventHandler(async (event) => {
  const tenant = await requireTenant(event)
  const session = await getUserSession(event)
  return counterSession(useDb(), session?.user as Parameters<typeof counterSession>[1], tenant.id)
})
