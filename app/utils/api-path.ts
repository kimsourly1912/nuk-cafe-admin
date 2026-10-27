/**
 * Where a call to our API goes (D140). A cafe's routes live under its address
 * (`/api/c/<slug>/admin/…`, `…/counter/…`, `…/public/…`, `…/shop/…`), so feature code keeps
 * calling `'/admin/menu/items'` and this adds the cafe in one place. Anything else (`/auth/…`,
 * `/tables/<token>`, `/health`) is the platform's and goes as it is.
 *
 * A cafe's route from a page without a cafe (`tenant` `null`: the platform's pages) throws instead
 * of guessing one (D221): a request to the wrong cafe would succeed for someone with access there.
 *
 * @example
 * apiPath('/admin/menu/items', 'nuk') // '/c/nuk/admin/menu/items'
 * apiPath('/tables/abc', null) // '/tables/abc'
 * apiPath('/shop/me', null) // throws
 */
export function apiPath(path: string, tenant: string | null): string {
  if (!/^\/(?:admin|counter|public|shop)(?:[/?]|$)/.test(path)) return path
  if (!tenant) throw new Error(`A cafe's API (${path.split('?')[0]}) was called from a page without a cafe in its address.`)
  return `/c/${encodeURIComponent(tenant)}${path}`
}
