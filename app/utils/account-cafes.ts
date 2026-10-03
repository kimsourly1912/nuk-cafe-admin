import type { Workspace } from '#shared/contracts/account'
import type { AccountCafe } from '#shared/contracts/cafe'
import { apiFetch } from './api'
import { tenantUrl } from './tenant-path'

/**
 * The cafes one account works in (T2c, D144). Your cafes and the switcher read them through the
 * cafe feature's `useAccountCafes()`; the admin and counter sign-ins ask once, when the account
 * isn't let in here, whether it works elsewhere.
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

/**
 * The code of a sign-in refused here for an account that works at another cafe (T2c, D144): the
 * account stays signed in and the page offers Your cafes, instead of a dead end.
 */
export const WORKS_ELSEWHERE = 'WORKS_ELSEWHERE'

/** Whether the signed-in account may open `workspace` at a cafe other than `currentSlug`. Any failure: no. */
export async function worksElsewhere(currentSlug: string, workspace: Workspace): Promise<boolean> {
  try {
    return otherCafes(await fetchAccountCafes(), currentSlug, workspace).length > 0
  }
  catch {
    return false
  }
}
