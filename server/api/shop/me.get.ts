import type { CustomerAccount } from '#shared/contracts/account'
import { ensureProfile } from '#server/features/customers'
import { workspacesOf } from '#server/features/identity'

/**
 * The signed-in customer's own profile: member code (shown as a QR at the counter) and whether
 * the email is verified. Reading works before verification; ordering doesn't (D51). Staff also get
 * their workspaces, for the account menu's links (D124).
 */
export default defineEventHandler(async (event): Promise<CustomerAccount> => {
  const actor = await requireSignedIn(event)
  const session = await getUserSession(event)
  const db = useDb()
  const profile = await ensureProfile(db, actor.tenantId, actor.userId)
  return {
    name: session!.user.name,
    email: session!.user.email,
    emailVerified: session!.user.emailVerified,
    ...profile,
    workspaces: await workspacesOf(db, session!.user as Parameters<typeof workspacesOf>[1], actor.tenantId),
  }
})
