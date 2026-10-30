import type { NavigationMenuItem } from '@nuxt/ui'

/**
 * The sidebar without the pages the session may not open (`allows`, from each page's `permission`
 * meta, D240), and without a group left with only its label.
 */
export function allowedNavigation(groups: NavigationMenuItem[][], allows: (to: string) => boolean): NavigationMenuItem[][] {
  return groups
    .map(group => group.filter(item => typeof item.to !== 'string' || allows(item.to)))
    .filter(group => group.some(item => item.type !== 'label'))
}
