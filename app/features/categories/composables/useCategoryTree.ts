import type { Category } from '#shared/contracts/menu'
import { mergeOrder, moveItem } from '../schemas/category-sort'
import type { CategoryTree, TreeOrder } from '../schemas/category-tree'
import { buildTree, countStatuses, filterTree, orderOf, sortOrderChanges } from '../schemas/category-tree'
import { useCategoryMutations } from './useCategories'

/**
 * The categories page as a tree (docs/plans/list-ui-refresh.md, D37): the whole list is loaded
 * (it's small), filtered and counted on the client, and ordered by drag and drop per level:
 * main categories among themselves, sub-categories within their main.
 *
 * - Reordering is available only with no search and no status filter (the whole tree is shown).
 * - A new order is local until saved, and counts as unsaved (route change, logout, reload ask).
 * - Save sends every list that changed, whole and numbered from 1 (`sortOrderChanges`).
 */
export function useCategoryTree(
  filters: { search: string, status: string },
  /** Rows to leave out, e.g. deleted ones before the refetch arrives. */
  hidden: (id: string) => boolean = () => false,
) {
  // No empty-list default: `loading` means "no data yet", and an empty default would count as
  // data, showing the empty state instead of the placeholders during the first load.
  const { data, loading, refreshing, error, refresh } = useApiQuery('categories:tree', () => apiFetch<Category[]>('/admin/categories'))
  const categories = computed<Category[]>(() => (data.value ?? []).filter(c => !hidden(c.id)))
  const serverTree = computed(() => buildTree(categories.value))
  const serverOrder = computed(() => orderOf(serverTree.value))

  /** Only the whole tree can be reordered: with a search or status filter, parts are hidden. */
  const sortable = computed(() => !filters.search && filters.status === ANY)

  const { reorder } = useCategoryMutations()
  const saving = computed(() => reorder.pending)

  const order = reactive<TreeOrder>({ mains: [], subs: {} })
  const unsaved = useUnsavedChanges(order, { paused: saving, onDiscard: reset })

  /** Back to the server's order. */
  function reset() {
    order.mains = [...serverOrder.value.mains]
    order.subs = Object.fromEntries(Object.entries(serverOrder.value.subs).map(([main, ids]) => [main, [...ids]]))
    unsaved.markClean()
  }

  // Fresh data: take the server order, unless the user is mid-change; then keep their order and
  // only add or drop categories that appeared or disappeared elsewhere.
  watch(serverOrder, (next) => {
    if (!unsaved.isDirty.value) return reset()
    order.mains = mergeOrder(order.mains, next.mains)
    order.subs = Object.fromEntries(Object.entries(next.subs).map(([main, ids]) => [main, mergeOrder(order.subs[main] ?? [], ids)]))
  }, { immediate: true })

  /** The server tree in the local order. */
  const orderedTree = computed<CategoryTree>(() => {
    const groups = new Map(serverTree.value.groups.map(g => [g.main.id, g]))
    return {
      groups: order.mains.flatMap((id) => {
        const group = groups.get(id)
        if (!group) return []
        const subs = new Map(group.subs.map(s => [s.id, s]))
        return [{ main: group.main, subs: (order.subs[id] ?? []).flatMap(subId => subs.get(subId) ?? []) }]
      }),
      orphans: serverTree.value.orphans,
    }
  })

  const tree = computed(() => filterTree(orderedTree.value, filters))
  const counts = computed(() => countStatuses(categories.value, filters.search))

  /** Moves a main category by its position in the list shown. */
  function moveMain(from: number, to: number) {
    order.mains = moveItem(orderedTree.value.groups.map(g => g.main.id), from, to)
  }

  /** Moves a sub-category within its main category. */
  function moveSub(mainId: string, from: number, to: number) {
    const group = orderedTree.value.groups.find(g => g.main.id === mainId)
    if (!group) return
    order.subs = { ...order.subs, [mainId]: moveItem(group.subs.map(s => s.id), from, to) }
  }

  async function save() {
    const body = sortOrderChanges(serverOrder.value, order)
    if (!body.lists.length) return reset()
    // The refetch (invalidate) brings the saved order; mark clean so it's taken as is.
    const result = await reorder.execute(body)
    if (result.ok) unsaved.markClean()
  }

  return {
    tree,
    counts,
    total: computed(() => categories.value.length),
    loading,
    refreshing,
    error,
    refresh,
    sortable,
    saving,
    isDirty: unsaved.isDirty,
    moveMain,
    moveSub,
    save,
    reset,
  }
}
