import type { AdminSession, CounterSession } from '#shared/contracts/identity'
import type { Db } from '../../utils/batch'
import { branchNotFound, emailNotVerified, forbidden, notAdmin, notStaff, passwordChangeRequired, unauthenticated } from './identity.errors'
import { branchRoles, platformRoles, platformStatements } from './identity.permissions'
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

/** Every `resource:action` the role grants, from the statements (for the app to hide what's not allowed). */
function grantedPermissions(roles: PlatformRole[]): string[] {
  return Object.entries(platformStatements).flatMap(([resource, actions]) =>
    (actions as readonly string[])
      .filter(action => roles.some(role => platformRoles[role].authorize({ [resource]: [action] } as PlatformPermission).success))
      .map(action => `${resource}:${action}`))
}

/**
 * The admin app's session check (`GET /api/admin/me`): a platform admin, **including one still on a
 * temporary password** (the app then shows the change-password page; every other admin route
 * refuses). Not signed in or banned: 401. Signed in without the admin role: 403 `NOT_ADMIN`.
 */
export function adminSession(user: SessionUser | null | undefined): AdminSession {
  if (!user || user.banned) throw unauthenticated()
  const roles = platformRolesOf(user)
  if (!roles.includes('admin')) throw notAdmin()
  return {
    userId: user.id,
    email: user.email ?? '',
    name: user.name ?? '',
    role: 'admin',
    permissions: grantedPermissions(roles),
    mustChangePassword: Boolean(user.mustChangePassword),
  }
}

/**
 * The counter app's session check (`GET /api/counter/me`, D102): the branches this account works
 * at, with its role there; a platform admin works at every active branch. Answers on a temporary
 * password too (the app asks for a new one; every other counter route refuses). Not signed in or
 * banned: 401. No branch and not an admin: 403 `NOT_STAFF`.
 */
export async function counterSession(db: Db, user: SessionUser | null | undefined): Promise<CounterSession> {
  if (!user || user.banned) throw unauthenticated()
  const admin = platformRolesOf(user).includes('admin')
  const members = await repo.memberBranches(db, user.id)
  const roleOf = new Map(members.filter(m => m.role in branchRoles).map(m => [m.id, m.role as BranchRole]))
  const branches = admin
    ? (await repo.activeBranches(db)).map(branch => ({ ...branch, role: roleOf.get(branch.id) ?? 'admin' as const }))
    : members.filter(m => roleOf.has(m.id)).map(m => ({ id: m.id, name: m.name, role: roleOf.get(m.id)! }))
  if (!branches.length && !admin) throw notStaff()
  return {
    userId: user.id,
    email: user.email ?? '',
    name: user.name ?? '',
    mustChangePassword: Boolean(user.mustChangePassword),
    branches,
  }
}
