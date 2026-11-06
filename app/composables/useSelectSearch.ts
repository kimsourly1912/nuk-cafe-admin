import type { MaybeRefOrGetter } from 'vue'

/**
 * The `search-input` prop of a `USelectMenu`. Opening the menu focuses its search box, which on a
 * phone or tablet raises the on-screen keyboard over the list. So below `lg` (< 1024px) the box is not
 * focused; the list is, and a tap on the box starts the search. From `lg` up it stays focused so
 * typing searches at once. Width only, like every layout choice here (useLayoutContext).
 *
 * @example
 * const search = useSelectSearch({ placeholder: 'Search time zones…' })
 * <USelectMenu :search-input="search" />
 */
export function useSelectSearch(input: MaybeRefOrGetter<Record<string, unknown>>) {
  const { isExpanded } = useLayoutContext()
  return computed(() => ({ ...toValue(input), autofocus: isExpanded.value }))
}
