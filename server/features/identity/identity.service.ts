import type { Db } from '../../utils/batch'
import { branchNotFound, emailNotVerified, forbidden, passwordChangeRequired, unauthenticated } from './identity.errors'
import { branchRoles, platformRoles } from './identity.permissions'
import type { BranchPermission, BranchRole, PlatformPermission, PlatformRole } from './identity.permissions'
import * as repo from './identity.repository'
import type { Actor, BranchActor, SessionUser } from './identity.types'

/**
 * Access decisions (docs/server/security.md → Roles and permissions). The helpers in
 * `server/utils/access.ts` read the session and call these; everything here is plain data in,
 * actor out (or an error thrown), so it's tested without Nitro.
 */

function platformRolesOf(user: SessionUser): PlatformRole[] {
  const roles = (user.role ?? '').split(',').map(r => r.trim()).filter((r): r is PlatformRole => r in platformRoles)
  return roles.length > 0 ? roles : ['customer']
}

function toActor(user: SessionUser): Actor {
  return { userId: user.id, role: platformRolesOf(user).includes('admin') ? 'admin' : 'customer' }
}

/**
 * Any signed-in account that may use the app: not banned, and not holding a temporary password
 * (Better Auth doesn't enforce `mustChangePassword`; we do, on every surface but /api/auth).
 */
export function authorizeSignedIn(user: SessionUser | null | undefined): Actor {
  if (!user || user.banned) throw unauthenticated()
  if (user.mustChangePassword) throw passwordChangeRequired()
  return toActor(user)
}

/** Shop writes: a signed-in customer with a verified email (D45). */
export function authorizeCustomer(user: SessionUser | null | undefined): Actor {
  const actor = authorizeSignedIn(user)
  if (!user!.emailVerified) throw emailNotVerified()
  return actor
}

/** The admin surface: the platform role must grant every requested action. */
export function authorizePlatform(user: SessionUser | null | undefined, permissions: PlatformPermission): Actor {
  const actor = authorizeSignedIn(user)
  const granted = platformRolesOf(user!).some(role => platformRoles[role].authorize(permissions).success)
  if (!granted) throw forbidden()
  return actor
}

/**
 * The counter surface: the caller must be a member of **this** branch with a role that grants every
 * requested action, or a platform admin (who holds every branch permission everywhere).
 * An unknown or archived branch, or one the caller isn't a member of, is 404: the caller learns
 * nothing about branches they can't use. A member without the permission gets 403.
 */
export async function authorizeBranch(db: Db, user: SessionUser | null | undefined, branchId: string, permissions: BranchPermission): Promise<BranchActor> {
  const actor = authorizeSignedIn(user)
  const access = await repo.findBranchAccess(db, branchId, actor.userId)
  if (!access || access.status !== 'active') throw branchNotFound()

  const branchRole = access.memberRole && access.memberRole in branchRoles ? access.memberRole as BranchRole : undefined
  if (actor.role === 'admin') return { ...actor, branchId, ...(branchRole && { branchRole }) }
  if (!branchRole) throw branchNotFound()
  if (!branchRoles[branchRole].authorize(permissions).success) throw forbidden()
  return { ...actor, branchId, branchRole }
}
