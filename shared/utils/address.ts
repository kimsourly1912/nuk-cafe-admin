/**
 * One address per page (D208): without a trailing slash, as `tenantUrl` builds them (`/c/nuk`, never
 * `/c/nuk/`). Pages compare `route.path` with those addresses, so `/c/nuk/admin/` would light no
 * sidebar item and keep a signed-in admin on `/c/nuk/admin/login/`. Shared by the server's redirect
 * and the router's; server code imports it as `#shared/utils/address`.
 */

/** Path segments of URL characters, then the slashes to drop. No empty segment: `//host/` can't pass. */
const SLASHED_PAGE = /^(?:\/[\w.~%!$&'()*+,;=:@-]+)+\/+$/
/** The API, Nuxt's and Vite's own files: not pages. */
const NOT_A_PAGE = /^\/(?:api(?:\/|$)|[_@])/

/**
 * The address without its trailing slashes, the query and hash kept: `/c/nuk/?table=1` →
 * `/c/nuk?table=1`. `null` when there is nothing to change: no trailing slash, the site's root, the
 * API or Nuxt's files, or a path that could read as another site (`//evil.example/`).
 */
export function withoutTrailingSlash(address: string): string | null {
  const end = address.search(/[?#]/)
  const path = end === -1 ? address : address.slice(0, end)
  if (!SLASHED_PAGE.test(path) || NOT_A_PAGE.test(path)) return null
  return path.replace(/\/+$/, '') + (end === -1 ? '' : address.slice(end))
}
