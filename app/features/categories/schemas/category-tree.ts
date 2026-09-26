import type { CategoryResponse, CategorySortOrderUpdateRequest } from '~/generated/api'
import { bySortOrder } from './category-sort'

/**
 * Categories as the tree they are: main categories with their sub-categories
 * (docs/plans/list-ui-refresh.md, D37).
 */
export interface CategoryGroup {
  main: CategoryResponse
  subs: CategoryResponse[]
  /** The main is shown only as the context of matching sub-categories (it doesn't match itself). */
  contextOnly?: boolean
}

export interface CategoryTree {
  groups: CategoryGroup[]
  /** Sub-categories whose main category isn't in the list (e.g. deleted elsewhere). */
  orphans: CategoryResponse[]
}

const isSub = (c: CategoryResponse) => c.mainCategoryId !== undefined && c.mainCategoryId !== null

/** Mains in their sort order, each with its subs in theirs. */
export function buildTree(categories: CategoryResponse[]): CategoryTree {
  const mains = bySortOrder(categories.filter(c => !isSub(c)))
  const mainIds = new Set(mains.map(m => m.id))
  const subs = bySortOrder(categories.filter(isSub))
  return {
    groups: mains.map(main => ({ main, subs: subs.filter(s => s.mainCategoryId === main.id) })),
    orphans: subs.filter(s => !mainIds.has(s.mainCategoryId!)),
  }
}

export interface TreeFilters {
  search?: string
  status?: string
}

function matches(category: CategoryResponse, { search, status }: TreeFilters) {
  const text = search?.trim().toLowerCase()
  if (text && !(category.categoryName ?? '').toLowerCase().includes(text)) return false
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
export function countStatuses(categories: CategoryResponse[], search?: string) {
  const found = categories.filter(c => matches(c, { search }))
  const ACTIVE = found.filter(c => c.status === 'ACTIVE').length
  const INACTIVE = found.filter(c => c.status === 'INACTIVE').length
  return { ACTIVE, INACTIVE, all: ACTIVE + INACTIVE }
}

/**
 * An order of the tree: mains, and the subs of each main (by main id). Sub-categories are
 * numbered **per main category** (user decision, resolves Q20).
 */
export interface TreeOrder {
  mains: number[]
  subs: Record<number, number[]>
}

export function orderOf(tree: CategoryTree): TreeOrder {
  return {
    mains: tree.groups.map(g => g.main.id!),
    subs: Object.fromEntries(tree.groups.map(g => [g.main.id!, g.subs.map(s => s.id!)])),
  }
}

const same = (a: number[] = [], b: number[] = []) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * Body for `PUT /staff/categories/sort-order`: every list that changed, **whole**, numbered from 1
 * (the mains; the subs of each main separately). Unchanged lists aren't sent.
 */
export function sortOrderChanges(server: TreeOrder, local: TreeOrder): CategorySortOrderUpdateRequest {
  const lists = [
    ...(same(server.mains, local.mains) ? [] : [local.mains]),
    ...Object.entries(local.subs)
      .filter(([main, ids]) => !same(server.subs[Number(main)], ids))
      .map(([, ids]) => ids),
  ]
  return { items: lists.flatMap(ids => ids.map((id, index) => ({ id, sortOrder: index + 1 }))) }
}
