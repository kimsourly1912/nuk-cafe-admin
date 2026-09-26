import type { Category, ReorderCategoriesBody } from '#shared/contracts/menu'
import { bySortOrder } from './category-sort'

/**
 * Categories as the tree they are: main categories with their sub-categories
 * (docs/plans/list-ui-refresh.md, D37).
 */
export interface CategoryGroup {
  main: Category
  subs: Category[]
  /** The main is shown only as the context of matching sub-categories (it doesn't match itself). */
  contextOnly?: boolean
}

export interface CategoryTree {
  groups: CategoryGroup[]
  /** Sub-categories whose main category isn't in the list (e.g. deleted elsewhere). */
  orphans: Category[]
}

const isSub = (c: Category) => c.parentId !== null

/** Mains in their sort order, each with its subs in theirs. */
export function buildTree(categories: Category[]): CategoryTree {
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

function matches(category: Category, { search, status }: TreeFilters) {
  const text = search?.trim().toLowerCase()
  if (text && !category.name.toLowerCase().includes(text)) return false
  // Only a real status narrows; "all" (`ANY`) or none doesn't.
  if ((status === 'ACTIVE' || status === 'INACTIVE') && category.status !== status) return false
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
export function countStatuses(categories: Category[], search?: string) {
  const found = categories.filter(c => matches(c, { search }))
  const ACTIVE = found.filter(c => c.status === 'ACTIVE').length
  const INACTIVE = found.filter(c => c.status === 'INACTIVE').length
  return { ACTIVE, INACTIVE, all: ACTIVE + INACTIVE }
}

/**
 * An order of the tree: mains, and the subs of each main (by main id). Sub-categories are
 * numbered **per main category** (D37).
 */
export interface TreeOrder {
  mains: string[]
  subs: Record<string, string[]>
}

export function orderOf(tree: CategoryTree): TreeOrder {
  return {
    mains: tree.groups.map(g => g.main.id),
    subs: Object.fromEntries(tree.groups.map(g => [g.main.id, g.subs.map(s => s.id)])),
  }
}

const same = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * Body for `PUT /api/v1/admin/categories/order`: every list that changed, **whole** (the mains;
 * the subs of each main separately). Unchanged lists aren't sent. The server numbers them from 1
 * and rejects a list that no longer matches the current children (ORDER_STALE).
 */
export function sortOrderChanges(server: TreeOrder, local: TreeOrder): ReorderCategoriesBody {
  return {
    lists: [
      ...(same(server.mains, local.mains) ? [] : [{ parentId: null, ids: local.mains }]),
      ...Object.entries(local.subs)
        .filter(([main, ids]) => !same(server.subs[main], ids))
        .map(([main, ids]) => ({ parentId: main, ids })),
    ],
  }
}
