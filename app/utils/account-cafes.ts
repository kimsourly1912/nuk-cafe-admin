import type { Workspace } from '#shared/contracts/account'
import type { AccountCafe } from '#shared/contracts/cafe'
import { apiFetch } from './api'
import { ApiError } from './api-error'
import { tenantUrl } from './tenant-path'

/**
 * The cafes one account works in (T2c, D144). Your cafes and the switcher read them through the
 * cafe feature's `useAccountCafes()`; the admin and counter sign-ins ask once, when the account
 * isn't let in here, what it may open instead (D239).
 */

/** Your cafes: signed out, the page sends the person to sign in first. */
export const CAFES_PATH = '/cafes'

/** `GET /api/me/cafes`: the signed-in account's cafes, by name. Throws `ApiError` (401 signed out). */
export function fetchAccountCafes() {
  return apiFetch<AccountCafe[]>('/me/cafes')
}

/**
 * The address of a cafe's workspace: `/c/<slug>/admin` or `/c/<slug>/counter`. Open it as a full
 * page load (`external`): moving to another cafe never reuses this one's sessions or data (D141).
 */
export function workspaceUrl(slug: string, workspace: Workspace) {
  return tenantUrl(slug, workspace === 'admin' ? '/admin' : '/counter')
}

/** The cafes, other than the one of `currentSlug`, whose `workspace` opens (active ones only). */
export function otherCafes(cafes: readonly AccountCafe[] | null | undefined, currentSlug: string, workspace: Workspace) {
  return (cafes ?? []).filter(cafe => cafe.slug !== currentSlug && cafe.status === 'active' && cafe.workspaces.includes(workspace))
}

/** The platform console's home (D142); its own sign-in and session decide access there. */
export const PLATFORM_CONSOLE_PATH = '/platform'

/** What an account refused at a workspace may open instead (D239). */
export interface OtherAccess {
  /** This cafe's other workspace, when it opens: a manager refused by the admin app works at the counter. */
  here: Workspace | null
  /** Whether it works at another active cafe (Your cafes lists it), whatever the workspace. */
  elsewhere: boolean
  /** A platform team account (super admin): it never opens a cafe's data, only the console (D135, D193). */
  platform: boolean
}

/** Nothing to offer: only Use another account. */
export const NO_OTHER_ACCESS: OtherAccess = { here: null, elsewhere: false, platform: false }

/** What `cafes` (and the console) open other than `workspace` at `currentSlug`; `null` when nothing does (a customer). */
export function otherAccess(cafes: readonly AccountCafe[], currentSlug: string, workspace: Workspace, platform = false): OtherAccess | null {
  const active = cafes.filter(cafe => cafe.status === 'active')
  const here = active.find(cafe => cafe.slug === currentSlug)?.workspaces.find(w => w !== workspace) ?? null
  const elsewhere = active.some(cafe => cafe.slug !== currentSlug && cafe.workspaces.length > 0)
  return here || elsewhere || platform ? { here, elsewhere, platform } : null
}

/**
 * A sign-in refused at this workspace by an account that works somewhere (D239, after T2c's D144):
 * it stays signed in, and the page shows `<WorkspaceRefused>` with where it may go instead.
 */
export class WorkspaceRefusedError extends ApiError {
  /** `access`: `null` when it couldn't be checked (the network); the page offers Try again (Q4). */
  constructor(readonly access: OtherAccess | null, cause: unknown) {
    super('This account can\'t open this workspace.', { kind: 'forbidden', status: 403, code: 'WORKSPACE_REFUSED', cause })
    this.name = 'WorkspaceRefusedError'
  }
}

/** The part of Better Auth's session user read here. */
interface SessionAccount {
  email: string
  /** Platform roles, comma-separated (Better Auth's admin plugin): `superadmin` is the platform team. */
  role?: string | null
  /** A guest (D156): signed in by Place order, no account of its own. */
  isAnonymous?: boolean | null
}

/** This browser's Better Auth account; `null` when signed out. Throws on a failed request. */
async function sessionAccount() {
  return (await $fetch<{ user: SessionAccount } | null>('/api/auth/get-session', { retry: 0, timeout: 30_000 }))?.user ?? null
}

/** Only for what to offer: the console checks the role itself. */
const isPlatformTeam = (account: SessionAccount | null) => (account?.role ?? '').split(',').map(r => r.trim()).includes('superadmin')

/**
 * What the signed-in account may open instead of `workspace` at `currentSlug`; `null` when nothing (a
 * customer). Throws when it can't be checked: a sign-in then keeps the session and offers Try again
 * instead of signing out an account that may work here (Q4).
 */
export async function accessInstead(currentSlug: string, workspace: Workspace): Promise<OtherAccess | null> {
  const [cafes, account] = await Promise.all([fetchAccountCafes(), sessionAccount()])
  return otherAccess(cafes, currentSlug, workspace, isPlatformTeam(account))
}

/** A session the workspace refused, met on arriving at its sign-in: whose it is and where it may go. */
export interface RefusedSession {
  email: string
  /** `null`: a refused sign-in whose check failed (Q4); arriving signed in, it's always known. */
  access: OtherAccess | null
}

/**
 * Opening a workspace's sign-in already signed in (its own session check said 403): the account and
 * what it may open instead, even nothing, so the page says so instead of a form that would refuse it
 * again (D239). Signed out, a guest, or any failure: `null`, the form.
 */
export async function refusedSession(currentSlug: string, workspace: Workspace): Promise<RefusedSession | null> {
  try {
    const account = await sessionAccount()
    if (!account || account.isAnonymous) return null
    const cafes = await fetchAccountCafes()
    // It opens here after all (the workspace's check failed for another reason): the form.
    if (cafes.some(cafe => cafe.slug === currentSlug && cafe.workspaces.includes(workspace))) return null
    const access = otherAccess(cafes, currentSlug, workspace, isPlatformTeam(account))
    return { email: account.email, access: access ?? NO_OTHER_ACCESS }
  }
  catch {
    return null
  }
}
