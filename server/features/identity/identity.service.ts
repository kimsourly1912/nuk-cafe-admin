import type { Workspace } from '#shared/contracts/account'
import type { AdminSession, CounterSession } from '#shared/contracts/identity'
import type { PlatformSession } from '#shared/contracts/tenants'
import type { Db } from '#server/utils/batch'
import { branchNotFound, emailNotVerified, forbidden, notAdmin, notPlatformAdmin, notStaff, passwordChangeRequired, tenantNotFound, tenantSuspended, unauthenticated } from './identity.errors'
import { branchRoles, platformRoles, tenantRoles, tenantStatements } from './identity.permissions'
import type { BranchPermission, BranchRole, PlatformPermission, PlatformRole, TenantPermission, TenantRole } from './identity.permissions'
import * as repo from './identity.repository'
import type { Actor, BranchActor, SessionUser } from './identity.types'

/**
 * Access decisions (docs/server/security.md → Roles and permissions, D134). The helpers in
 * `server/utils/access.ts` read the session and the request's tenant and call these; everything
 * here is plain data in, actor out (or an error thrown), so it's tested without Nitro.
 */

function platformRolesOf(user: SessionUser): PlatformRole[] {
  const roles = (user.role ?? '').split(',').map(r => r.trim()).filter((r): r is PlatformRole => r in platformRoles)
  return roles.length > 0 ? roles : ['customer']
}

const tenantRoleOf = (role: string | undefined): TenantRole | undefined =>
  role && role in tenantRoles ? role as TenantRole : undefined

/**
 * The platform's first tenant (the oldest; NUK Cafe), for work that has no request path naming one
 * (D140): a sign-up's first customer profile, a server error outside `/api/c/<slug>/`, the Bakong
 * token's reminders (until each cafe has its own token, T2). Requests take theirs from the path
 * (`tenantBySlug`). None (an empty database) or a suspended one: 404.
 */
export async function currentTenant(db: Db): Promise<{ id: string, slug: string, name: string }> {
  const tenant = await repo.findCurrentTenant(db)
  if (!tenant || (tenant.status ?? 'active') !== 'active') throw tenantNotFound()
  return { id: tenant.id, slug: tenant.slug, name: tenant.name }
}

/**
 * The tenant a request's path names (`/api/c/<slug>/…`, D140). Unknown: 404 (nothing says whether
 * a cafe ever had that address); suspended: 403 `TENANT_SUSPENDED`.
 */
export async function tenantBySlug(db: Db, slug: string): Promise<{ id: string, slug: string, name: string }> {
  const tenant = await repo.findTenantBySlug(db, slug)
  if (!tenant) throw tenantNotFound()
  if ((tenant.status ?? 'active') !== 'active') throw tenantSuspended()
  return { id: tenant.id, slug: tenant.slug, name: tenant.name }
}

/** Every active tenant, oldest first: the scheduled tasks that work per tenant go through them (D138). */
export async function activeTenants(db: Db): Promise<{ id: string, slug: string, name: string }[]> {
  return repo.findActiveTenants(db)
}

/**
 * Any signed-in account that may use the app: not banned, and not holding a temporary password
 * (Better Auth doesn't enforce `mustChangePassword`; we do, on every surface but /api/auth).
 */
function signedIn(user: SessionUser | null | undefined): SessionUser {
  if (!user || user.banned) throw unauthenticated()
  if (user.mustChangePassword) throw passwordChangeRequired()
  return user
}

/** Any signed-in account, acting in the tenant (its role there, or `customer`). */
export async function authorizeSignedIn(db: Db, user: SessionUser | null | undefined, tenantId: string): Promise<Actor> {
  const { id } = signedIn(user)
  return { userId: id, tenantId, role: tenantRoleOf(await repo.findTenantRole(db, tenantId, id)) ?? 'customer' }
}

/** Shop writes: a signed-in customer with a verified email (D45). */
export async function authorizeCustomer(db: Db, user: SessionUser | null | undefined, tenantId: string): Promise<Actor> {
  const actor = await authorizeSignedIn(db, user, tenantId)
  if (!user!.emailVerified) throw emailNotVerified()
  return actor
}

/** The admin surface: the user's role in the tenant must grant every requested action. */
export async function authorizeTenant(db: Db, user: SessionUser | null | undefined, tenantId: string, permissions: TenantPermission): Promise<Actor> {
  const actor = await authorizeSignedIn(db, user, tenantId)
  if (actor.role === 'customer' || !tenantRoles[actor.role].authorize(permissions).success) throw forbidden()
  return actor
}

/** The platform surface (T2): a super admin whose platform role grants the actions. */
export function authorizePlatform(user: SessionUser | null | undefined, permissions: PlatformPermission): { userId: string } {
  const { id } = signedIn(user)
  if (!platformRolesOf(user!).some(role => platformRoles[role].authorize(permissions).success)) throw forbidden()
  return { userId: id }
}

/**
 * The counter surface: the caller must work at **this** branch of the tenant with a role that
 * grants every requested action, or be an owner of the tenant (who holds every branch permission).
 * An unknown or archived branch, another tenant's, or one the caller doesn't work at, is 404: the
 * caller learns nothing about branches they can't use. Staff without the permission get 403.
 */
