import type { Page } from '#shared/contracts/common'
import type { MediaAsset } from '#shared/contracts/media'
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '#shared/contracts/media'
import type { CreateItemInput, ItemListQuery, ItemStatus, MenuItem, MenuItemSummary, UpdateItemInput } from '#shared/contracts/menu-items'
import type { MutationOptions } from '~/utils/mutation'

const BASE = '/admin/menu/items'
const NOUN: [string, string] = ['menu item', 'menu items']

/** Every write to one item moves its one `version`, so they never overlap: they share this lock. */
const lockOf = (id: string) => `menu-item:${id}`

/** Features whose data shows menu items: the libraries' "used by N items". */
const AFFECTED = ['products', 'option-sets', 'modifier-groups', 'availability-rules']

/** Images: the server's limits (shared contract), checked here first for a quick message. */
export { IMAGE_MAX_BYTES, IMAGE_TYPES }
/** Uploads get longer than the API's 30 s default: 5 MB on a slow connection. */
const UPLOAD_TIMEOUT_MS = 120_000

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
export function useItem(id: string) {
  return useApiQuery(`products:item:${id}`, () => apiFetch<MenuItem>(`${BASE}/${id}`))
}

interface ItemRef {
  id: string
  name: string
  version: number
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
      errorMessage: item => `Could not ${name} "${item.name}"`,
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
  const create = useMutation(
    (body: CreateItemInput) => apiFetch<MenuItem>(BASE, { method: 'POST', body }),
    {
      id: 'products:create',
      // Same name in the same category in flight = the same submission (a double submit).
      key: body => `${body.categoryId}:${body.name.trim().toLowerCase()}`,
      successMessage: (_, body) => `Menu item "${body.name}" created as a draft`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, name: string, body: UpdateItemInput }) =>
      apiFetch<MenuItem>(`${BASE}/${id}`, { method: 'PATCH', body }),
    {
      id: 'products:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { name }) => `Menu item "${name}" updated`,
      errorMessage: ({ name }) => `Could not save "${name}"`,
      invalidate: AFFECTED,
    },
  )

  const publish = action('publish', 'published')
  const unpublish = action('unpublish', 'unpublished')
  const restore = action('restore', 'restored as a draft')
  const archive = action('archive', 'archived', {
    confirm: item => ({
      title: `Archive "${item.name}"?`,
      description: 'Customers won\'t see it, and it can\'t be edited until it\'s restored. Past orders keep it.',
      confirmLabel: 'Archive',
      danger: true,
    }),
    batch: {
      noun: NOUN,
      verb: ['Archiving', 'archived'],
      confirm: items => ({
        title: `Archive ${pluralize(items.length, NOUN)}?`,
        description: `${previewList(items.map(i => i.name))}. Customers won't see them, and they can't be edited until they're restored.`,
        confirmLabel: 'Archive',
        danger: true,
      }),
    },
  })

  /**
   * Uploads an image and returns the asset (`id` → `imageId`, `url` for the preview). Keyed by the
   * form that started it, so each open form tracks its own upload. Nothing is saved on the item
   * until the form is; an unused upload is deleted by the server after 24 hours.
   */
  const uploadImage = useMutation(
    ({ file }: { file: File, form: string }) => {
      const body = new FormData()
      body.append('file', file)
      return apiFetch<MediaAsset>('/admin/media', { method: 'POST', body, timeout: UPLOAD_TIMEOUT_MS })
    },
    {
      id: 'products:upload',
      key: ({ form }) => form,
      successMessage: false,
      errorMessage: ({ file }) => `Could not upload "${file.name}"`,
    },
  )

  return {
    create,
    update,
    publish,
    unpublish,
    archive,
    restore,
    uploadImage,
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
