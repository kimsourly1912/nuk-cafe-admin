import type { Page } from '#shared/contracts/common'
import type { CreateItemInput, ItemCounts, ItemCountsQuery, ItemDeleteBlocker, ItemListQuery, ItemStatus, MenuItem, MenuItemSummary, UpdateItemInput } from '#shared/contracts/menu-items'
import type { MutationOptions } from '~/utils/mutation'

const BASE = '/admin/menu/items'
const NOUN: [string, string] = ['menu item', 'menu items']

/** Every write to one item moves its one `version`, so they never overlap: they share this lock. */
const lockOf = (id: string) => `menu-item:${id}`

/**
 * Features whose data shows menu items: the libraries' "used by N items" and categories' item
 * counts (which also decide what `CategorySelect` offers). Kept between visits (D173), so each
 * must be named.
 */
const AFFECTED = ['products', 'categories', 'option-sets', 'modifier-groups', 'availability-rules']

export type ItemListFilters = Partial<Pick<ItemListQuery, 'search' | 'categoryId' | 'modifierGroupId' | 'photo' | 'page' | 'pageSize'>> & { status?: ItemStatus }

/** The API's default leaves archived items out; the "All" tab means all of them. */
const withStatus = (query: ItemListFilters) => ({ ...query, status: query.status ?? 'all' })

/** Paginated menu items (summaries). Refetches whenever `query` changes. */
export function useItemList(query: MaybeRefOrGetter<ItemListFilters>) {
  return useApiQuery(
    'products:list',
    () => apiFetch<Page<MenuItemSummary>>(BASE, { query: withStatus(toValue(query)) }),
    { watch: [() => ({ ...toValue(query) })] },
  )
}

/**
 * The list's counts in one read: "All 24 · Draft 3 · Published 20 · Archived 1" for the status
 * tabs (with the photo filter), and how many items it shows without a photo (D160) for the "No
 * photo" hint (with the status tab; archived items aren't counted on the All tab). Only search,
 * category and add-on group change the read; a tab or the photo filter doesn't.
 */
export function useItemCounts(filters: () => ItemListFilters) {
  const counted = (): ItemCountsQuery => {
    const { search, categoryId, modifierGroupId } = filters()
    return { search, categoryId, modifierGroupId }
  }
  const { data } = useApiQuery(
    'products:counts',
    () => apiFetch<ItemCounts>(`${BASE}/counts`, { query: counted() }),
    { watch: [() => JSON.stringify(counted())] },
  )
  const statusCounts = computed(() => {
    const counts = data.value
    if (!counts) return undefined
    const shown = (status: ItemStatus) => (filters().photo ? counts[status].withoutPhoto : counts[status].items)
    const [draft, active, archived] = [shown('draft'), shown('active'), shown('archived')]
    return { draft, active, archived, all: draft + active + archived }
  })
  const missingPhotos = computed(() => {
    const counts = data.value
    if (!counts) return undefined
    const status = filters().status
    return status ? counts[status].withoutPhoto : counts.draft.withoutPhoto + counts.active.withoutPhoto
  })
  return { statusCounts, missingPhotos }
}

/** The whole item, as saved now. */
export const fetchItem = (id: string) => apiFetch<MenuItem>(`${BASE}/${id}`)

/** One item with its grid, add-ons and rules: what the form edits (the list has summaries only). */
export function useItem(id: string) {
  return useApiQuery(`products:item:${id}`, () => fetchItem(id))
}

interface ItemRef {
  id: string
  name: string
  version: number
  /** Published right after the form saved it (D125): a refusal says the save itself went through. */
  afterSave?: boolean
  /** Its status before an archive, for Undo (D152). */
  status?: ItemStatus
}

/** A state change: publish, unpublish, archive or restore, from the version read. */
function action(name: string, past: string, options: Partial<MutationOptions<ItemRef, MenuItem>> = {}) {
  return useMutation(
    (item: ItemRef) => apiFetch<MenuItem>(`${BASE}/${item.id}/${name}`, { method: 'POST', body: { version: item.version } }),
    {
      id: `products:${name}`,
      key: item => item.id,
      lock: item => lockOf(item.id),
      successMessage: (_, item) => `Menu item "${item.name}" ${past}`,
      errorMessage: item => (item.afterSave ? `"${item.name}" was saved as a draft, but not ${past}` : `Could not ${name} "${item.name}"`),
      invalidate: AFFECTED,
      ...options,
    },
  )
}

/**
 * Menu item mutations. State is shared app-wide by mutation id, so a card knows it's being saved
 * even after the form was closed.
 */