export async function authorizeBranch(db: Db, user: SessionUser | null | undefined, tenantId: string, branchId: string, permissions: BranchPermission): Promise<BranchActor> {
  const actor = await authorizeSignedIn(db, user, tenantId)
  const access = await repo.findBranchAccess(db, tenantId, branchId, actor.userId)
  if (!access || access.status !== 'active') throw branchNotFound()

  const branchRole = access.staffRole && access.staffRole in branchRoles ? access.staffRole as BranchRole : undefined
  if (actor.role === 'owner') return { ...actor, branchId, ...(branchRole && { branchRole }) }
  if (!branchRole) throw branchNotFound()
  if (!branchRoles[branchRole].authorize(permissions).success) throw forbidden()
  return { ...actor, branchId, branchRole }
}

/** Every `resource:action` the role grants, from the statements (for the app to hide what's not allowed). */
function grantedPermissions(role: TenantRole): string[] {
  return Object.entries(tenantStatements).flatMap(([resource, actions]) =>
    (actions as readonly string[])
      .filter(action => tenantRoles[role].authorize({ [resource]: [action] } as TenantPermission).success)
      .map(action => `${resource}:${action}`))
}

/**
 * The admin app's session check (`GET /api/admin/me`): an owner of the tenant, **including one still
 * on a temporary password** (the app then shows the change-password page; every other admin route
 * refuses). Not signed in or banned: 401. Signed in, not an owner: 403 `NOT_ADMIN`.
 */
export async function adminSession(db: Db, user: SessionUser | null | undefined, tenantId: string): Promise<AdminSession> {
  if (!user || user.banned) throw unauthenticated()
  if (tenantRoleOf(await repo.findTenantRole(db, tenantId, user.id)) !== 'owner') throw notAdmin()
  return {
    userId: user.id,
    email: user.email ?? '',
    name: user.name ?? '',
    role: 'admin',
    permissions: grantedPermissions('owner'),
    mustChangePassword: Boolean(user.mustChangePassword),
  }
}

/**
 * The counter app's session check (`GET /api/counter/me`, D102): the tenant's branches this account
 * works at, with its role there; an owner works at every active branch. Answers on a temporary
 * password too (the app asks for a new one; every other counter route refuses). Not signed in or
 * banned: 401. No branch and not an owner: 403 `NOT_STAFF`.
 */
export async function counterSession(db: Db, user: SessionUser | null | undefined, tenantId: string): Promise<CounterSession> {
  if (!user || user.banned) throw unauthenticated()
  const owner = tenantRoleOf(await repo.findTenantRole(db, tenantId, user.id)) === 'owner'
  const staff = await repo.staffBranches(db, tenantId, user.id)
  const roleOf = new Map(staff.filter(m => m.role in branchRoles).map(m => [m.id, m.role as BranchRole]))
  const branches = owner
    ? (await repo.activeBranches(db, tenantId)).map(branch => ({ ...branch, role: roleOf.get(branch.id) ?? 'admin' as const }))
    : staff.filter(m => roleOf.has(m.id)).map(m => ({ id: m.id, name: m.name, role: roleOf.get(m.id)! }))
  if (!branches.length && !owner) throw notStaff()
  return {
    userId: user.id,
    email: user.email ?? '',
    name: user.name ?? '',
    mustChangePassword: Boolean(user.mustChangePassword),
    branches,
  }
}

/**
 * The staff workspaces an account may open in the tenant, for the customer site's account menu
 * (`GET /api/shop/me`): the admin app for an owner (D52), the counter for whoever `counterSession`
 * accepts. Only links: each workspace checks access on its own routes.
 */
export async function workspacesOf(db: Db, user: SessionUser, tenantId: string): Promise<Workspace[]> {
  if (tenantRoleOf(await repo.findTenantRole(db, tenantId, user.id)) === 'owner') return ['admin', 'counter']
  const staff = await repo.staffBranches(db, tenantId, user.id)
  return staff.some(m => m.role in branchRoles) ? ['counter'] : []
}

/**
 * Every tenant an account works in, with the workspaces it may open there (`GET /api/me/cafes`,
 * T2c, D144): the admin app and the counter where it's an owner, the counter where it works at an
 * active branch (the same rules as `workspacesOf`, for all tenants at once). Signed in is enough,
 * **a temporary password included** (like `platformSession`): it only lists links, and each
 * workspace asks for a new password itself. Not signed in or banned: 401.
 */
export async function accountWorkspaces(db: Db, user: SessionUser | null | undefined): Promise<{ tenantId: string, workspaces: Workspace[] }[]> {
  if (!user || user.banned) throw unauthenticated()
  const [memberships, staff] = await Promise.all([repo.memberTenants(db, user.id), repo.staffTenants(db, user.id)])
  const owned = new Set(memberships.filter(m => tenantRoleOf(m.role) === 'owner').map(m => m.tenantId))
  const counter = new Set([...owned, ...staff.filter(s => s.role in branchRoles).map(s => s.tenantId)])
  return [...counter].map(tenantId => ({ tenantId, workspaces: owned.has(tenantId) ? ['admin', 'counter'] : ['counter'] }))
}

/**
 * The platform console's session check (`GET /api/platform/me`, D142): a super admin, **including
 * one still on a temporary password** (the console then asks for a new one; every other platform
 * route refuses). Not signed in or banned: 401. Signed in, not a super admin: 403 `NOT_PLATFORM_ADMIN`.
 */
export function platformSession(user: SessionUser | null | undefined): PlatformSession {
  if (!user || user.banned) throw unauthenticated()
  if (!platformRolesOf(user).includes('superadmin')) throw notPlatformAdmin()
  return { userId: user.id, email: user.email ?? '', name: user.name ?? '', mustChangePassword: Boolean(user.mustChangePassword) }
}
