/**
 * A cafe's pages live under its address (D141): `/c/<slug>/` the menu, `/c/<slug>/admin/…`,
 * `/c/<slug>/counter/…`, `/c/<slug>/checkout`, `/c/<slug>/orders/…`. Feature code names pages by
 * their path inside the cafe (`'/admin/products'`) and turns them into addresses here, through
 * `useTenantPath()` in components. The platform's pages (`/sign-in`, `/table/<token>`, …) have no
 * cafe.
 */

const CAFE_URL = /^\/c\/([a-z0-9-]+)(?=[/?#]|$)/

/** The address of a page inside a cafe: `tenantUrl('nuk', '/admin')` → `/c/nuk/admin`; `'/'` → `/c/nuk`. */
export function tenantUrl(slug: string, path: string): string {
  return path === '/' || path === '' ? `/c/${slug}` : `/c/${slug}${path}`
}

/**
 * Splits an address into its cafe and the path inside it: `/c/nuk/admin?x=1` → `{ slug: 'nuk',
 * path: '/admin?x=1' }`, `/c/nuk` → `{ slug: 'nuk', path: '/' }`. `null` for the platform's pages.
 */
export function splitTenantUrl(url: string): { slug: string, path: string } | null {
  const match = CAFE_URL.exec(url)
  if (!match) return null
  const rest = url.slice(match[0].length)
  return { slug: match[1]!, path: rest === '' || rest.startsWith('?') || rest.startsWith('#') ? `/${rest}` : rest }
}
