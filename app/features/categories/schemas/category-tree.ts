import type { MenuCategory, ReorderCategoriesInput } from '#shared/contracts/menu-categories'
import { bySortOrder } from './category-sort'

/**
 * Categories as the tree they are: main categories with their sub-categories
 * (docs/plans/list-ui-refresh.md, D37; the new API: D55).
 */
export interface CategoryGroup {
  main: MenuCategory
  subs: MenuCategory[]
  /** The main is shown only as the context of matching sub-categories (it doesn't match itself). */
  contextOnly?: boolean
}

export interface CategoryTree {
  groups: CategoryGroup[]
  /** Sub-categories whose main category isn't in the list. */
  orphans: MenuCategory[]
}

const isSub = (c: MenuCategory) => c.parentId !== null

/** Mains in their sort order, each with its subs in theirs. */
export function buildTree(categories: MenuCategory[]): CategoryTree {
  const mains = bySortOrder(categories.filter(c => !isSub(c)))
  const mainIds = new Set(mains.map(m => m.id))
  const subs = bySortOrder(categories.filter(isSub))
  return {
    groups: mains.map(main => ({ main, subs: subs.filter(s => s.parentId === main.id) })),
    orphans: subs.filter(s => !mainIds.has(s.parentId!)),
  }
}

export interface TreeFilters {
  search?: string
  status?: string
}

function matches(category: MenuCategory, { search, status }: TreeFilters) {
  const text = search?.trim().toLowerCase()
  if (text && !category.name.toLowerCase().includes(text)) return false
  // Only a real status narrows; "all" (`ANY`) or none doesn't.
  if ((status === 'active' || status === 'archived') && category.status !== status) return false
  return true
}

/**
 * The tree narrowed by search and status. A main that matches keeps its matching subs; a main
 * that doesn't match is still shown, marked `contextOnly`, when some of its subs match, so a sub
 * is never shown without its parent.
 */
export function filterTree(tree: CategoryTree, filters: TreeFilters): CategoryTree {
  const groups = tree.groups.flatMap((group) => {
    const subs = group.subs.filter(s => matches(s, filters))
    if (matches(group.main, filters)) return [{ main: group.main, subs }]
    return subs.length ? [{ main: group.main, subs, contextOnly: true }] : []
  })
  return { groups, orphans: tree.orphans.filter(s => matches(s, filters)) }
}

/** How many categories each status has under the current search (for the status tabs). */
export function countStatuses(categories: MenuCategory[], search?: string) {
  const found = categories.filter(c => matches(c, { search }))
  const active = found.filter(c => c.status === 'active').length
  const archived = found.filter(c => c.status === 'archived').length
  return { active, archived, all: active + archived }
}

/**
 * An order of the tree's **active** categories: mains, and the subs of each main (by main id).
 * Sub-categories are numbered per main category (D37); archived ones have no place in the order.
 */
export interface TreeOrder {
  mains: string[]
  subs: Record<string, string[]>
}

export function orderOf(tree: CategoryTree): TreeOrder {
  const active = (list: MenuCategory[]) => list.filter(c => c.status === 'active').map(c => c.id)
  const mains = tree.groups.filter(g => g.main.status === 'active')
  return {
    mains: mains.map(g => g.main.id),
    subs: Object.fromEntries(mains.map(g => [g.main.id, active(g.subs)])),
  }
}

const same = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * The requests that save a new order: one per list that changed (the mains; the subs of each main
 * separately), each listing every active child of that parent with the version read. The server
 * refuses a list that no longer matches the parent's children or names an old version (409).
 */
export function reorderRequests(server: TreeOrder, local: TreeOrder, versions: Map<string, number>): ReorderCategoriesInput[] {
  const request = (parentId: string | null, ids: string[]): ReorderCategoriesInput =>
    ({ parentId, items: ids.map(id => ({ id, version: versions.get(id) ?? 0 })) })
  return [
    ...(same(server.mains, local.mains) ? [] : [request(null, local.mains)]),
    ...Object.entries(local.subs)
      .filter(([main, ids]) => !same(server.subs[main], ids))
      .map(([main, ids]) => request(main, ids)),
  ]
}
