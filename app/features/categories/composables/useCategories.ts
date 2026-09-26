import type { CategoryRecordCreation, CategoryRecordUpdate, GetCategoriesPageData } from '~/generated/api'
import { createCategory1, deleteCategory1, getCategoriesPage, updateCategory1 } from '~/generated/api'

export type CategoryListQuery = NonNullable<GetCategoriesPageData['query']>

/** Paginated category list. Refetches whenever `query` changes. */
export function useCategoryList(query: MaybeRefOrGetter<CategoryListQuery>) {
  return useAsyncData('categories:list', () => unwrap(getCategoriesPage({ query: toValue(query) })), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** Category mutations. Each one refreshes cached data that shows categories. */
export function useCategoryMutations() {
  // Products display their category, so their lists go stale too.
  const refresh = () => invalidate('categories', 'products')

  return {
    async create(body: CategoryRecordCreation) {
      const category = await unwrap(createCategory1({ body }))
      await refresh()
      return category
    },
    async update(id: number, body: CategoryRecordUpdate) {
      const category = await unwrap(updateCategory1({ path: { id }, body }))
      await refresh()
      return category
    },
    async remove(id: number) {
      await unwrap(deleteCategory1({ path: { id } }))
      await refresh()
    },
  }
}
