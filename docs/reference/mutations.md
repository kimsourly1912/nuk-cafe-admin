# Mutations

← [API Reference](./README.md)

- [`useMutation`](#usemutation)
  - [Usage](#usage) · [Type](#type) · [Options](#options) · [Returns](#returns) · [`execute`](#execute) · [`executeMany`](#executemany)
  - [Recipes](#recipes) · [Behavior details](#behavior-details) · [Common mistakes](#common-mistakes)
- [`usePendingMutationCount`](#usependingmutationcount)

Source: `app/composables/useMutation.ts` (Nuxt wiring) and `app/utils/mutation.ts` (the engine, unit-tested in `test/unit/mutation.test.ts`).

---

## `useMutation`

Runs a create, update or delete and handles every UI state for you:

- confirmation
- pending state per item
- success and error toasts
- per-item errors
- refreshing affected data
- hiding deleted rows
- batch runs with progress, Stop and Retry

It's built for async work. The user can confirm a delete, close the dialog and start another delete while the first is still running.

### Usage

Define mutations **once per feature**, inside `use<Feature>Mutations()`, and call them from components.

```ts
// features/categories/composables/useCategories.ts
export function useCategoryMutations() {
  const remove = useMutation(
    (category: Category) => apiFetch<null>(`/admin/categories/${category.id}`, { method: 'DELETE', query: { version: category.version } }),
    {
      id: 'categories:remove',
      key: category => category.id,
      removes: true,
      confirm: category => ({ title: `Delete "${category.name}"?`, confirmLabel: 'Delete', danger: true }),
      successMessage: (_, category) => `Category "${category.name}" deleted`,
      errorMessage: category => `Could not delete "${category.name}"`,
      invalidate: ['categories', 'products'],
    },
  )
  return { remove, isBusy: (id: string) => remove.isPending(id) }
}
```

```vue
<script setup lang="ts">
const { remove, isBusy } = useCategoryMutations()
</script>

<template>
  <UButton
    label="Delete"
    :loading="isBusy(category.id!)"
    @click="remove.execute(category)"
  />
</template>
```

### Type

```ts
function useMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  options: MutationOptions<TInput, TResult> & { id: string },
): Mutation<TInput, TResult> // reactive
```

- **`fn`** does the API call. It receives exactly what you pass to `execute(input)`, and its resolved value becomes `data`. Call the API with [`apiFetch`](./data-fetching.md#apifetch). Let it throw: errors are caught and normalized to [`ApiError`](./errors.md#apierror).
- **`TInput`** is whatever the call needs. Use an object when there's more than one value, e.g. `{ id: string, name: string, body: UpdateCategoryBody }` (the name for the toasts).

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | **required** | Unique `'<feature>:<action>'`, e.g. `'categories:remove'`. **State is shared by `id` across the whole app**: every component calling `useCategoryMutations()` sees the same in-flight items. |
| `key` | `(input) => string \| number` | none (single slot) | Identifies the item a call acts on. **Calls with different keys run in parallel.** A call whose key is already in flight resolves to `skipped` (no double submit). Without `key`, only one call runs at a time. Any string works as a key, including `constructor` or `__proto__` (state records have no prototype). |
| `lock` | `(input) => string \| number` | none | **Record lock shared across mutations**: calls whose lock is held by *any* mutation are skipped with reason `locked` and an explaining toast. Give conflicting operations on one record the same lock (Categories: `category:<id>` on update and remove). Checked and reserved when the request starts (after confirmation, per batch item). Omit when calls can't conflict (create). |
| `confirm` | `ConfirmOptions \| (input) => ConfirmOptions` | none | Ask before running. See [`useConfirm`](./ui-helpers.md#useconfirm). The dialog closes as soon as the user answers. |
| `successMessage` | `string \| (data, input) => string \| false` | none | Success toast title. **No toast unless you set it.** Name the item: `` `Category "${c.name}" deleted` ``. |
| `errorMessage` | `string \| (input) => string` | `'Something went wrong'` | Error toast **title**. The description is always the error's user-safe `message`. |
| `invalidate` | `string[]` | none | Features whose cached data refreshes after success, e.g. `['categories', 'products']`. See [`invalidate`](./data-fetching.md#invalidate). |
| `removes` | `boolean` | `false` | The call deletes the item. On success `isRemoved(key)` is `true` until the invalidated data has refreshed, so the row disappears immediately. |
| `onSuccess` | `(data, input) => void` | none | Runs after every successful call, **including each item of a batch**. |
| `onError` | `(error: ApiError, input) => void` | none | Runs after every failed call, including each item of a batch. |
| `batch` | `BatchOptions` | none | Configures [`executeMany`](#executemany). See below. |

#### `batch`

| Option | Type | Default | Description |
|---|---|---|---|
| `noun` | `[singular, plural]` | `['item', 'items']` | For progress and summary text: `['category', 'categories']`. |
| `verb` | `[progressive, past]` | `['Processing', 'processed']` | `['Deleting', 'deleted']` produces "Deleting categories… 3/10" and "10 categories deleted". |
| `concurrency` | `number` | `4` | Maximum requests in flight at once. |
| `confirm` | `(inputs) => ConfirmOptions` | none | One confirmation for the whole batch. It receives only the items that will actually run. |
| `phases` | `(inputs) => TInput[][]` | one phase | Groups that run **one after another**, e.g. children before parents. Empty groups are ignored. |

### Returns

A **reactive** object. Don't destructure it.

| Member | Type | Description |
|---|---|---|
| `execute(input, overrides?)` | `Promise<MutationResult<TResult>>` | Run once. [Details](#execute). |
| `executeMany(inputs, overrides?)` | `Promise<BatchResult<TInput, TResult>>` | Run for many items. [Details](#executemany). |
| `pending` | `boolean` | Any call of this mutation in flight. |
| `isPending(key?)` | `(key?) => boolean` | With a key: this item is in flight. Without: same as `pending`. |
| `pendingCount()` | `() => number` | Number of calls in flight. |
| `errorOf(key?)` | `(key?) => ApiError \| undefined` | Last error for this item (cleared when it's retried). Without a key: the single-slot error (only useful for mutations without `key`). |
| `error` | `ApiError \| undefined` | Last error of any call. |
| `data` | `TResult \| undefined` | Last successful result of any call. |
| `isRemoved(key)` | `(key) => boolean` | `true` after a successful `removes` call, until the refresh lands. |
| `reset(key?)` | `(key?) => void` | Clear the recorded error for one item, or all errors plus `data`/`error`. |

All of these are shared by `id`. A list row and a modal using the same mutation see the same state.

### `execute`

```ts
execute(input: TInput, overrides?: {
  confirm?: ConfirmOptions | false                               // override or skip the confirmation
  errorActions?: (error: ApiError, input: TInput) => ToastAction[] // extra buttons on the error toast
}): Promise<MutationResult<TResult>>
```

Flow: skip if the item is already in flight → confirm (if configured) → call `fn` → toast → `onSuccess`/`onError` → refresh `invalidate` features (in the background).

**It never throws.** Check the result:

```ts
type MutationResult<T> =
  | { ok: true, status: 'success', data: T }
  | { ok: false, status: 'error', error: ApiError }   // already toasted
  | { ok: false, status: 'cancelled' }                // user declined the confirmation
  | { ok: false, status: 'skipped', reason: 'in-flight' | 'locked' } // same key running (silent) / record locked by another mutation (toast)
```

```ts
const result = await create.execute(body)
if (result.ok) emit('close', true)            // most callers only need `ok`
if (result.status === 'error' && result.error.kind === 'validation') { /* e.g. focus a field */ }
```

`execute` resolves as soon as the API call finishes. The data refresh continues in the background, so closing a modal isn't delayed by the list reload.

### `executeMany`

```ts
executeMany(inputs: TInput[], overrides?: { confirm?: ConfirmOptions | false }): Promise<BatchResult<TInput, TResult>>

interface BatchResult<TInput, TResult> {
  succeeded: { input: TInput, data: TResult }[]
  failed: { input: TInput, error: ApiError }[]
  skipped: TInput[]    // busy when its turn came: same mutation in flight, or record locked (e.g. a pending update)
  notStarted: TInput[] // never started because the user pressed Stop
  cancelled: boolean   // user declined the batch confirmation: nothing ran
}
```

The backend has no bulk endpoints, so a batch is N single calls:

1. Items that are busy (this mutation in flight, or their `lock` held by another mutation) are set aside as `skipped`. Each remaining item is checked **again** when its turn comes (see [below](#concurrency-guarantee-and-current-limits)). If nothing is left to run, it returns immediately with no toast.
2. One confirmation (`batch.confirm`), unless `overrides.confirm === false`.
3. Calls run with at most `batch.concurrency` in parallel, phase by phase. Each item gets the normal per-item state (`isPending`, `errorOf`, `isRemoved`), but **no per-item toasts**.
4. A live progress toast ("Deleting categories… 3/10") with a **Stop** button. Stop prevents new items from starting. Requests already in flight finish.
5. **One summary toast:**
   - all succeeded: "10 categories deleted" (plus "N skipped (another action on them was in progress)" / "N not started (stopped)" when relevant)
   - some failed: "7 categories deleted, 3 failed", with reasons grouped ("Category has products (2) · Category not found (1)") and a **Retry failed** action that reruns only the failed items without asking again
6. One data refresh (if anything succeeded).

#### Concurrency guarantee and current limits

- **Required** ([feature-standard.md §4](../feature-standard.md#4-list-page-behavior)): conflicting operations on the same item (update vs delete, delete vs delete) never overlap. Eligibility must be **checked and reserved immediately before each request starts**, with no asynchronous gap between the check and the reservation. Independent items still run concurrently.
- **What the engine does:** `run` checks the key **and the record lock** and reserves both synchronously (no `await` in between) right before calling the request. That holds for a single `execute` after its confirmation, and for each batch item when a worker picks it up. An item that became busy meanwhile (same mutation, or its lock taken by another mutation) is `skipped`, and different records still run in parallel (D28).
- **What features must do:** give every mutation that can conflict on a record the same `lock`. Without `lock`, mutations only exclude themselves.
- **Prefiltering is not the guarantee.** The early checks (before a confirmation, before a batch) only avoid asking about work that can't run. `isBusy` in the UI is a display. The guarantee is the check-and-reserve at request start.
- Tests: `test/unit/mutation.test.ts` → "record locks across mutations"; `test/e2e/list-bulk.test.ts` (bulk delete during a pending edit, which fails without `lock`).

```ts
async function removeSelected() {
  const result = await remove.executeMany(selection.selected)
  // Keep only what still needs attention selected.
  selection.select([...result.failed.map(f => f.input.id), ...result.notStarted.map(c => c.id)])
}
```

### Recipes

#### Create / edit form modal

```ts
const { create, update } = useCategoryMutations()
const saving = ref(false)

async function onSubmit({ data }: FormSubmitEvent<CategoryForm>) {
  saving.value = true
  const result = props.category
    ? await update.execute({ id: props.category.id, name: data.name, body: toUpdateCategoryBody(data, props.category) })
    : await create.execute(toCreateCategoryBody(data))
  saving.value = false
  if (result.ok) emit('close', true)
}
```

Definitions:

```ts
const create = useMutation((body: CreateCategoryBody) => apiFetch<Category>('/admin/categories', { method: 'POST', body }), {
  id: 'categories:create',
  // Identifies the submission: a double submit is skipped, different creates run in parallel.
  key: body => body.name.trim().toLowerCase(),
  successMessage: (_, body) => `Category "${body.name}" created`,
  errorMessage: body => `Could not create "${body.name}"`,
  invalidate: ['categories', 'products'],
})

const update = useMutation(
  // `body.version` is the version the form opened with: a stale save gets 409 VERSION_CONFLICT.
  ({ id, body }: { id: string, name: string, body: UpdateCategoryBody }) =>
    apiFetch<Category>(`/admin/categories/${id}`, { method: 'PATCH', body }),
  { id: 'categories:update', key: ({ id }) => id, lock: ({ id }) => `category:${id}`, successMessage: 'Category updated', invalidate: ['categories', 'products'] },
)
```

#### Let the user close the form while it saves ("Reopen" on failure)

The save keeps running after the modal closes. If it then fails, offer to reopen the form with the user's input. `errorActions` is evaluated **when the error happens**, so it can check whether the modal is still open:

```ts
let closed = false
onUnmounted(() => { closed = true })
const overlay = useOverlay()

const draft = { ...state }
await update.execute({ id, body }, {
  errorActions: () => closed
    ? [{ label: 'Reopen', onClick: () => overlay.create(CategoryFormModal, { destroyOnClose: true }).open({ category, draft }) }]
    : [],
})
```

See `features/categories/components/CategoryFormModal.vue` for the full version, including the `draft` prop.

#### Busy rows in a table

Expose `isBusy(id)` from the feature, combining every mutation that acts on an item, and use it to block the row's actions in the UI. This is a **display**; the exclusion itself comes from `lock` (see [Concurrency guarantee and current limits](#concurrency-guarantee-and-current-limits)).

```ts
return { create, update, remove, isBusy: (id: number) => update.isPending(id) || remove.isPending(id) }
```

```vue
<UTable :meta="{ class: { tr: row => (isBusy(row.original.id!) ? 'opacity-50 pointer-events-none' : '') } }">
  <template #actions-cell="{ row }">
    <UIcon v-if="isBusy(row.original.id!)" name="i-lucide-loader-circle" class="animate-spin" />
    <UDropdownMenu v-else :items="rowActions(row.original)">…</UDropdownMenu>
  </template>
</UTable>
```

#### Hide deleted rows immediately

```ts
const rows = computed(() => (data.value?.content ?? []).filter(c => !remove.isRemoved(c.id!)))
```

The row disappears **after** the backend confirms the delete, and stays hidden until the refreshed list arrives. A failed delete never hides it.

#### Dependent items in a batch (children first)

```ts
batch: {
  noun: ['category', 'categories'],
  verb: ['Deleting', 'deleted'],
  phases: categories => [
    categories.filter(c => c.mainCategoryId !== undefined), // sub-categories first
    categories.filter(c => c.mainCategoryId === undefined), // then main categories
  ],
}
```

#### Status toggle (no confirmation, no removal)

```ts
const setStatus = useMutation(
  ({ id, version, status }: { id: string, version: number, title?: string, status: Status }) =>
    apiFetch<Reward>(`/admin/rewards/${id}`, { method: 'PATCH', body: { version, status } }),
  {
    id: 'rewards:status',
    key: ({ id }) => id,
    successMessage: (_, { title, status }) => `"${title}" is now ${STATUS_LABELS[status].toLowerCase()}`,
    errorMessage: ({ title }) => `Could not change the status of "${title}"`,
    invalidate: ['rewards'],
    batch: { noun: ['reward', 'rewards'], verb: ['Updating', 'updated'] },
  },
)
// bulk: setStatus.executeMany(selection.selected.map(r => ({ id: r.id!, title: r.title, status: 'INACTIVE' as const })))
// (`as const`: inside .map() TypeScript would otherwise widen 'INACTIVE' to string)
```

#### Skip the confirmation for one call

```ts
await remove.execute(category, { confirm: false }) // e.g. after your own custom dialog
```

### Behavior details

- **Concurrency:** different keys run in parallel. The same key is skipped while in flight **for the same mutation**, and a held `lock` skips **any** mutation declaring it (both checked and reserved right before each request). Without `key`, calls are serialized (any second call is skipped).
- **Session change:** errors, last results and "removed" marks reset when the signed-in identity changes (`resetMutationOutcomes`, D29). In-flight calls and locks stay until their requests settle; their responses are discarded.
- **Shared state:** state lives in `useState('mutation:<id>')`. Two `useMutation` calls with the same `id` share in-flight items, errors and removed keys. Give every mutation a unique id.
- **Never cancelled:** unmounting a component doesn't cancel its mutations. The toast and data refresh still happen. [`usePendingMutationCount`](#usependingmutationcount) drives a `beforeunload` warning.
- **Silent errors:** `unauthorized` (session expiry, handled by the redirect to login) and `aborted` errors are recorded but not toasted. See [`isSilentError`](./errors.md#issilenterror).
- **Toast timing:** error toasts that carry actions (Reopen, Retry failed) stay 10 seconds. The batch progress toast stays until the batch ends.
- **Refresh:** `invalidate` runs after a single success, or once after a batch. Refreshes from several mutations finishing within 30ms are merged.
- **`removes` without `invalidate`:** the row stays hidden for the rest of the session (nothing refreshes it back).

### Common mistakes

| Don't | Do |
|---|---|
| `const { pending } = useMutation(...)` | `const save = useMutation(...)` → `save.pending` (the object is reactive) |
| `try { await remove.execute(c) } catch { toast… }` | `execute` never throws and already toasts. Check `result.ok` |
| One `useMutation` per component with ad-hoc ids | Define mutations once in `use<Feature>Mutations()` so every component shares state |
| Omit `key` on update/delete | `key: x => x.id`, otherwise deleting B while A runs is skipped |
| `successMessage: 'Deleted'` | Name the item: `(_, c) => \`Category "${c.name}" deleted\``. With parallel work, toasts arrive out of order |
| Loop `execute` over selected rows | `executeMany(rows)`: one confirmation, concurrency limit, one summary, one refresh |
| Manually call `refresh()` after a mutation | Declare `invalidate: ['<feature>', ...]` |

---

## `usePendingMutationCount`

Number of mutation calls in flight across the whole app.

```ts
const pending = usePendingMutationCount() // Ref<number>
```

Used by `plugins/leave-guard.client.ts` to warn before the tab closes while writes are still running. It could also drive a global "Saving…" indicator.
