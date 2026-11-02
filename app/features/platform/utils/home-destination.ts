import type { AccountCafe } from '#shared/contracts/cafe'
// Your cafes, `/cafes` (not the console's `/platform/cafes`).
import { CAFES_PATH, PLATFORM_CONSOLE_PATH, workspaceUrl } from '~/utils/account-cafes'

/** Where the site's root sends a signed-in account (D221 follow-up): one button in its header. */
export interface HomeDestination {
  label: string
  icon: string
  to: string
  /** A workspace or the console: a full page load, like Your cafes' buttons (D141). */
  external: boolean
  /** The cafe it opens, for the button's accessible name. */
  cafeName?: string
}

/** Your cafes: also where to go when the cafes can't be read here (that page shows why and retries). */
export const YOUR_CAFES: HomeDestination = { label: 'Your cafes', icon: 'i-lucide-store', to: CAFES_PATH, external: false }

/**
 * Exactly one workspace at one active cafe opens it directly; several, or a platform team account
 * that also works at a cafe, go to Your cafes (it lists the console too); the team alone, the
 * console. `null` for a customer: nothing to open. Only for what to show: each place checks access.
 */
export function homeDestination(cafes: readonly AccountCafe[], platform: boolean): HomeDestination | null {
  const doors = cafes
    .filter(cafe => cafe.status === 'active')
    .flatMap(cafe => cafe.workspaces.map(workspace => ({ cafe, workspace })))
  const only = doors.length === 1 && !platform ? doors[0] : undefined
  if (only) {
    const admin = only.workspace === 'admin'
    return {
      label: admin ? 'Open admin' : 'Open counter',
      icon: admin ? 'i-lucide-layout-dashboard' : 'i-lucide-receipt',
      to: workspaceUrl(only.cafe.slug, only.workspace),
      external: true,
      cafeName: only.cafe.name,
    }
  }
  // A paused cafe opens nothing, but Your cafes says why.
  if (cafes.length) return YOUR_CAFES
  if (platform) return { label: 'Platform console', icon: 'i-lucide-layers', to: PLATFORM_CONSOLE_PATH, external: true }
  return null
}
