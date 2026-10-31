import type { H3Event } from 'h3'
import { authorizeBranch, authorizeCustomer, authorizePlatform, authorizeSignedIn, authorizeTenant, requireWorkspaceSession, tenantBySlug } from '#server/features/identity'
import type { Actor, BranchActor, BranchPermission, PlatformPermission, SessionStamp, SessionUser, TenantPermission } from '#server/features/identity'
import type { PlatformActor } from '#server/features/tenants'
import { supportActor } from '#server/features/support'
import type { SupportRequest } from '#server/features/support'
import { useDb } from './db'

/**
 * Access checks for routes (docs/server/security.md → Checking, D134). Every route under
 * `/api/admin`, `/api/counter` and `/api/shop` calls exactly one of these first; each returns the
 * actor the service receives, with the tenant it acts in. The session gate in `nuxt.config.ts`
 * `routeRules` is only a second line: it can't see permissions, tenants, branches or
 * `mustChangePassword`.
 */

const requestIdOf = (event: H3Event) => event.context.requestId as string | undefined

async function sessionUser(event: H3Event): Promise<SessionUser | null> {
  const session = await getUserSession(event)
  return (session?.user as SessionUser | undefined) ?? null
}

export interface RequestTenant { id: string, slug: string, name: string }

/**
 * The tenant this request acts in (D134, D140): the one its path names (`/api/c/<slug>/…`),
 * resolved once per request; unknown 404, suspended 403 `TENANT_SUSPENDED`. The path only names
 * it: whether the caller may act there is the helpers' check below. Public routes call it
 * directly; the helpers below call it for the others. A route outside `/api/c/<slug>/` has no
 * tenant: 404.
 */
export async function requireTenant(event: H3Event): Promise<RequestTenant> {
  const known = event.context.tenant as RequestTenant | undefined
  if (known) return known
  const tenant = await tenantBySlug(useDb(), getRouterParam(event, 'slug') ?? '')
  event.context.tenant = tenant
  return tenant
}

/** Any signed-in account (e.g. reading one's own profile). */
export async function requireSignedIn(event: H3Event): Promise<Actor> {
  const tenant = await requireTenant(event)
  return { ...await authorizeSignedIn(useDb(), await sessionUser(event), tenant.id), requestId: requestIdOf(event) }
}

/** `/api/shop` writes: a signed-in customer or guest (D156). */
export async function requireCustomer(event: H3Event): Promise<Actor> {
  const tenant = await requireTenant(event)
  return { ...await authorizeCustomer(useDb(), await sessionUser(event), tenant.id), requestId: requestIdOf(event) }
}

/** The session's id too: a support visit is bound to the session that opened it (D193). */
async function sessionOf(event: H3Event): Promise<{ user: SessionUser | null, sessionId: string | undefined }> {
  const session = await getUserSession(event)
  return { user: (session?.user as SessionUser | undefined) ?? null, sessionId: (session?.session as { id?: string } | undefined)?.id }
}

/**
 * The session of a workspace request (a cafe's admin and counter, the platform console, and their
 * `/me` checks): at most a day from sign-in (D243); older, it's deleted and the request is 401
 * `SESSION_EXPIRED`. Customer routes keep Better Auth's 7 days.
 */
export async function workspaceSession(event: H3Event): Promise<{ user: SessionUser | null, sessionId: string | undefined }> {
  const session = await getUserSession(event)
  const user = (session?.user as SessionUser | undefined) ?? null
  const stamp = session?.session as SessionStamp | undefined
  await requireWorkspaceSession(useDb(), user, stamp)
  return { user, sessionId: stamp?.id }
}

const isForbidden = (error: unknown) => (error as { statusCode?: number, data?: { code?: string } }).statusCode === 403 && (error as { data?: { code?: string } }).data?.code === 'FORBIDDEN'

/** What a support visit needs to know about this request: who, which session, and what it does where. */
export async function supportRequestOf(event: H3Event, tenantId: string): Promise<SupportRequest> {
  return { ...await sessionOf(event), tenantId, method: event.method, path: getRequestURL(event).pathname, requestId: requestIdOf(event) }
}

/**
 * `/api/admin`: the user's role in the tenant must grant the actions, e.g. `{ menu: ['write'] }`.
 * Refused, a super admin on a support visit the cafe's owner allowed may still read (P5, D193):
 * GET only, the support permissions only, every request audited.
 */
export async function requirePermission(event: H3Event, permissions: TenantPermission): Promise<Actor> {
  const tenant = await requireTenant(event)
  const { user } = await workspaceSession(event)
  try {
    return { ...await authorizeTenant(useDb(), user, tenant.id, permissions), requestId: requestIdOf(event) }
  }
  catch (error) {
    if (!isForbidden(error)) throw error
    const support = await supportActor(useDb(), await supportRequestOf(event, tenant.id), permissions)
    if (!support) throw error
    return support
  }
}

/**
 * `/api/counter/{branchId}`: works at that branch of the tenant with a role that grants the
 * actions (or owns the tenant). Pass the branch id from the path (`readIdParam(event, 'branchId',
 * 'The branch')`), never from the body. Unknown, archived, other tenants' and other people's
 * branches are 404.
 */
export async function requireBranchPermission(event: H3Event, branchId: string, permissions: BranchPermission): Promise<BranchActor> {
  const tenant = await requireTenant(event)
  const { user } = await workspaceSession(event)
  return { ...await authorizeBranch(useDb(), user, tenant.id, branchId, permissions), requestId: requestIdOf(event) }
}

/**
 * `/api/platform`: a super admin whose platform role grants the actions, e.g. `{ tenant: ['create'] }`
 * (the platform console, D142). No tenant: the console acts on cafes by id, and never reads a
 * cafe's menu, orders or customers.
 */
export async function requirePlatformPermission(event: H3Event, permissions: PlatformPermission): Promise<PlatformActor> {
  const { user } = await workspaceSession(event)
  return { ...authorizePlatform(user, permissions), requestId: requestIdOf(event) }
}