export function useItemMutations() {
  // `publishing`: the form publishes right after (D125), and that toast says what happened.
  const create = useMutation(
    ({ body }: { body: CreateItemInput, publishing?: boolean }) => apiFetch<MenuItem>(BASE, { method: 'POST', body }),
    {
      id: 'products:create',
      // Same name in the same category in flight = the same submission (a double submit).
      key: ({ body }) => `${body.categoryId}:${body.name.trim().toLowerCase()}`,
      successMessage: (_, { body, publishing }) => (publishing ? false : `Menu item "${body.name}" created as a draft`),
      errorMessage: ({ body }) => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, name: string, body: UpdateItemInput, publishing?: boolean }) =>
      apiFetch<MenuItem>(`${BASE}/${id}`, { method: 'PATCH', body }),
    {
      id: 'products:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { name, publishing }) => (publishing ? false : `Menu item "${name}" updated`),
      errorMessage: ({ name }) => `Could not save "${name}"`,
      invalidate: AFFECTED,
    },
  )

  const publish = action('publish', 'published', {
    // Bulk publish from Select mode (D125): drafts only; each is checked by the server as one.
    batch: {
      noun: NOUN,
      verb: ['Publishing', 'published'],
      confirm: items => ({
        title: `Publish ${pluralize(items.length, NOUN)}?`,
        description: `${previewList(items.map(i => i.name))}. Customers will see them on the menu.`,
        confirmLabel: 'Publish',
      }),
    },
  })
  /**
   * Restore: a draft at the end of its category; Undo right after an archive (D152) puts it back
   * where it was, in the status it had.
   */
  const restore = useMutation(
    (item: ItemRef & { undo?: { status: 'draft' | 'active' } }) =>
      apiFetch<MenuItem>(`${BASE}/${item.id}/restore`, { method: 'POST', body: { version: item.version, ...(item.undo && { undo: item.undo }) } }),
    {
      id: 'products:restore',
      key: item => item.id,
      lock: item => lockOf(item.id),
      successMessage: (_, item) => (item.undo ? `Menu item "${item.name}" is back` : `Menu item "${item.name}" restored as a draft`),
      errorMessage: item => (item.undo ? `Could not undo: "${item.name}" stays archived` : `Could not restore "${item.name}"`),
      invalidate: AFFECTED,
      batch: { noun: NOUN, verb: ['Restoring', 'back'] },
    },
  )
  /** Undo instead of asking (D152): each archived item back where it was, in its status. */
  function undoArchive(done: { input: ItemRef, data: MenuItem }[]) {
    const inputs = done.map(({ input, data }) => ({ id: data.id, name: data.name, version: data.version, undo: { status: input.status === 'active' ? 'active' as const : 'draft' as const } }))
    if (inputs.length === 1) void restore.execute(inputs[0]!)
    else void restore.executeMany(inputs)
  }
  const unpublish = action('unpublish', 'unpublished', {
    undo: ([done]) => void (done && publish.execute({ id: done.data.id, name: done.data.name, version: done.data.version })),
  })
  const archive = action('archive', 'archived', {
    undo: undoArchive,
    batch: { noun: NOUN, verb: ['Archiving', 'archived'] },
  })

  /**
   * Deletes a never-ordered draft or archived item for good (D200). Asks first: unlike Archive
   * there's no Undo. The server refuses an item with history (409 `ITEM_HAS_HISTORY`).
   */
  const remove = useMutation(
    (item: ItemRef & { status: ItemStatus }) => apiFetch<null>(`${BASE}/${item.id}`, { method: 'DELETE', query: { version: item.version } }),
    {
      id: 'products:delete',
      key: item => item.id,
      lock: item => lockOf(item.id),
      removes: true,
      confirm: item => ({
        title: `Delete "${item.name}" permanently?`,
        description: `It was never ordered. Its versions, prices and photo are removed too, and it can't be restored.${item.status === 'draft' ? ' To keep it, archive it instead.' : ''}`,
        confirmLabel: 'Delete permanently',
        danger: true,
      }),
      successMessage: (_, item) => `Menu item "${item.name}" deleted`,
      errorMessage: item => `Could not delete "${item.name}"`,
      invalidate: AFFECTED,
    },
  )

  return {
    create,
    update,
    publish,
    unpublish,
    archive,
    restore,
    remove,
    /** Any operation in flight for this item: its card shows a spinner instead of its actions. */
    isBusy: (id: string) => [update, publish, unpublish, archive, restore, remove].some(m => m.isPending(id)),
  }
}

/** Why Delete permanently is off for an item with history (D200), as its menu says. */
export const DELETE_BLOCKED: Record<ItemDeleteBlocker, string> = {
  ordered: 'Delete permanently (it was ordered)',
  promotion: 'Delete permanently (it is in a promotion)',
}

/**
 * A category's items in their order, for Reorder (step 10.3, D118): drafts and published items,
 * the ones a reorder must list (archived items keep their place but aren't shown). Every page is
 * read, so a category with more than one page of items is complete.
 */
export function useCategoryItems(categoryId: MaybeRefOrGetter<string | undefined>) {
  return useApiQuery(
    () => `products:category-order:${toValue(categoryId) ?? 'none'}`,
    async () => {
      const id = toValue(categoryId)
      if (!id) return { categoryId: id, items: [] as MenuItemSummary[] }
      const items: MenuItemSummary[] = []
      for (let page = 1; ; page++) {
        const answer = await apiFetch<Page<MenuItemSummary>>(BASE, { query: { categoryId: id, page, pageSize: 100 } })
        items.push(...answer.items)
        if (page >= answer.totalPages) break
      }
      // Tagged with its category: a switch can leave the previous category's answer in `data` until the new one lands.
      return { categoryId: id, items: items.filter(item => item.status !== 'archived').sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) }
    },
    { server: false },
  )
}

/**
 * Saves a category's order (`PUT /admin/menu/items/order`): every item with the version it was
 * read at, in the new order. Someone else's change meanwhile is refused (409) and nothing moves.
 * The dialog keeps its own saving state and shows a refusal in place (Reload).
 */
export async function saveItemOrder(categoryId: string, items: Pick<MenuItemSummary, 'id' | 'version'>[]) {
  await apiFetch<null>(`${BASE}/order`, { method: 'PUT', body: { categoryId, items: items.map(item => ({ id: item.id, version: item.version })) } })
  await invalidate(...AFFECTED)
}
