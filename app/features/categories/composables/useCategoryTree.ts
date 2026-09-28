import type { MenuCategory } from '#shared/contracts/menu-categories'
import { mergeOrder, moveItem } from '../schemas/category-sort'
import type { CategoryTree, TreeOrder } from '../schemas/category-tree'
import { buildTree, countStatuses, filterTree, orderOf, reorderRequests } from '../schemas/category-tree'
import { useCategoryMutations } from './useCategories'
import { useAllCategories } from './useCategoryOptions'

/**
 * The categories page as a tree (docs/plans/list-ui-refresh.md, D37): the whole list is loaded
 * (it's small), filtered and counted on the client, and ordered by drag and drop per level:
 * main categories among themselves, sub-categories within their main.
 *
 * - Reordering is available only with no search and the Active tab (every active category shown);
 *   archived categories have no place in the order.
 * - A new order is local until saved, and counts as unsaved (route change, logout, reload ask).
 * - Save sends one request per list that changed, each with every active child and its version
 *   (`reorderRequests`), one after the other; a failure stops and keeps the order unsaved.
 * - After a refused save (someone else changed a level: 409), `reload()` fetches the latest
 *   categories and versions while keeping the local order (new or removed categories merged in),
 *   so Save can be tried again without redoing the moves (D72).
 */
export function useCategoryTree(
  filters: { search: string, status: string },
  /** Rows to leave out, e.g. deleted ones before the refetch arrives. */
  hidden: (id: string) => boolean = () => false,
) {
  // No empty-list default: `loading` means "no data yet", and an empty default would count as
  // data, showing the empty state instead of the placeholders during the first load.
  const { data, loading, refreshing, error, refresh } = useAllCategories()
  const categories = computed<MenuCategory[]>(() => (data.value ?? []).filter(c => !hidden(c.id)))
  const serverTree = computed(() => buildTree(categories.value))
  const serverOrder = computed(() => orderOf(serverTree.value))

  /** Only the whole active tree can be reordered: with a search or another tab, parts are hidden. */
  const sortable = computed(() => !filters.search && filters.status === 'active')

  const { reorder } = useCategoryMutations()
  const saving = ref(false)
  /** Why the last save stopped (kept until the next save or reload). */
  const saveError = shallowRef<ApiError>()
  const notify = useNotify()

  const order = reactive<TreeOrder>({ mains: [], subs: {} })
  const unsaved = useUnsavedChanges(order, { paused: saving, onDiscard: reset })

  /** Back to the server's order. */
  function reset() {
    saveError.value = undefined
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

  /**
   * The server tree in the local order. The order holds only active categories (archived ones have
   * no position); archived ones follow the active ones at each level, in the server's order.
   */
  const orderedTree = computed<CategoryTree>(() => {
    const groups = new Map(serverTree.value.groups.map(g => [g.main.id, g]))
    const archivedMains = serverTree.value.groups.filter(g => g.main.status === 'archived').map(g => g.main.id)
    return {
      groups: [...order.mains, ...archivedMains].flatMap((id) => {
        const group = groups.get(id)
        if (!group) return []
        const subs = new Map(group.subs.map(s => [s.id, s]))
        // A main without an order entry (an archived one) keeps its active subs in server order,
        // so no category is ever left out of the tree.
        const active = order.subs[id]
          ? order.subs[id].flatMap(subId => subs.get(subId) ?? [])
          : group.subs.filter(s => s.status === 'active')
        return [{ main: group.main, subs: [...active, ...group.subs.filter(s => s.status === 'archived')] }]
      }),
      orphans: serverTree.value.orphans,
    }
  })

  const tree = computed(() => filterTree(orderedTree.value, filters))
  const counts = computed(() => countStatuses(categories.value, filters.search))

  // Moves happen only on the Active tab (`sortable`), where positions count active categories.
  const activeIds = (list: MenuCategory[]) => list.filter(c => c.status === 'active').map(c => c.id)

  /** Moves a main category by its position in the list shown. */
  function moveMain(from: number, to: number) {
    order.mains = moveItem(activeIds(orderedTree.value.groups.map(g => g.main)), from, to)
  }

  /** Moves a sub-category within its main category. */
  function moveSub(mainId: string, from: number, to: number) {
    const group = orderedTree.value.groups.find(g => g.main.id === mainId)
    if (!group) return
    order.subs = { ...order.subs, [mainId]: moveItem(activeIds(group.subs), from, to) }
  }

  async function save() {
    const versions = new Map(categories.value.map(c => [c.id, c.version]))
    const requests = reorderRequests(serverOrder.value, order, versions)
    if (!requests.length) return reset()
    saving.value = true
    saveError.value = undefined
    // One level at a time; each is atomic on the server. A failure stops here: the levels already
    // saved stay saved, and the refetch brings them back as the server order.
    let ok = true
    for (const request of requests) {
      const result = await reorder.execute(request)
      if (!result.ok) {
        if (result.status === 'error') saveError.value = result.error
        ok = false
        break
      }
    }
    saving.value = false
    // The refetch (invalidate) brings the saved order; mark clean so it's taken as is.
    if (ok) {
      unsaved.markClean()
      notify.success('Category order saved')
    }
  }

  /** The latest categories and versions; a pending order is kept (merged by the watch above). */
  async function reload() {
    await refresh()
    saveError.value = undefined
  }

  return {
    /** Every category loaded, archived ones included. */
    categories,
    tree,
    counts,
    total: computed(() => categories.value.length),
    loading,
    refreshing,
    error,
    refresh,
    sortable,
    saving,
    saveError,
    reload,
    isDirty: unsaved.isDirty,
    moveMain,
    moveSub,
    save,
    reset,
  }
}
