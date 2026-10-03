import { adminSession } from '#server/features/identity'

/**
 * The admin app's session check: who is signed in, what they may do, and whether they must change
 * a temporary password first (D52). The only admin route that answers while a temporary password
 * is in place.
 */
export default defineEventHandler(async (event) => {
  const tenant = await requireTenant(event)
  const session = await getUserSession(event)
  return adminSession(useDb(), session?.user as Parameters<typeof adminSession>[1], tenant.id)
})
