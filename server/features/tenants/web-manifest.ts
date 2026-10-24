import type { CafeProfile } from '#shared/contracts/cafe'
import type { Workspace } from '#shared/contracts/account'

/**
 * A cafe's installable app (D202, docs/plans/installable-app.md): the web app manifest of its
 * counter or its admin. Only what the cafe's public profile already shows (its name); no session,
 * no tenant id. Scope: the workspace itself (D204). Chrome offers Install only on a page outside every
 * installed app's scope, so `/` let one device hold one app from the site. Its sign-in is inside;
 * Your cafes and the account pages open with the browser's bar. One platform icon for every cafe (D204).
 */
export interface WebManifest {
  id: string
  name: string
  short_name: string
  start_url: string
  scope: string
  display: 'standalone'
  background_color: string
  theme_color: string
  icons: { src: string, sizes: string, type: 'image/png', purpose: 'any' | 'maskable' }[]
}

const LABELS: Record<Workspace, string> = { admin: 'Admin', counter: 'Counter' }

/** The light background (`--ui-bg`): the splash screen and the title bar. */
const BACKGROUND = '#ffffff'

const ICONS: WebManifest['icons'] = [
  { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

export function webManifest(profile: CafeProfile, workspace: Workspace): WebManifest {
  const home = `/c/${profile.slug}/${workspace}`
  return {
    // Distinct per cafe and workspace: one tablet can install a cafe's counter and admin, or two cafes.
    id: home,
    name: `${profile.name} ${LABELS[workspace]}`,
    short_name: LABELS[workspace],
    start_url: home,
    scope: home,
    // Not `fullscreen`: staff keep the clock and the battery.
    display: 'standalone',
    background_color: BACKGROUND,
    theme_color: BACKGROUND,
    icons: ICONS,
  }
}
