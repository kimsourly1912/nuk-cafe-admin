# UI helpers

← [API Reference](./README.md)

- [`useConfirm`](#useconfirm)
- [`useTableSelection`](#usetableselection)
- [`<BulkActionsBar>`](#bulkactionsbar)
- [`<StatusBadge>` and status constants](#statusbadge-and-status-constants)
- [`previewList` and `pluralize`](#previewlist-and-pluralize)
- [`<SearchInput>`](#searchinput)
- [`<ListEmptyState>`](#listemptystate)
- [Keyboard shortcuts: `usePageShortcuts`, `useSubmitShortcut`, `<ShortcutsHelp>`](#keyboard-shortcuts)

---

## `useConfirm`

Promise-based confirmation dialog.

Source: `app/composables/useConfirm.ts`, `app/components/ConfirmDialog.vue`

### Usage

```ts
const confirm = useConfirm()

if (!await confirm({ title: 'Discard changes?', confirmLabel: 'Discard', danger: true })) return
```

### Type

```ts
function useConfirm(): (options: ConfirmOptions) => Promise<boolean>

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string // default 'Confirm'
  cancelLabel?: string  // default 'Cancel'
  danger?: boolean      // red confirm button
}
```

### Notes

- Resolves `true` on confirm and `false` on Cancel. The dialog can't be dismissed by clicking outside or pressing Escape, so the user must choose.
- It closes **as soon as the user answers**. Any work that follows runs in the background.
- For deletes, don't call it yourself. Set `confirm` on [`useMutation`](./mutations.md#options).
- Call `useConfirm()` during `setup` (or in route middleware), not inside an event handler. Each question opens its own dialog, which is removed when it closes.

---

## `useTableSelection`

Row selection for `UTable`, card grids and trees, keyed by id so the selection survives list refreshes.

Source: `app/composables/useTableSelection.ts`

### Usage

```ts
const rows = computed(() => (data.value?.content ?? []).filter(c => !remove.isRemoved(c.id!)))
const selection = useTableSelection(rows, c => c.id!, { resetOn: [query] })
```

```vue
<UTable
  v-model:row-selection="selection.rowSelection"
  :get-row-id="selection.getRowId"
  :data="rows"
  :columns="[{ id: 'select' }, ...otherColumns]"
>
  <template #select-header="{ table }">
    <UCheckbox
      :model-value="table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()"
      aria-label="Select all"
      @update:model-value="value => table.toggleAllPageRowsSelected(!!value)"
    />
  </template>
  <template #select-cell="{ row }">
    <UCheckbox
      :model-value="row.getIsSelected()"
      aria-label="Select row"
      @update:model-value="value => row.toggleSelected(!!value)"
    />
  </template>
</UTable>
```

### Type

```ts
function useTableSelection<T>(
  rows: MaybeRefOrGetter<T[]>,
  getKey: (row: T) => string | number,
  options?: { resetOn?: WatchSource[] },
): Reactive<{
  rowSelection: Record<string, boolean> // bind with v-model:row-selection
  getRowId: (row: T) => string          // bind with :get-row-id
  selected: T[]                         // selected rows that are currently in `rows`
  count: number
  allSelected: boolean                   // every row in `rows` (and at least one)
  someSelected: boolean                  // some but not all: an "indeterminate" select-all
  isSelected(row: T): boolean
  toggle(row: T, value?: boolean): void  // flips when `value` is omitted
  toggleAll(value: boolean): void        // every row in `rows`
  clear(): void
  select(keys: (string | number)[]): void // replace the selection
}>
```

Without a table (cards, trees), bind the helpers:

```vue
<UCheckbox :model-value="selection.someSelected ? 'indeterminate' : selection.allSelected"
           aria-label="Select all" @update:model-value="v => selection.toggleAll(!!v)" />
<ProductCard v-for="p in rows" :selected="selection.isSelected(p)" @select="v => selection.toggle(p, v)" ... />
```

### Behavior

- **`selected` only contains rows currently in `rows`.** Deleted or filtered-out rows drop out on their own, and `count` follows.
- **`resetOn`:** the selection clears whenever one of these sources changes. Pass the list `query` so changing filters or the page clears it, and nobody acts on rows they can no longer see.
- `select(keys)` **replaces** the selection. After a batch, keep only the rows that failed:
  ```ts
  const result = await remove.executeMany(selection.selected)
  selection.select(result.failed.map(f => f.input.id!))
  ```
- The object is reactive: use `selection.count`, and don't destructure it.

---

## `<BulkActionsBar>`

A **floating** bar at the bottom of the list (Linear-style): "5 selected · *your actions* · Clear". It renders nothing when `count` is 0, fades in and out (100–150 ms), and Escape inside it clears the selection. It's a `role="toolbar"` named "Bulk actions".

Source: `app/components/BulkActionsBar.vue`

Put it **at the end of the page body** (`#body` of `UDashboardPanel`); it's `sticky` to the bottom of the scrolling panel.

```vue
<template #body>
  <!-- list… -->
  <BulkActionsBar :count="selection.count" @clear="selection.clear()">
    <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="subtle" @click="removeSelected" />
  </BulkActionsBar>
</template>
```

> E2E: the bar fades out, so after an action that clears the selection, wait with `expect.poll(() => page.getByText(/\d+ selected/).count()).toBe(0)`.

| Prop / slot / event | Description |
|---|---|
| `count: number` | Number of selected rows. |
| default slot | Action buttons. |
| `@clear` | Clicked Clear. Usually `selection.clear()`. |

---

## `<StatusBadge>` and status constants

Most backend resources share `status: 'ACTIVE' | 'INACTIVE'`.

Source: `app/components/StatusBadge.vue`, `app/utils/status.ts`

```vue
<StatusBadge :status="row.original.status" />                 <!-- green "Active" / grey "Inactive" -->
<USelect v-model="state.status" :items="STATUS_ITEMS" />       <!-- form field -->
<USelect v-model="filters.status" :items="STATUS_FILTER_ITEMS" /> <!-- toolbar filter, includes "All statuses" (ANY) -->
```

| Export | Type | Description |
|---|---|---|
| `Status` | `'ACTIVE' \| 'INACTIVE'` | |
| `STATUS_LABELS` | `Record<Status, string>` | `{ ACTIVE: 'Active', INACTIVE: 'Inactive' }` |
| `STATUS_ITEMS` | `SelectItem[]` | Active, Inactive |
| `STATUS_FILTER_ITEMS` | `SelectItem[]` | All statuses (`ANY`), Active, Inactive |
| `<StatusBadge :status>` | component | Renders nothing if `status` is undefined. |

Some resources have other status sets (e.g. customers: `ACTIVE | SUSPENDED | …`). Give those their own badge in the feature. Don't extend these constants.

---

## `previewList` and `pluralize`

Text helpers for confirmations and summaries.

Source: `app/utils/text.ts`

```ts
function previewList(items: string[], max = 5): string
function pluralize(count: number, [one, many]: [string, string]): string
```

```ts
previewList(['Coffee', 'Tea', 'Juice'])                    // 'Coffee, Tea, Juice'
previewList(['A', 'B', 'C', 'D', 'E', 'F', 'G'])           // 'A, B, C, D, E and 2 more'
pluralize(1, ['category', 'categories'])                   // '1 category'
pluralize(3, ['category', 'categories'])                   // '3 categories'
```

Typical use, in a batch confirmation:

```ts
confirm: categories => ({
  title: `Delete ${pluralize(categories.length, ['category', 'categories'])}?`,
  description: `${previewList(categories.map(c => c.categoryName ?? `#${c.id}`))}. This cannot be undone.`,
  confirmLabel: 'Delete',
  danger: true,
}),
```

---

## `<SearchInput>`

Search box for list toolbars. Searches **as you type**, after a pause, so it doesn't call the API on every keystroke.

Source: `app/components/SearchInput.vue` (VueUse `watchDebounced`). E2E: `test/e2e/list-page.test.ts`.

```vue
<SearchInput v-model="filters.search" placeholder="Search categories…" class="w-64" />
```

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `v-model` | `string` | `''` | Receives the **trimmed** text |
| `placeholder` | `string` | `'Search…'` | Also its accessible name (`searchbox` role) |
| `delay` | `number` | `300` | ms without typing before it applies |

- **Enter** applies at once. The **✕** button clears and applies at once.
- If the model changes from outside (Clear filters, URL, back/forward), the box shows the new value. Typing a trailing space doesn't count as a change.
- Stale responses can't win: `useAsyncData` cancels the previous request when the query changes.

---

## `<ListEmptyState>`

Content for `UTable`'s `#empty` slot. It tells "nothing exists yet" apart from "the filters hide everything".

Source: `app/components/ListEmptyState.vue`

```vue
<UTable :data="rows" :loading="loading">
  <template #loading>Loading categories…</template>
  <template #empty>
    <ListEmptyState noun="categories" :filtered="isFiltered" create-label="New category"
                    @create="openForm()" @clear="clearFilters()" />
  </template>
</UTable>
```

| Prop / event | Meaning |
|---|---|
| `noun` | Plural, lower case (`'categories'`) |
| `filtered` | `usePaginatedQuery().isFiltered` |
| `create-label` | Create button label. Omit on lists where users can't create (e.g. orders) |
| `@create` / `@clear` | Create clicked / Clear filters clicked |

| State | Shows |
|---|---|
| No filters, no rows | "No categories yet" + create button |
| Filters active, no rows | "No categories match your filters" + **Clear filters** |

- **Always fill UTable's `#loading` slot too.** Without it the table shows the empty state during the first load, so "No categories yet" flashes before the data arrives.

---

## Keyboard shortcuts

Source: `app/composables/useShortcuts.ts`, `app/components/ShortcutsHelp.vue`. Built on Nuxt UI `defineShortcuts`: keys like `n`, `/`, `meta_enter` (`meta` = ⌘ on macOS, Ctrl elsewhere). Every shortcut and its cases: [App-wide behavior → Keyboard shortcuts](./app-behavior.md#keyboard-shortcuts).

```ts
function usePageShortcuts(config: Record<string, () => void>): void
function useSubmitShortcut(submit: () => void): void
const SHORTCUTS: readonly { kbds: readonly string[], label: string }[]
```

- **`usePageShortcuts`**: page-level keys. They don't fire while typing in an input, or while a dialog, menu or open select is on screen.
- **`useSubmitShortcut`**: Ctrl/⌘+Enter, also while typing. Does nothing when another dialog is stacked on top.
- **`SHORTCUTS`**: the list `<ShortcutsHelp>` shows (`?`). Add every new shortcut to it.

```vue
<!-- List page -->
<script setup lang="ts">
usePageShortcuts({ n: () => openForm() })
</script>
<template>
  <UTooltip text="New category" :kbds="['n']">
    <UButton label="New category" icon="i-lucide-plus" @click="openForm()" />
  </UTooltip>
</template>
```

```vue
<!-- Form modal -->
<script setup lang="ts">
const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit()) // UForm.submit() runs validation first
</script>
<template>
  <UForm ref="form" ...>...</UForm>
  <UTooltip text="Save" :kbds="['meta', 'enter']">
    <UButton type="submit" label="Save" />
  </UTooltip>
</template>
```

`<SearchInput>` registers `/` itself.

---

## `<StatusTabs>` and `useStatusCounts`

Status filter as tabs with counts, "All 24 · Active 20 · Inactive 4" (Shopify-style views). Replaces the status `USelect` in list toolbars; binds to the same filter value (`ANY` = all). The tabs sit in a `role="group"` named "Status" (`UTabs` can't name its `tablist`).

Source: `app/components/StatusTabs.vue`, `app/composables/useStatusCounts.ts`

```vue
<StatusTabs v-model="filters.status" :counts="counts" />
```

```ts
// Paginated lists: two tiny requests (size=1, totalElements), with the other filters applied.
const counts = useStatusCounts('schedules', () => ({ search: query.value.search }),
  (query, status) => unwrap(getPage({ query: { ...query, status, size: 1 } })).then(p => p.totalElements ?? 0))
// Lists loaded whole (Categories): count on the client and pass { ACTIVE, INACTIVE, all }.
```

| Prop | Description |
|---|---|
| `v-model` | `Status \| Any` |
| `counts` | `{ ACTIVE, INACTIVE, all }`; badges appear once known |
| `disabled` | e.g. while an unsaved order locks the filters |

`useStatusCounts` keys its query `<feature>:status-counts`, so `invalidate(feature)` refreshes the counts too. "All" is the sum (every record is ACTIVE or INACTIVE).

---

## `<ListSkeleton>`

Placeholder rows or cards while a list loads for the first time, instead of "Loading…" text, so nothing jumps when the data arrives. `role="status"` with the label for screen readers.

Source: `app/components/ListSkeleton.vue`

```vue
<ListSkeleton v-if="loading" label="Loading menu items…" variant="card" />
```

| Prop | Default | |
|---|---|---|
| `label` | | Read by screen readers ("Loading schedules…") |
| `variant` | `'row'` | `'row'` or `'card'` |
| `count` | `5` | How many placeholders |

> Drive it with `useApiQuery`'s `loading`, and **don't give that query an empty-list `default`**: `loading` means "pending with no data yet", and `[]` counts as data, so the empty state would flash instead (a bug found by e2e, D37).
