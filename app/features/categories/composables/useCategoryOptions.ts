import type { GetAllCategoriesData } from '~/generated/api'
import { getAllCategories } from '~/generated/api'

export type CategoryOptionsFilter = NonNullable<GetAllCategoriesData['query']>

/**
 * PUBLIC. Unpaginated categories for pickers (e.g. `type: 'MAIN'` for parent selects).
 * Keyed per filter so different pickers don't overwrite each other.
 */
export function useCategoryOptions(filter: MaybeRefOrGetter<CategoryOptionsFilter> = {}) {
  return useApiQuery(
    () => {
      const { type, mainCategoryId } = toValue(filter)
      return `categories:options:${type ?? 'all'}:${mainCategoryId ?? 'all'}`
    },
    () => unwrap(getAllCategories({ query: toValue(filter) })),
    { default: () => [] },
  )
}
