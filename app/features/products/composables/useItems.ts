import type { Page } from '#shared/contracts/common'
import type { CreateItemInput, ItemListQuery, ItemStatus, MenuItem, MenuItemSummary, UpdateItemInput } from '#shared/contracts/menu-items'
import type { MutationOptions } from '~/utils/mutation'

const BASE = '/admin/menu/items'
const NOUN: [string, string] = ['menu item', 'menu items']

/** Every write to one item moves its one `version`, so they never overlap: they share this lock. */
const lockOf = (id: string) => `menu-item:${id}`

/** Features whose data shows menu items: the libraries' "used by N items". */
const AFFECTED = ['products', 'option-sets', 'modifier-groups', 'availability-rules']

export type ItemListFilters = Partial<Pick<ItemListQuery, 'search' | 'categoryId' | 'modifierGroupId' | 'page' | 'pageSize'>> & { status?: ItemStatus }

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

/** "All 24 · Draft 3 · Published 20 · Archived 1" for the status tabs, with the other filters. */
export function useItemStatusCounts(filters: () => Pick<ItemListFilters, 'search' | 'categoryId' | 'modifierGroupId'>) {
  const { data } = useApiQuery(
    'products:status-counts',
    async () => {
      const total = (status: ItemStatus) => apiFetch<Page<MenuItemSummary>>(BASE, { query: { ...filters(), status, pageSize: 1 } }).then(page => page.total)
      const [draft, active, archived] = await Promise.all([total('draft'), total('active'), total('archived')])
      return { draft, active, archived, all: draft + active + archived }
    },
    { watch: [() => JSON.stringify(filters())] },
  )
  return data
}

/** One item with its grid, add-ons and rules: what the form edits (the list has summaries only). */
/** The whole item, as saved now. */
export const fetchItem = (id: string) => apiFetch<MenuItem>(`${BASE}/${id}`)

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

  return {
    create,
    update,
    publish,
    unpublish,
    archive,
    restore,
    /** Any operation in flight for this item: its card shows a spinner instead of its actions. */
    isBusy: (id: string) => [update, publish, unpublish, archive, restore].some(m => m.isPending(id)),
  }
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
      if (!id) return []
      const items: MenuItemSummary[] = []
      for (let page = 1; ; page++) {
        const answer = await apiFetch<Page<MenuItemSummary>>(BASE, { query: { categoryId: id, page, pageSize: 100 } })
        items.push(...answer.items)
        if (page >= answer.totalPages) break
      }
      return items.filter(item => item.status !== 'archived').sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
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
