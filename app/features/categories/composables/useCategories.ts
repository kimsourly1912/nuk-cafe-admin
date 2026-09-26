import type { CategoryRecordCreation, CategoryRecordUpdate, CategoryResponse, CategorySortOrderUpdateRequest } from '~/generated/api'
import { createCategory1, deleteCategory1, updateCategory1, updateSortOrders } from '~/generated/api'

const NOUN: [string, string] = ['category', 'categories']

/**
 * Update and remove of one category must never overlap (e.g. a bulk delete while an edit is
 * saving): both take this record lock, checked when each request actually starts.
 */
const lockOf = (id: number | undefined) => `category:${id}`

/** Features whose cached data shows categories (products display their category). */
const AFFECTED = ['categories', 'products']

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
      lock: ({ id }) => lockOf(id),
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
      lock: category => lockOf(category.id),
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

  /** Saves the tree order: every changed list, whole (`sortOrderChanges`). One save at a time. */
  const reorder = useMutation(
    (body: CategorySortOrderUpdateRequest) => unwrap(updateSortOrders({ body })),
    {
      id: 'categories:sort',
      key: () => 'order',
      successMessage: 'Category order saved',
      errorMessage: 'Could not save the category order',
      invalidate: AFFECTED,
    },
  )

  return {
    create,
    update,
    remove,
    reorder,
    /** Any operation in flight for this category: disable its row actions. */
    isBusy: (id: number) => update.isPending(id) || remove.isPending(id),
  }
}
