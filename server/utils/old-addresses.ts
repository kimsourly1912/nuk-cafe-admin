/** A cafe's pages that once lived at the site's root (D93), before cafe addresses (D141). */
const OLD_CAFE_PAGE = /^\/(?:(?:admin|counter|orders)(?:[/?#]|$)|checkout(?:[?#]|$)|(?:[?#]|$))/

/**
 * Where an address from before cafe addresses goes now: `/admin/products?x=1` →
 * `/c/<slug>/admin/products?x=1`, `/` → `/c/<slug>`. `null` for everything else (the platform's
 * pages, the API, assets).
 */
export function oldAddressTarget(path: string, slug: string): string | null {
  if (!OLD_CAFE_PAGE.test(path)) return null
  return path === '/' || path.startsWith('/?') || path.startsWith('/#') ? `/c/${slug}${path.slice(1)}` : `/c/${slug}${path}`
}

/**
 * A cafe page at the cafe's former address, moved to its current one (D142):
 * `/c/old/admin?x=1` → `/c/new/admin?x=1`. The rest of the path and the query stay.
 */
export function movedCafeTarget(path: string, slug: string): string {
  return path.replace(/^\/c\/[^/?#]+/, `/c/${slug}`)
}
