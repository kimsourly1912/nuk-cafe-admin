import type { Category, CreateCategoryBody, ReorderCategoriesBody, UpdateCategoryBody } from '#shared/contracts/menu'

const NOUN: [string, string] = ['category', 'categories']

/**
 * Update and remove of one category must never overlap (e.g. a bulk delete while an edit is
 * saving): both take this record lock, checked when each request actually starts.
 */
const lockOf = (id: string) => `category:${id}`

/** Features whose cached data shows categories (products display their category). */
const AFFECTED = ['categories', 'products']

/**
 * Category mutations. State is shared app-wide by mutation id, so e.g. a row knows it's
 * being saved even after the edit modal was closed.
 */
export function useCategoryMutations() {
  const create = useMutation(
    (body: CreateCategoryBody) => apiFetch<Category>('/v1/admin/categories', { method: 'POST', body }),
    {
      id: 'categories:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.name.trim().toLowerCase(),
      successMessage: (_, body) => `Category "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, name: string, body: UpdateCategoryBody }) =>
      apiFetch<Category>(`/v1/admin/categories/${id}`, { method: 'PATCH', body }),
    {
      id: 'categories:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { name }) => `Category "${name}" updated`,
      errorMessage: ({ name }) => `Could not save "${name}"`,
      invalidate: AFFECTED,
    },
  )

  const remove = useMutation(
    (category: Category) => apiFetch<null>(`/v1/admin/categories/${category.id}`, { method: 'DELETE', query: { version: category.version } }),
    {
      id: 'categories:remove',
      key: category => category.id,
      lock: category => lockOf(category.id),
      removes: true,
      confirm: category => ({
        title: `Delete "${category.name}"?`,
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }),
      successMessage: (_, category) => `Category "${category.name}" deleted`,
      errorMessage: category => `Could not delete "${category.name}"`,
      invalidate: AFFECTED,
      batch: {
        noun: NOUN,
        verb: ['Deleting', 'deleted'],
        confirm: categories => ({
          title: `Delete ${pluralize(categories.length, NOUN)}?`,
          description: `${previewList(categories.map(c => c.name))}. This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        }),
        // Sub-categories first, so a main category isn't rejected for still having children.
        phases: categories => [
          categories.filter(c => c.parentId !== null),
          categories.filter(c => c.parentId === null),
        ],
      },
    },
  )

  /** Saves the tree order: every changed list, whole (`sortOrderChanges`). One save at a time. */
  const reorder = useMutation(
    (body: ReorderCategoriesBody) => apiFetch<Category[]>('/v1/admin/categories/order', { method: 'PUT', body }),
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
    isBusy: (id: string) => update.isPending(id) || remove.isPending(id),
  }
}
