# Data fetching

← [API Reference](./README.md)

- [`useApiQuery`](#useapiquery): read data
- [`usePaginatedQuery`](#usepaginatedquery): filters and pagination for list pages
- [`ANY` / `toApiQuery`](#any--toapiquery): "All" option in filter selects
- [`unwrap`](#unwrap): SDK call → envelope `data`
- [`invalidate`](#invalidate): refresh a feature's cached data
- [`invalidateAll`](#invalidateall): refresh every loaded list (tab focus, reconnect)

---

## `useApiQuery`

Reads data from the API. A thin wrapper over Nuxt's [`useAsyncData`](https://nuxt.com/docs/api/composables/use-async-data) with boolean loading states and errors already normalized to [`ApiError`](./errors.md#apierror).

Source: `app/composables/useApiQuery.ts`

### Usage

```ts
const { data, loading, refreshing, error, refresh } = useApiQuery(
  'categories:list',
  () => unwrap(getCategoriesPage({ query: toValue(query) })),
  { watch: [() => ({ ...toValue(query) })] },
)
```

### Type

```ts
function useApiQuery<T, DefaultT = undefined>(
  key: MaybeRefOrGetter<string>,
  handler: () => Promise<T>,
  options?: AsyncDataOptions<T, T, never[], DefaultT>,
)
```

### Parameters

| Parameter | Description |
|---|---|
| `key` | **`'<feature>:<name>'`**, e.g. `'categories:list'`. Can be a getter for parameterized queries: `` () => `categories:options:${type}` ``. [`invalidate`](#invalidate) finds queries by the feature prefix. In dev, a key without a prefix logs a warning. |
| `handler` | Fetches the data, normally `() => unwrap(sdkFn({ ... }))`. Read reactive inputs with `toValue()` inside it. |
| `options` | Any [`useAsyncData` option](https://nuxt.com/docs/api/composables/use-async-data#params). Common ones: `watch` (refetch when sources change), `default` (initial value), `immediate`, `lazy`. |

### Returns

| Member | Type | Description |
|---|---|---|
| `data` | `Ref<T \| DefaultT>` | The result. Kept while refreshing. |
| `pending` | `ComputedRef<boolean>` | Any request in flight (first load or refresh). |
| `loading` | `ComputedRef<boolean>` | **First load**: pending with no data yet. Use it for table skeletons and spinners. |
| `refreshing` | `ComputedRef<boolean>` | Reloading while previous data is shown. Use it for a small inline spinner. |
| `error` | `ComputedRef<ApiError \| undefined>` | Already normalized. Pass it to [`<ApiErrorAlert>`](./errors.md#apierroralert). |
| `status` | `Ref<'idle' \| 'pending' \| 'success' \| 'error'>` | Raw `useAsyncData` status. |
| `refresh()` / `execute()` | `() => Promise<void>` | Refetch. |
| `clear()` | `() => void` | Reset data and error. |

### Examples

**Paginated list with filters** (refetches when the query changes):

```ts
export function useCategoryList(query: MaybeRefOrGetter<CategoryListQuery>) {
  return useApiQuery('categories:list', () => unwrap(getCategoriesPage({ query: toValue(query) })), {
    watch: [() => ({ ...toValue(query) })],
  })
}
```

> Watch `() => ({ ...toValue(query) })`, not `query` itself. The spread creates a new object on every change, so changes to nested filters trigger a refetch.

**Options for a picker** (parameterized key, empty-array default):

```ts
export function useCategoryOptions(filter: MaybeRefOrGetter<CategoryOptionsFilter> = {}) {
  return useApiQuery(
    () => `categories:options:${toValue(filter).type ?? 'all'}`,
    () => unwrap(getAllCategories({ query: toValue(filter) })),
    { default: () => [] }, // data is never undefined
  )
}
```

**Template:**

```vue
<ApiErrorAlert v-if="error" :error="error" title="Could not load categories" @retry="refresh()" />
<UTable v-else :data="rows" :loading="loading" />
<UIcon v-if="refreshing" name="i-lucide-loader-circle" class="animate-spin" />
```

### Caveats

- **Not awaitable.** Unlike `useAsyncData`, the result isn't a promise, so `await useApiQuery(...)` doesn't wait for the data. This is an SPA, so render loading states instead.
- **One key, one cache entry.** Two components using the same key share the data. Include every parameter that changes the result in the key, or use `watch`.
- Define queries in the feature's composable (`use<Feature>List`), not inline in components.

---

## `usePaginatedQuery`

Filter and pagination state for list pages, **kept in the URL** (`/categories?search=tea&status=ACTIVE&page=2`). It converts between the UI's 1-based page (`UPagination`) and the API's 0-based `page` + `size`.

Source: `app/composables/usePaginatedQuery.ts`, URL conversion in `app/utils/query.ts` (`toUrlQuery`, `fromUrlQuery`, unit-tested in `test/unit/query.test.ts`). E2E: `test/e2e/list-page.test.ts`. Decision: [D21](../decisions.md).

### Usage

```ts
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: ANY as Status | Any,
  type: ANY as 'MAIN' | 'SUB' | Any,
})
const { data, loading } = useCategoryList(query)
```

```vue
<SearchInput v-model="filters.search" placeholder="Search categories…" />
<USelect v-model="filters.status" :items="STATUS_FILTER_ITEMS" />
<UTable :data="rows" :loading="loading">
  <template #loading>Loading categories…</template>
  <template #empty>
    <ListEmptyState noun="categories" :filtered="isFiltered" create-label="New category"
                    @create="openForm()" @clear="clearFilters()" />
  </template>
</UTable>
<UPagination v-model:page="page" :total="data?.totalElements ?? 0" :items-per-page="pageSize" />
```

See [`<SearchInput>`](./ui.md#searchinput) and [`<ListEmptyState>`](./ui.md#listemptystate).

### Type

```ts
function usePaginatedQuery<T extends Record<string, unknown>>(
  initialFilters: T,                                   // also the defaults
  options?: { pageSize?: number, syncUrl?: boolean },  // 20, true
): {
  page: Ref<number>                                   // 1-based
  pageSize: number
  filters: Reactive<T>                                // bind inputs to these
  query: ComputedRef<ApiQuery<T> & { page: number, size: number }> // 0-based, ANY/'' removed
  isFiltered: ComputedRef<boolean>                    // any filter differs from its default
  clearFilters: () => void                            // back to the defaults (and page 1)
}
```

### Behavior

- **Changing any filter resets `page` to 1.**
- `query` drops `ANY` and empty strings (via [`toApiQuery`](#any--toapiquery)), so unset filters aren't sent. `query.page = page - 1`, `query.size = pageSize`.
- **URL sync** (`syncUrl: true`, the default):

| Case | Behavior |
|---|---|
| Open or reload `/categories?search=tea&page=2` | Filters and page are read from the URL |
| Change a filter or the page | URL updated with `router.replace`: **no history entry**, so Back leaves the list instead of undoing filters one by one |
| Default values (`''`, `ANY`, page 1) | Left out of the URL, so an unfiltered list is just `/categories` |
| Sidebar link to the list while filtered | Opens the bare list and **resets** the filters (the URL is the source of truth) |
| Bad values in the URL (`page=-1`, `page=abc`, repeated keys) | Fall back to the default (page 1) |
| Number defaults (`minPoints: 0`) | Parsed as numbers from the URL; strings stay strings |
| Other query params not owned by this list | Kept untouched |
| Navigating away | The composable only touches the URL while the route is still its own page, so it never writes filters into the next page's URL |

### Caveats

- **One `usePaginatedQuery` per page** when `syncUrl` is on: two lists on one page would share `page` and clash on filter names. Pass `syncUrl: false` for secondary lists (e.g. a list inside a modal or a tab).
- Filter values must be strings or numbers to round-trip through the URL. Arrays/objects aren't supported yet.
- The URL change runs the global route middleware (auth + [unsaved changes](./forms.md)). That's cheap, and a filter can't change while a form modal is open anyway.

### Recipe: step back when the last page empties

After deletes, the current page may no longer exist:

```ts
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})
```

---

## `ANY` / `toApiQuery`

`USelect` can't hold `undefined` or `''`, so "All" options use the sentinel `ANY` (`'ALL'`). `toApiQuery` strips it before the request.

Source: `app/utils/query.ts`

```ts
const ANY = 'ALL'
type Any = typeof ANY
type ApiQuery<T> = { [K in keyof T]?: Exclude<T[K], Any> }
function toApiQuery<T extends Record<string, unknown>>(filters: T): ApiQuery<T>
```

```ts
toApiQuery({ search: '', status: ANY, type: 'MAIN', page: 0 })
// → { search: undefined, status: undefined, type: 'MAIN', page: 0 }
```

Type filter state as `ANY as <Union> | Any` so the value type stays precise:

```ts
usePaginatedQuery({ status: ANY as Status | Any })
const typeItems: SelectItem[] = [{ label: 'All types', value: ANY }, { label: 'Main', value: 'MAIN' }]
```

You rarely call `toApiQuery` directly, because `usePaginatedQuery` does. For "none" values in **forms** (e.g. "no parent category"), let the feature's `<Feature>Select` component handle it (see [`CategorySelect`](./features.md#categoryselect)).

---

## `unwrap`

Awaits a generated SDK call and returns the envelope's `data`.

Source: `app/utils/api.ts`

```ts
function unwrap<T>(request: Promise<{ data: ApiEnvelope<T> }>): Promise<T>
```

```ts
const page = await unwrap(getCategoriesPage({ query: { page: 0, size: 20 } }))
// page: PageResponseCategoryResponse → { content, totalElements, totalPages, ... }
```

- Every backend response is `{ data, success, msg, reason }`, and the SDK returns `{ data: <that envelope> }`. `unwrap` gives you the inner `data`.
- Failures never reach `unwrap`. The API layer already threw an [`ApiError`](./errors.md#apierror), including for HTTP 200 responses with `success: false`.
- Use it for **every** SDK call.

Finding the SDK function for an endpoint: search `app/generated/api/sdk.gen.ts` for its URL (`url: '/staff/categories/{id}'`). Names come from the backend's `operationId`s and are sometimes suffixed (`createCategory1`, `update_2`).

---

## `invalidate`

Refetches every **loaded** query whose key belongs to the given features.

Source: `app/utils/invalidate.ts`

```ts
function invalidate(...features: string[]): Promise<void>
```

```ts
await invalidate('products', 'schedules') // refreshes 'products:list', 'schedules:options:…', …
```

- Matches keys by prefix: `'products'` refreshes every key starting with `products:`. Queries not currently loaded are ignored.
- **Batched:** calls within 30ms are merged into one refresh per key. The promise resolves after that refresh.
- **Usually you don't call it.** Declare `invalidate: [...]` on [`useMutation`](./mutations.md#options) instead.
- Must run in a Nuxt context. After an `await`, wrap it: `nuxtApp.runWithContext(() => invalidate('x'))` (`useMutation` does this for you).

## `invalidateAll`

```ts
function invalidateAll(): Promise<void>
```

Refetches every loaded API query (every `<feature>:<name>` key), through `invalidate`. Used by `plugins/data-freshness.client.ts` when the user comes back to the tab or the connection returns (see [App-wide behavior](./app-behavior.md#data-freshness)). Features don't need to call it.
