import type { H3Event } from 'h3'
import { authorizeBranch, authorizeCustomer, authorizePlatform, authorizeSignedIn } from '#server/features/identity'
import type { Actor, BranchActor, BranchPermission, PlatformPermission, SessionUser } from '#server/features/identity'
import { useDb } from './db'

/**
 * Access checks for routes (docs/server/security.md → Checking). Every route under
 * `/api/admin`, `/api/counter` and `/api/shop` calls exactly one of these first; each returns the
 * actor the service receives. The session gate in `nuxt.config.ts` `routeRules` is only a second
 * line: it can't see permissions, branches or `mustChangePassword`.
 */

const requestIdOf = (event: H3Event) => event.context.requestId as string | undefined

async function sessionUser(event: H3Event): Promise<SessionUser | null> {
  const session = await getUserSession(event)
  return (session?.user as SessionUser | undefined) ?? null
}

/** Any signed-in account (e.g. reading one's own profile). */
export async function requireSignedIn(event: H3Event): Promise<Actor> {
  return { ...authorizeSignedIn(await sessionUser(event)), requestId: requestIdOf(event) }
}

/** `/api/shop` writes: a signed-in customer with a verified email. */
export async function requireCustomer(event: H3Event): Promise<Actor> {
  return { ...authorizeCustomer(await sessionUser(event)), requestId: requestIdOf(event) }
}

/** `/api/admin`: the platform role must grant the actions, e.g. `{ menu: ['write'] }`. */
export async function requirePermission(event: H3Event, permissions: PlatformPermission): Promise<Actor> {
  return { ...authorizePlatform(await sessionUser(event), permissions), requestId: requestIdOf(event) }
}

/**
 * `/api/counter/{branchId}`: a member of that branch whose role grants the actions (or a platform
 * admin). Pass the branch id from the path (`readIdParam(event, 'branchId', 'The branch')`), never
 * from the body. Unknown, archived and other people's branches are 404.
 */
export async function requireBranchPermission(event: H3Event, branchId: string, permissions: BranchPermission): Promise<BranchActor> {
  return { ...await authorizeBranch(useDb(), await sessionUser(event), branchId, permissions), requestId: requestIdOf(event) }
}
