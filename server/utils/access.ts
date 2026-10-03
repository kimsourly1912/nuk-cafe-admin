import type { H3Event } from 'h3'
import { authorizeBranch, authorizeCustomer, authorizeSignedIn, authorizeTenant, tenantBySlug } from '#server/features/identity'
import type { Actor, BranchActor, BranchPermission, SessionUser, TenantPermission } from '#server/features/identity'
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

/** `/api/shop` writes: a signed-in customer with a verified email. */
export async function requireCustomer(event: H3Event): Promise<Actor> {
  const tenant = await requireTenant(event)
  return { ...await authorizeCustomer(useDb(), await sessionUser(event), tenant.id), requestId: requestIdOf(event) }
}

/** `/api/admin`: the user's role in the tenant must grant the actions, e.g. `{ menu: ['write'] }`. */
export async function requirePermission(event: H3Event, permissions: TenantPermission): Promise<Actor> {
  const tenant = await requireTenant(event)
  return { ...await authorizeTenant(useDb(), await sessionUser(event), tenant.id, permissions), requestId: requestIdOf(event) }
}

/**
 * `/api/counter/{branchId}`: works at that branch of the tenant with a role that grants the
 * actions (or owns the tenant). Pass the branch id from the path (`readIdParam(event, 'branchId',
 * 'The branch')`), never from the body. Unknown, archived, other tenants' and other people's
 * branches are 404.
 */
export async function requireBranchPermission(event: H3Event, branchId: string, permissions: BranchPermission): Promise<BranchActor> {
  const tenant = await requireTenant(event)
  return { ...await authorizeBranch(useDb(), await sessionUser(event), tenant.id, branchId, permissions), requestId: requestIdOf(event) }
}
