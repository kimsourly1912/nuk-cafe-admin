# UI helpers

← [API Reference](./README.md)

- [`useConfirm`](#useconfirm)
- [`useTableSelection`](#usetableselection)
- [`<BulkActionsBar>`](#bulkactionsbar)
- [`<StatusBadge>` and status constants](#statusbadge-and-status-constants)
- [`previewList` and `pluralize`](#previewlist-and-pluralize)

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
  danger?: boolean      // red confirm button
}
```

### Notes

- Resolves `true` on confirm and `false` on Cancel. The dialog can't be dismissed by clicking outside or pressing Escape, so the user must choose.
- It closes **as soon as the user answers**. Any work that follows runs in the background.
- For deletes, don't call it yourself. Set `confirm` on [`useMutation`](./mutations.md#options).
- Call `useConfirm()` during `setup`, not inside an event handler.

---

## `useTableSelection`

Row checkboxes for `UTable`, keyed by id so the selection survives list refreshes.

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
  clear(): void
  select(keys: (string | number)[]): void // replace the selection
}>
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

"5 selected · *your actions* · Clear". It renders nothing when `count` is 0.

Source: `app/components/BulkActionsBar.vue`

```vue
<UDashboardToolbar>
  <template #right>
    <BulkActionsBar :count="selection.count" @clear="selection.clear()">
      <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="subtle" @click="removeSelected" />
      <UButton label="Deactivate" color="neutral" variant="subtle" @click="deactivateSelected" />
    </BulkActionsBar>
  </template>
</UDashboardToolbar>
```

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
