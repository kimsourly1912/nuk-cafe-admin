import { adminSession } from '#server/features/identity'
import { supportSession, tenantSupport } from '#server/features/support'

/**
 * The admin app's session check: who is signed in, what they may do, and whether they must change
 * a temporary password first (D52). The only admin route that answers while a temporary password
 * is in place. A super admin on a support visit gets a read-only session (P5, D193); an owner sees
 * until when platform support is allowed. A day from sign-in at most (D243).
 */
export default defineEventHandler(async (event) => {
  const tenant = await requireTenant(event)
  const { user } = await workspaceSession(event)
  const db = useDb()
  try {
    const admin = await adminSession(db, user, tenant.id)
    return { ...admin, supportAllowedUntil: (await tenantSupport(db, tenant.id))?.expiresAt ?? null }
  }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 403) throw error
    const support = await supportSession(db, await supportRequestOf(event, tenant.id))
    if (!support) throw error
    return support
  }
})
