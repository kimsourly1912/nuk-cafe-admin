# UI helpers

← [API Reference](./README.md)

- [`useConfirm`](#useconfirm)
- [`useTableSelection`](#usetableselection)
- [`<BulkActionsBar>`](#bulkactionsbar)
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
  description: `${previewList(categories.map(c => c.name))}. This cannot be undone.`,
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

## `<StatusTabs>`

Status filter as tabs with counts, "All 3 · Active 2 · Archived 1" (Shopify-style views). Binds to the list's status filter (`ANY` = "All"). The tabs sit in a `role="group"` named "Status" (`UTabs` can't name its `tablist`). Each resource names its own statuses: they differ (`active` / `archived`; menu items add `draft`), so there's no shared status constant or badge.

Source: `app/components/StatusTabs.vue`

```vue
<StatusTabs
  v-model="filters.status"
  :tabs="[{ label: 'Active', value: 'active' }, { label: 'Archived', value: 'archived' }]"
  :counts="{ all: 3, active: 2, archived: 1 }"
/>
```

| Prop | Description |
|---|---|
| `v-model` | The filter value: a status or `ANY` |
| `tabs` | The statuses after "All", `{ label, value }[]` |
| `counts` | Keyed by the tab values plus `all`; badges appear once known |
| `disabled` | e.g. while an unsaved order locks the filters |

Counts: a list loaded whole (Categories, the libraries) counts on the client; a paginated one asks its list endpoint with `pageSize: 1` per status and reads `total`, in one query keyed `<feature>:status-counts` so `invalidate(feature)` refreshes it (`useItemStatusCounts` in the products feature).

---

## Money: `toMinor`, `fromMinor`, `formatMinor`, `formatPrice`, `PRICE_FORMAT`

The API stores prices as integer cents of USD (`priceMinor`, `priceDeltaMinor`); forms and the display work in dollars. Convert only at the boundary: `toMinor` when sending, `fromMinor` when filling a form.

Source: `app/utils/money.ts` (moved from the products feature when Add-ons became the second screen with prices, D68). Tests: `app/features/products/tests/product-form.test.ts`.

```ts
toMinor(4.2) // 420 (half up, without floating-point noise: toMinor(1.005) is 101)
fromMinor(420) // 4.2
formatMinor(420) // "$4.20"; formatMinor(null) → "—"
formatPrice(4.2) // "$4.20" (dollars)
```

```vue
<UInputNumber :model-value="row.price" :format-options="PRICE_FORMAT" :min="0" :step="0.05" />
```

Auto-imported in components. Pure files that are unit-tested in Node (`schemas/*.ts`) import it explicitly: `import { toMinor } from '~/utils/money'` (the unit project has the `~` alias).

---

## `<ListSkeleton>`

Placeholder rows or cards while a list loads for the first time, instead of "Loading…" text, so nothing jumps when the data arrives. `role="status"` with the label for screen readers.

Source: `app/components/ListSkeleton.vue`

```vue
<ListSkeleton v-if="loading" label="Loading menu items…" variant="card" />
```

| Prop | Default | |
|---|---|---|
| `label` | | Read by screen readers ("Loading menu items…") |
| `variant` | `'row'` | `'row'` or `'card'` |
| `count` | `5` | How many placeholders |

> Drive it with `useApiQuery`'s `loading`, and **don't give that query an empty-list `default`**: `loading` means "pending with no data yet", and `[]` counts as data, so the empty state would flash instead (a bug found by e2e, D37).
