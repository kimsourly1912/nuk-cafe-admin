import type { CategoryRecordCreation, CategoryRecordUpdate, CategoryResponse, GetCategoriesPageData } from '~/generated/api'
import { createCategory1, deleteCategory1, getCategoriesPage, updateCategory1 } from '~/generated/api'

export type CategoryListQuery = NonNullable<GetCategoriesPageData['query']>

const NOUN: [string, string] = ['category', 'categories']

/** Features whose cached data shows categories (products display their category). */
const AFFECTED = ['categories', 'products']

/** Paginated category list. Refetches whenever `query` changes. */
export function useCategoryList(query: MaybeRefOrGetter<CategoryListQuery>) {
  return useApiQuery('categories:list', () => unwrap(getCategoriesPage({ query: toValue(query) })), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/**
 * Category mutations. State is shared app-wide by mutation id, so e.g. a row knows it's
 * being saved even after the edit modal was closed.
 */
export function useCategoryMutations() {
  const create = useMutation(
    (body: CategoryRecordCreation) => unwrap(createCategory1({ body })),
    {
      id: 'categories:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.categoryName?.trim().toLowerCase() ?? '',
      successMessage: (_, body) => `Category "${body.categoryName}" created`,
      errorMessage: body => `Could not create "${body.categoryName}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: number, body: CategoryRecordUpdate }) => unwrap(updateCategory1({ path: { id }, body })),
    {
      id: 'categories:update',
      key: ({ id }) => id,
      successMessage: (_, { body }) => `Category "${body.categoryName}" updated`,
      errorMessage: ({ body }) => `Could not save "${body.categoryName}"`,
      invalidate: AFFECTED,
    },
  )

  const remove = useMutation(
    (category: CategoryResponse) => unwrap(deleteCategory1({ path: { id: category.id! } })),
    {
      id: 'categories:remove',
      key: category => category.id!,
      removes: true,
      confirm: category => ({
        title: `Delete "${category.categoryName}"?`,
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }),
      successMessage: (_, category) => `Category "${category.categoryName}" deleted`,
      errorMessage: category => `Could not delete "${category.categoryName}"`,
      invalidate: AFFECTED,
      batch: {
        noun: NOUN,
        verb: ['Deleting', 'deleted'],
        confirm: categories => ({
          title: `Delete ${pluralize(categories.length, NOUN)}?`,
          description: `${previewList(categories.map(c => c.categoryName ?? `#${c.id}`))}. This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        }),
        // Sub-categories first, so a main category isn't rejected for still having children.
        phases: categories => [
          categories.filter(c => c.mainCategoryId !== undefined),
          categories.filter(c => c.mainCategoryId === undefined),
        ],
      },
    },
  )

  return {
    create,
    update,
    remove,
    /** Any operation in flight for this category: disable its row actions. */
    isBusy: (id: number) => update.isPending(id) || remove.isPending(id),
  }
}
