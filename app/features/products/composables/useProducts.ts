import type { Page } from '#shared/contracts/common'
import type { CreateProductBody, Product, ProductListQuery, ProductMenuQuery, UpdateProductBody, UploadedMedia } from '#shared/contracts/menu'
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '#shared/contracts/menu'

export type { ProductListQuery, ProductMenuQuery }

const NOUN: [string, string] = ['menu item', 'menu items']

/** Update and remove of one product must never overlap: both take this record lock. */
const lockOf = (id: string) => `product:${id}`

/** Features whose cached data shows products (schedules show their item count and items). */
const AFFECTED = ['products', 'schedules']

/** Images: the server's limits (shared contract), checked here first for a quick message. */
export { IMAGE_MAX_BYTES, IMAGE_TYPES }
/** Uploads get longer than the API's 30 s default: 5 MB on a slow connection. */
const UPLOAD_TIMEOUT_MS = 120_000

/**
 * Paginated product list. Refetches whenever `query` changes. `enabled: false` (the grouped grid,
 * which loads the whole menu instead) sends no request.
 */
export function useProductList(query: MaybeRefOrGetter<ProductListQuery>, enabled: MaybeRefOrGetter<boolean> = true) {
  return useApiQuery(
    'products:list',
    () => (toValue(enabled) ? apiFetch<Page<Product>>('/admin/products', { query: toValue(query) }) : Promise.resolve(null)),
    { watch: [() => ({ ...toValue(query), enabled: toValue(enabled) })] },
  )
}

/**
 * The whole filtered menu (unpaginated), for the grid grouped by category. The key includes
 * "off" while unused, so no request is made then.
 */
export function useProductMenu(query: MaybeRefOrGetter<ProductMenuQuery>, enabled: MaybeRefOrGetter<boolean>) {
  return useApiQuery(
    () => (toValue(enabled) ? 'products:menu' : 'products:menu:off'),
    () => (toValue(enabled) ? apiFetch<Product[]>('/admin/products/all', { query: toValue(query) }) : Promise.resolve([])),
    // No empty-list default: it would count as data and skip the loading placeholders.
    { watch: [() => ({ ...toValue(query) })] },
  )
}

/** "All 24 · Active 20 · Inactive 4" for the status tabs, with the other filters applied. */
export function useProductStatusCounts(filters: () => Pick<ProductListQuery, 'search' | 'categoryId'>) {
  return useStatusCounts('products', filters, (query, status) =>
    apiFetch<Page<Product>>('/admin/products', { query: { ...query, status, pageSize: 1 } }).then(page => page.total))
}

/**
 * Product mutations. State is shared app-wide by mutation id, so e.g. a row knows it's being
 * saved even after the edit panel was closed.
 */
export function useProductMutations() {
  const create = useMutation(
    (body: CreateProductBody) => apiFetch<Product>('/admin/products', { method: 'POST', body }),
    {
      id: 'products:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.name.trim().toLowerCase(),
      successMessage: (_, body) => `Menu item "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, name: string, body: UpdateProductBody }) =>
      apiFetch<Product>(`/admin/products/${id}`, { method: 'PATCH', body }),
    {
      id: 'products:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { name }) => `Menu item "${name}" updated`,
      errorMessage: ({ name }) => `Could not save "${name}"`,
      invalidate: AFFECTED,
    },
  )

  const remove = useMutation(
    (product: Product) => apiFetch<null>(`/admin/products/${product.id}`, { method: 'DELETE', query: { version: product.version } }),
    {
      id: 'products:remove',
      key: product => product.id,
      lock: product => lockOf(product.id),
      removes: true,
      confirm: product => ({
        title: `Delete "${product.name}"?`,
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }),
      successMessage: (_, product) => `Menu item "${product.name}" deleted`,
      errorMessage: product => `Could not delete "${product.name}"`,
      invalidate: AFFECTED,
      batch: {
        noun: NOUN,
        verb: ['Deleting', 'deleted'],
        confirm: products => ({
          title: `Delete ${pluralize(products.length, NOUN)}?`,
          description: `${previewList(products.map(p => p.name))}. This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        }),
      },
    },
  )

  /**
   * Uploads an image and returns the asset (`id` → `imageAssetId`, `url` for the preview). Keyed
   * by the form that started it, so each open form tracks its own upload. Nothing is saved on the
   * menu item until the form is.
   */
  const uploadImage = useMutation(
    ({ file }: { file: File, form: string }) => {
      const body = new FormData()
      body.append('file', file)
      return apiFetch<UploadedMedia>('/admin/media', { method: 'POST', body, timeout: UPLOAD_TIMEOUT_MS })
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
    remove,
    uploadImage,
    /** Any operation in flight for this product: disable its row actions. */
    isBusy: (id: string) => update.isPending(id) || remove.isPending(id),
  }
}
