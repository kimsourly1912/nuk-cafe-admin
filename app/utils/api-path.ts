/**
 * Where a call to our API goes (D140). A cafe's routes live under its address
 * (`/api/c/<slug>/admin/…`, `…/counter/…`, `…/public/…`, `…/shop/…`), so feature code keeps
 * calling `'/admin/menu/items'` and this adds the cafe in one place. Anything else (`/auth/…`,
 * `/tables/<token>`, `/health`) is the platform's and goes as it is.
 *
 * @example
 * apiPath('/admin/menu/items', 'nuk') // '/c/nuk/admin/menu/items'
 * apiPath('/tables/abc', 'nuk') // '/tables/abc'
 */
export function apiPath(path: string, tenant: string): string {
  return /^\/(?:admin|counter|public|shop)(?:[/?]|$)/.test(path) ? `/c/${encodeURIComponent(tenant)}${path}` : path
}
