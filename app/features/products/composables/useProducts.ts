import type { GetPage1Data, ProductRecordCreation, ProductRecordUpdate, ProductResponse } from '~/generated/api'
import { create2, delete2, getAll2, getPage1, update2, upload } from '~/generated/api'

export type ProductListQuery = NonNullable<GetPage1Data['query']>

const NOUN: [string, string] = ['menu item', 'menu items']

/** Update and remove of one product must never overlap: both take this record lock. */
const lockOf = (id: number | undefined) => `product:${id}`

/** Features whose cached data shows products (schedules show their item count and items). */
const AFFECTED = ['products', 'schedules']

/** Images: our own limits until the backend's are known (docs/plans/products.md P5). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Uploads get longer than the API's 30 s default: 5 MB on a slow connection. */
const UPLOAD_TIMEOUT_MS = 120_000

/**
 * Paginated product list. Refetches whenever `query` changes. `enabled: false` (the grouped grid,
 * which loads the whole menu instead) sends no request.
 */
export function useProductList(query: MaybeRefOrGetter<ProductListQuery>, enabled: MaybeRefOrGetter<boolean> = true) {
  return useApiQuery('products:list', () => (toValue(enabled) ? unwrap(getPage1({ query: toValue(query) })) : Promise.resolve(null)), {
    watch: [() => ({ ...toValue(query), enabled: toValue(enabled) })],
  })
}

/**
 * The whole filtered menu (unpaginated), for the grid grouped by category. The key includes
 * "off" while unused, so no request is made then.
 */
export function useProductMenu(query: MaybeRefOrGetter<Omit<ProductListQuery, 'page' | 'size'>>, enabled: MaybeRefOrGetter<boolean>) {
  return useApiQuery(
    () => (toValue(enabled) ? 'products:menu' : 'products:menu:off'),
    () => (toValue(enabled) ? unwrap(getAll2({ query: toValue(query) })) : Promise.resolve([])),
    // No empty-list default: it would count as data and skip the loading placeholders.
    { watch: [() => ({ ...toValue(query) })] },
  )
}

/** "All 24 · Active 20 · Inactive 4" for the status tabs, with the other filters applied. */
export function useProductStatusCounts(filters: () => Pick<ProductListQuery, 'productName' | 'categoryId'>) {
  return useStatusCounts('products', filters, (query, status) =>
    unwrap(getPage1({ query: { ...query, status, size: 1 } })).then(page => page.totalElements ?? 0))
}

/**
 * Product mutations. State is shared app-wide by mutation id, so e.g. a row knows it's being
 * saved even after the edit panel was closed.
 */
export function useProductMutations() {
  const create = useMutation(
    (body: ProductRecordCreation) => unwrap(create2({ body })),
    {
      id: 'products:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.productName?.trim().toLowerCase() ?? '',
      successMessage: (_, body) => `Menu item "${body.productName}" created`,
      errorMessage: body => `Could not create "${body.productName}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: number, body: ProductRecordUpdate }) => unwrap(update2({ path: { id }, body })),
    {
      id: 'products:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { body }) => `Menu item "${body.productName}" updated`,
      errorMessage: ({ body }) => `Could not save "${body.productName}"`,
      invalidate: AFFECTED,
    },
  )

  const remove = useMutation(
    (product: ProductResponse) => unwrap(delete2({ path: { id: product.id! } })),
    {
      id: 'products:remove',
      key: product => product.id!,
      lock: product => lockOf(product.id),
      removes: true,
      confirm: product => ({
        title: `Delete "${product.productName}"?`,
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }),
      successMessage: (_, product) => `Menu item "${product.productName}" deleted`,
      errorMessage: product => `Could not delete "${product.productName}"`,
      invalidate: AFFECTED,
      batch: {
        noun: NOUN,
        verb: ['Deleting', 'deleted'],
        confirm: products => ({
          title: `Delete ${pluralize(products.length, NOUN)}?`,
          description: `${previewList(products.map(p => p.productName ?? `#${p.id}`))}. This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        }),
      },
    },
  )

  /**
   * Uploads an image and returns the file record (`id` → `imageUuid`, `url` → `imageUrl`). Keyed by
   * the form that started it, so each open form tracks its own upload. Nothing is saved on the
   * product until the form is.
   */
  const uploadImage = useMutation(
    ({ file }: { file: File, form: string }) => unwrap(upload({ body: { file }, timeout: UPLOAD_TIMEOUT_MS })),
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
    isBusy: (id: number) => update.isPending(id) || remove.isPending(id),
  }
}
