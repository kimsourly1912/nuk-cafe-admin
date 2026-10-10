import type { ShopMe } from '#shared/contracts/account'
import { ensureProfile } from '#server/features/customers'
import { workspacesOf } from '#server/features/identity'

/**
 * The signed-in customer's own profile: member code (shown as a QR at the counter) and whether
 * the email is verified. Staff also get their workspaces, for the account menu's links (D124). A
 * guest (D156) gets only their name: no profile or member code is made for them.
 */
export default defineEventHandler(async (event): Promise<ShopMe> => {
  const actor = await requireSignedIn(event)
  const session = await getUserSession(event)
  if (actor.guest) return { guest: true, name: session!.user.name }
  const db = useDb()
  const profile = await ensureProfile(db, actor.tenantId, actor.userId)
  return {
    guest: false,
    name: session!.user.name,
    email: session!.user.email,
    emailVerified: session!.user.emailVerified,
    ...profile,
    workspaces: await workspacesOf(db, session!.user as Parameters<typeof workspacesOf>[1], actor.tenantId),
  }
})
