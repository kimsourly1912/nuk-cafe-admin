import { counterSession } from '#server/features/identity'

/**
 * The counter app's session check (D102): who is signed in and the branches they work at. Answers
 * on a temporary password too, so the app can ask for a new one. A day from sign-in at most (D243).
 */
export default defineEventHandler(async (event) => {
  const tenant = await requireTenant(event)
  const { user } = await workspaceSession(event)
  return counterSession(useDb(), user, tenant.id)
})
