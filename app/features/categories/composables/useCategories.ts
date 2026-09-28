import type { CreateCategoryInput, MenuCategory, ReorderCategoriesInput, UpdateCategoryInput } from '#shared/contracts/menu-categories'

const BASE = '/admin/menu/categories'
const NOUN: [string, string] = ['category', 'categories']

/**
 * Update, archive and restore of one category must never overlap (e.g. a bulk archive while an
 * edit is saving): all take this record lock, checked when each request actually starts.
 */
const lockOf = (id: string) => `category:${id}`

/** Features whose cached data shows categories (menu items show their category). */
const AFFECTED = ['categories', 'products']

/**
 * Category mutations. State is shared app-wide by mutation id, so e.g. a row knows it's
 * being saved even after the edit modal was closed.
 */
export function useCategoryMutations() {
  const create = useMutation(
    (body: CreateCategoryInput) => apiFetch<MenuCategory>(BASE, { method: 'POST', body }),
    {
      id: 'categories:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => `${body.parentId ?? 'top'}:${body.name.toLowerCase()}`,
      successMessage: (_, body) => `Category "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, name: string, body: UpdateCategoryInput }) =>
      apiFetch<MenuCategory>(`${BASE}/${id}`, { method: 'PATCH', body }),
    {
      id: 'categories:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { name }) => `Category "${name}" updated`,
      errorMessage: ({ name }) => `Could not save "${name}"`,
      invalidate: AFFECTED,
    },
  )

  /** Archiving a main category archives its sub-categories too (the server does it, D55). */
  const archive = useMutation(
    (category: MenuCategory) => apiFetch<MenuCategory>(`${BASE}/${category.id}/archive`, { method: 'POST', body: { version: category.version } }),
    {
      id: 'categories:archive',
      key: category => category.id,
      lock: category => lockOf(category.id),
      confirm: category => ({
        title: `Archive "${category.name}"?`,
        description: category.childCount
          ? `Its ${pluralize(category.childCount, ['sub-category', 'sub-categories'])} will be archived too. Menu items in it stay, but customers won't see them. You can restore it later.`
          : 'Customers won\'t see it or its menu items. You can restore it later.',
        confirmLabel: 'Archive',
      }),
      successMessage: (_, category) => `Category "${category.name}" archived`,
      errorMessage: category => `Could not archive "${category.name}"`,
      invalidate: AFFECTED,
      batch: {
        noun: NOUN,
        verb: ['Archiving', 'archived'],
        confirm: categories => ({
          title: `Archive ${pluralize(categories.length, NOUN)}?`,
          description: `${previewList(categories.map(c => c.name))}. Main categories take their sub-categories with them. You can restore them later.`,
          confirmLabel: 'Archive',
        }),
        // Sub-categories first: archiving a main archives its subs, which would then fail as
        // "already archived" if they came after.
        phases: categories => [
          categories.filter(c => c.parentId !== null),
          categories.filter(c => c.parentId === null),
        ],
      },
    },
  )

  /** Restores one category at the end of its level; its sub-categories stay archived. */
  const restore = useMutation(
    (category: MenuCategory) => apiFetch<MenuCategory>(`${BASE}/${category.id}/restore`, { method: 'POST', body: { version: category.version } }),
    {
      id: 'categories:restore',
      key: category => category.id,
      lock: category => lockOf(category.id),
      successMessage: (_, category) => `Category "${category.name}" restored`,
      errorMessage: category => `Could not restore "${category.name}"`,
      invalidate: AFFECTED,
    },
  )

  /** Saves one level's order (a parent's active children, each with its version). */
  const reorder = useMutation(
    (body: ReorderCategoriesInput) => apiFetch<MenuCategory[]>(`${BASE}/order`, { method: 'PUT', body }),
    {
      id: 'categories:sort',
      key: body => body.parentId ?? 'top',
      errorMessage: 'Could not save the category order',
      invalidate: AFFECTED,
    },
  )

  return {
    create,
    update,
    archive,
    restore,
    reorder,
    /** Any operation in flight for this category: disable its row actions. */
    isBusy: (id: string) => update.isPending(id) || archive.isPending(id) || restore.isPending(id),
  }
}
