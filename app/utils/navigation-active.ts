import type { NavigationMenuItem } from '@nuxt/ui'

/**
 * Marks the item whose page the person is on, or a page under it: `/admin/branches/<id>` keeps
 * Branch active, `/admin/products/new` Menu items. The router alone can't: a record's own page is a
 * sibling route, not a child, so its link reads inactive. `/admin` (Dashboard) matches only itself.
 */
export function withActiveItem(groups: NavigationMenuItem[][], path: string): NavigationMenuItem[][] {
  return groups.map(group => group.map((item) => {
    if (typeof item.to !== 'string') return item
    const to = item.to
    const active = path === to || (to !== '/admin' && path.startsWith(`${to}/`))
    return { ...item, active }
  }))
}
