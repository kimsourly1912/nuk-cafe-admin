# Data fetching

← [API Reference](./README.md)

- [`apiFetch`](#apifetch): call our API
- [`useApiQuery`](#useapiquery): read data
- [`usePaginatedQuery`](#usepaginatedquery): filters and pagination for list pages
- [`ANY` / `toApiQuery`](#any--toapiquery): "All" option in filter selects
- [`invalidate`](#invalidate): refresh a feature's cached data
- [`invalidateAll`](#invalidateall): refresh every loaded list (tab focus, reconnect)

---

## `apiFetch`

Calls our API (`/api` + path, served by this app). Routes and error format: the [server standard](../server/architecture.md#surfaces-and-routes) ([errors](../server/architecture.md#errors)); request and response types: `shared/contracts/`.

Source: `app/utils/api.ts` (auto-imported), engine `app/utils/api-fetch.ts`

```ts
import type { Page } from '#shared/contracts/common'
import type { MenuCategory, UpdateCategoryInput } from '#shared/contracts/menu-categories'

const categories = await apiFetch<MenuCategory[]>('/admin/menu/categories', { query: { status: 'all' } })
const body: UpdateCategoryInput = { version: 3, name: 'Tea' }
await apiFetch<MenuCategory>(`/admin/menu/categories/${id}`, { method: 'PATCH', body })
```

- same-origin cookie, 30 s timeout (pass `timeout` for uploads), **no retries**;
- every failure throws [`ApiError`](./errors.md#apierror) (our error body and Better Auth's);
- a 401 or 403 `NOT_ADMIN` clears the session (the app goes to login); a 403 `PASSWORD_CHANGE_REQUIRED` sends the app to the change-password page;
- a response to a request started under a previous identity is discarded as a silent `aborted` error (D29).

Call it only inside `useApiQuery` (reads) and `useMutation` (writes).

---

## `useApiQuery`

Reads data from the API (through [`apiFetch`](#apifetch)). A thin wrapper over Nuxt's [`useAsyncData`](https://nuxt.com/docs/api/composables/use-async-data) with boolean loading states and errors already normalized to [`ApiError`](./errors.md#apierror).

Source: `app/composables/useApiQuery.ts`

### Usage

```ts
const { data, loading, refreshing, error, refresh } = useApiQuery(
  'products:list',
  () => apiFetch<Page<MenuItemSummary>>('/admin/menu/items', { query: toValue(query) }),
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
| `handler` | Fetches the data, normally `() => apiFetch<T>('/admin/…', { query })`. Read reactive inputs with `toValue()` inside it. |
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
export function useItemList(query: MaybeRefOrGetter<ItemListFilters>) {
  return useApiQuery('products:list', () => apiFetch<Page<MenuItemSummary>>('/admin/menu/items', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}
```

> Watch `() => ({ ...toValue(query) })`, not `query` itself. The spread creates a new object on every change, so changes to nested filters trigger a refetch.

**Options for a picker** (empty-array default; archived records included so a current value keeps its name):

```ts
export function useAvailabilityRuleOptions() {
  return useApiQuery(
    'availability-rules:options',
    () => apiFetch<AvailabilityRule[]>('/admin/menu/availability-rules', { query: { status: 'all' } }),
    { default: () => [] }, // data is never undefined
  )
}
```

A key can also be a getter for a parameterized query (``() => `products:list:${toValue(filter).status}` ``). Every call site of one key must pass the same options: `categories:all` is shared by the Categories tree and `CategorySelect`, so neither sets a `default` (D69).

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

### `watch` cancels, it doesn't queue

`useApiQuery` handles the `watch` option itself: a change calls `refresh({ dedupe: 'cancel' })`, so the newer request starts at once and a slower, older response is ignored. Plain `useAsyncData` in Nuxt 4.5 would wait for the running request and show its (outdated) result first (D30). E2E: `list-page.test.ts` → "a slow response for an older search…".

---

## `usePaginatedQuery`

Filter and pagination state for list pages, **kept in the URL** (`/products?search=tea&status=active&page=2`). Pages are 1-based both in `UPagination` and in the API (`page`, `pageSize`).

Source: `app/composables/usePaginatedQuery.ts`, URL conversion in `app/utils/query.ts` (`toUrlQuery`, `fromUrlQuery`, unit-tested in `test/unit/query.test.ts`). E2E: `test/e2e/list-page.test.ts`. Decision: [D21](../decisions.md).

### Usage

```ts
const { page, pageSize, filters, query, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  categoryId: ANY as string,
  status: ANY as string,
})
const { data, loading } = useItemList(query)
```

```vue
<SearchInput v-model="filters.search" placeholder="Search categories…" />
<StatusTabs v-model="filters.status" :tabs="TABS" :counts="counts" />
<UTable :data="rows" :loading="loading">
  <template #loading>Loading categories…</template>
  <template #empty>
    <ListEmptyState noun="categories" :filtered="isFiltered" create-label="New category"
                    @create="openForm()" @clear="clearFilters()" />
  </template>
</UTable>
<UPagination v-model:page="page" :total="data?.total ?? 0" :items-per-page="pageSize" />
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
  query: ComputedRef<ApiQuery<T> & { page: number, pageSize: number }> // ANY/'' removed
  isFiltered: ComputedRef<boolean>                    // any filter differs from its default
  clearFilters: () => void                            // back to the defaults (and page 1)
}
```

### Behavior

- **Changing any filter resets `page` to 1.**
- `query` drops `ANY` and empty strings (via [`toApiQuery`](#any--toapiquery)), so unset filters aren't sent. `query.page = page`, `query.pageSize = pageSize`.
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

## `invalidate`

Refetches every **loaded** query whose key belongs to the given features, **in this tab and in the app's other open tabs**.

Source: `app/utils/invalidate.ts`

```ts
function invalidate(...features: string[]): Promise<void>
```

```ts
await invalidate('products', 'option-sets') // refreshes 'products:list', 'option-sets:list', … here and in other tabs
```

- Matches keys by prefix: `'products'` refreshes every key starting with `products:`. Queries not currently loaded are ignored.
- **Batched:** calls within 30ms are merged into one refresh per key and **one** message to other tabs. The promise resolves after this tab's refresh.
- **Other tabs:** the feature names go out through the runtime hook `app:data-changed`, which `plugins/data-freshness.client.ts` forwards over a `BroadcastChannel`. Only names cross, never data. See [App-wide behavior → Data freshness](./app-behavior.md#data-freshness).
- **Usually you don't call it.** Declare `invalidate: [...]` on [`useMutation`](./mutations.md#options) instead.
- Must run in a Nuxt context. After an `await`, wrap it: `nuxtApp.runWithContext(() => invalidate('x'))` (`useMutation` does this for you).

## `invalidateInThisTab`

```ts
function invalidateInThisTab(features: string[]): Promise<void>
```

`invalidate` without telling other tabs. The freshness plugin uses it for messages **received** from another tab, so they're never sent back (no ping-pong). Features don't need it.

## `invalidateAll`

```ts
function invalidateAll(options?: { olderThanMs?: number }): Promise<void>
```

Refetches loaded API queries (`<feature>:<name>` keys) in this tab. With `olderThanMs`, only the queries whose last successful load (recorded per key by `useApiQuery`) is at least that old. The freshness plugin calls `invalidateAll({ olderThanMs: 5000 })` when the user returns to the tab, and `invalidateAll()` on reconnect. Features don't need it.
