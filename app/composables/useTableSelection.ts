import type { WatchSource } from 'vue'

/** TanStack's RowSelectionState: row id → selected. */
type RowSelectionState = Record<string, boolean>

/**
 * Row selection for `UTable`, card grids and trees, keyed by id so it survives list refreshes.
 *
 * - `selected` only contains rows currently in `rows`, so deleted rows drop out on their own.
 * - Selection is cleared whenever a `resetOn` source changes (filters, page), so nobody acts
 *   on rows they can no longer see.
 *
 * @example
 * const selection = useTableSelection(rows, c => c.id!, { resetOn: [query] })
 * <UTable v-model:row-selection="selection.rowSelection" :get-row-id="selection.getRowId" ...>
 * // Without a table (cards, trees):
 * <UCheckbox :model-value="selection.isSelected(row)" @update:model-value="selection.toggle(row, !!$event)" />
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

  function isSelected(row: T) {
    return !!rowSelection.value[getRowId(row)]
  }

  /** Select or unselect one row (flips it when `value` is omitted). */
  function toggle(row: T, value = !isSelected(row)) {
    const { [getRowId(row)]: _, ...rest } = rowSelection.value
    rowSelection.value = value ? { ...rest, [getRowId(row)]: true } : rest
  }

  /** Select or unselect every row currently in `rows`. */
  function toggleAll(value: boolean) {
    rowSelection.value = value ? Object.fromEntries(toValue(rows).map(row => [getRowId(row), true])) : {}
  }

  const count = computed(() => selected.value.length)

  if (options.resetOn?.length) watch(options.resetOn, clear, { deep: true })

  return reactive({
    rowSelection,
    getRowId,
    selected,
    count,
    /** Every row in `rows` is selected (and there is at least one). */
    allSelected: computed(() => count.value > 0 && count.value === toValue(rows).length),
    /** Some, but not all, rows are selected: for an "indeterminate" select-all checkbox. */
    someSelected: computed(() => count.value > 0 && count.value < toValue(rows).length),
    isSelected,
    toggle,
    toggleAll,
    clear,
    select,
  })
}
