import type { WatchSource } from 'vue'

/** TanStack's RowSelectionState: row id → selected. */
type RowSelectionState = Record<string, boolean>

/**
 * Row selection for `UTable`, keyed by id so it survives list refreshes.
 *
 * - `selected` only contains rows currently in `rows`, so deleted rows drop out on their own.
 * - Selection is cleared whenever a `resetOn` source changes (filters, page), so nobody acts
 *   on rows they can no longer see.
 *
 * @example
 * const selection = useTableSelection(rows, c => c.id!, { resetOn: [query] })
 * <UTable v-model:row-selection="selection.rowSelection" :get-row-id="selection.getRowId" ...>
 */
export function useTableSelection<T>(
  rows: MaybeRefOrGetter<T[]>,
  getKey: (row: T) => string | number,
  options: { resetOn?: WatchSource[] } = {},
) {
  const rowSelection = ref<RowSelectionState>({})
  const getRowId = (row: T) => String(getKey(row))

  const selected = computed(() => toValue(rows).filter(row => rowSelection.value[getRowId(row)]))

  function clear() {
    rowSelection.value = {}
  }

  /** Replace the selection with these keys (e.g. keep only the rows that failed). */
  function select(keys: (string | number)[]) {
    rowSelection.value = Object.fromEntries(keys.map(key => [String(key), true]))
  }

  if (options.resetOn?.length) watch(options.resetOn, clear, { deep: true })

  return reactive({
    rowSelection,
    getRowId,
    selected,
    count: computed(() => selected.value.length),
    clear,
    select,
  })
}
