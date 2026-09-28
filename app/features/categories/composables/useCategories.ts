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
/** A restore: the category as read; a top-level one may bring back its archived subcategories. */
export type RestoreRequest = MenuCategory & { withSubcategories?: boolean }

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

  /** Archiving a top-level category archives its active subcategories too (the server does it, D55). */
  const archive = useMutation(
    (category: MenuCategory) => apiFetch<MenuCategory>(`${BASE}/${category.id}/archive`, { method: 'POST', body: { version: category.version } }),
    {
      id: 'categories:archive',
      key: category => category.id,
      lock: category => lockOf(category.id),
      confirm: category => ({
        title: `Archive "${category.name}"?`,
        description: category.childCount
          ? `Its ${pluralize(category.childCount, ['active subcategory', 'active subcategories'])} will be archived too. Their menu items stay, but customers won't see them. You can restore it later.`
          : category.itemCount
            ? `Customers won't see it or its ${pluralize(category.itemCount, ['menu item', 'menu items'])}; the items stay and come back with it. You can restore it later.`
            : 'Customers won\'t see it. You can restore it later.',
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
          description: `${previewList(categories.map(c => c.name))}. ${categories.some(c => c.childCount > 0) ? 'Top-level categories take their active subcategories with them. ' : ''}You can restore them later.`,
          confirmLabel: 'Archive',
        }),
        // Subcategories first: archiving a parent archives its subcategories, which would then fail
        // as "already archived" if they came after.
        phases: categories => [
          categories.filter(c => c.parentId !== null),
          categories.filter(c => c.parentId === null),
        ],
      },
    },
  )

  /**
   * Restores one category at the end of its level; its subcategories stay archived. A subcategory
   * can be restored only under an active parent, so a batch restores parents first.
   */
  const restore = useMutation(
    (category: RestoreRequest) => apiFetch<MenuCategory>(`${BASE}/${category.id}/restore`, {
      method: 'POST',
      body: { version: category.version, ...(category.withSubcategories && { withSubcategories: true }) },
    }),
    {
      id: 'categories:restore',
      key: category => category.id,
      lock: category => lockOf(category.id),
      successMessage: (restored, category) => category.withSubcategories && restored.childCount
        ? `Category "${category.name}" restored with ${pluralize(restored.childCount, ['subcategory', 'subcategories'])}`
        : `Category "${category.name}" restored`,
      errorMessage: category => `Could not restore "${category.name}"`,
      invalidate: AFFECTED,
      batch: {
        noun: NOUN,
        verb: ['Restoring', 'restored'],
        confirm: categories => ({
          title: `Restore ${pluralize(categories.length, NOUN)}?`,
          description: `${previewList(categories.map(c => c.name))}. Customers will see them again; subcategories of a restored parent stay archived unless selected too.`,
          confirmLabel: 'Restore',
        }),
        phases: categories => [
          categories.filter(c => c.parentId === null),
          categories.filter(c => c.parentId !== null),
        ],
      },
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
