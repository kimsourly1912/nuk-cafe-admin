# UI helpers (API reference)

← [API Reference](./README.md)

- [`useConfirm`](#useconfirm)
- [`useTableSelection`](#usetableselection)
- [`<TaskFrame>`](#taskframe)
- [`<BottomActionBar>`](#bottomactionbar)
- [`<BulkActionsBar>`](#bulkactionsbar)
- [`useLayoutContext`](#uselayoutcontext)
- [`previewList` and `pluralize`](#previewlist-and-pluralize)
- [`<SearchInput>`](#searchinput)
- [`<ListEmptyState>`](#listemptystate)
- [Keyboard shortcuts: `usePageShortcuts`, `useSubmitShortcut`, `<ShortcutsHelp>`](#keyboard-shortcuts)
- [`<StatCard>`](#statcard), [`<RecordSelect>`](#recordselect), [`<AppDrawer>`](#appdrawer), [`<ToolbarTabs>`](#toolbartabs), [`useUrlTab`](#useurltab) (D126), [`<PhoneInput>`](#phoneinput) (D127), [`useCenteredTab`](#usecenteredtab), [`<ListPagination>`](#listpagination), [`<QuantityStepper>`](#quantitystepper) (D128)

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

## `<TaskFrame>`

The frame of a task-flow page ([page-patterns §5](./page-patterns.md#5-task-flow), D84, D97): a centered `UCard` from `sm` with the actions in its footer; on phones the full screen, the title at the top, the actions at the bottom above the safe area. CSS only (no `useLayoutContext`), so a server-rendered page and the browser agree. The layout gives it the height: a flex parent at least the screen tall (layouts `auth` and `account`).

Source: `app/components/TaskFrame.vue`. Slots: `header`, default, `footer` (each optional).

```vue
<TaskFrame>
  <template #header><h1 class="text-xl font-semibold">Sign in</h1></template>
  <UForm id="sign-in-form" :schema="schema" :state="state" @submit="onSubmit">…</UForm>
  <template #footer>
    <UButton type="submit" form="sign-in-form" label="Sign in" block />
  </template>
</TaskFrame>
```

The submit button is outside the form, joined with `form="<id>"`: Enter still submits.

## `<BottomActionBar>`

The one bottom action bar (D77 decision 3, D78): a page's mode bar (Select, Reorder), its Save bar or its bulk bar. The feature puts ordinary Nuxt UI buttons (and a short status text) in the slot; the bar owns only its placement:

- **Below `lg`:** fixed to the bottom of the screen, full width, with safe-area padding. While it shows, its scroll container (the panel body) gets matching bottom padding and `scroll-padding-bottom`, so the last row and a focused field are never under it. While a text field elsewhere has focus (an on-screen keyboard: `isTextEntry` in `app/utils/bottom-bar.ts`), it steps aside and comes back on blur; the padding stays, so nothing jumps.
- **From `lg`,** `expanded` decides: `inline` sits where it's placed (above the list: Categories), `pinned` sticks to the bottom of the panel (place it **last** in the body: bulk bars), `hidden` isn't shown (the page has the action in its navbar: the Add-on page's Save changes).
- **One bar at a time,** app-wide: the most recently opened one shows.

It's a `role="toolbar"` named by `label`. Its only styling is Nuxt UI's surface tokens (`bg-default`, `border-default`); no blur, shadow or colors of its own. Overlays don't use it (owner, 2026-09-28): a modal's or slideover's footer is Nuxt UI's own `#footer` slot (the Options editor's Done reordering).

Source: `app/components/BottomActionBar.vue`

```vue
<template #body>
  <BottomActionBar v-if="mode === 'reorder'" label="Reorder">
    <p class="min-w-0 flex-1 text-sm text-muted">Drag a row or use its arrows.</p>
    <UButton label="Save order" icon="i-lucide-save" @click="saveOrder()" />
  </BottomActionBar>
  <!-- list… -->
</template>
```

| Prop / slot | Description |
|---|---|
| `label: string` | The toolbar's accessible name ("Bulk actions", "Reorder", "Settings actions"). |
| `open?: boolean` | Shown when true (default). `v-if` works too. |
| `expanded?: 'inline' \| 'pinned' \| 'hidden'` | Placement from `lg` (default `inline`). |
| default slot | The bar's content: a flex row that wraps (`gap-2`); give text `min-w-0 flex-1`. |

## `<BulkActionsBar>`

The **Select mode** bar (page-patterns §2: selection is a mode, never always-on checkboxes; D89): "5 selected · Select all" and *your actions* ("None selected" while nothing is). A [`BottomActionBar`](#bottomactionbar): fixed to the bottom of the screen below `lg`, inline where it's placed from `lg` (under the status tabs). Render it while the page is in Select mode (`v-if`), so it shows with nothing selected too. It's a `role="toolbar"` named "Bulk actions". **It carries actions only (D129):** the page's **Select** toolbar button is a toggle (it reads **Cancel**, "Cancel selection", while selecting; `S` toggles too), and Escape leaves the mode. On phones the count has its own line and the actions share the next in equal widths. The page owns the mode: the toggle, checkboxes and the name selecting while in it, the ⋮ menus hidden, Escape (a plain keydown listener, like Categories). Used by Categories and Menu items.

Source: `app/components/BulkActionsBar.vue`

```vue
<template #body>
  <StatusTabs v-model="filters.status" :tabs="TABS" :counts="counts" />
  <BulkActionsBar
    v-if="selecting"
    :count="selection.count"
    :all-selected="selection.allSelected"
    @toggle-all="selection.toggleAll(!selection.allSelected)"
  >
    <UButton label="Archive selected" icon="i-lucide-archive" color="neutral" variant="subtle" :disabled="!selection.count" @click="archiveSelected" />
  </BulkActionsBar>
  <!-- list… -->
</template>
```

| Prop / slot / event | Description |
|---|---|
| `count: number` | Number of selected rows. |
| `allSelected: boolean` | Whether every selectable row is selected: the link reads "Unselect all". |
| default slot | Action buttons; disable them while `count` is 0. |
| `@toggle-all` | Clicked Select all / Unselect all. |

## `useLayoutContext`

The viewport's width class for choices CSS can't make (D77, [responsive-layout §1](./responsive-layout.md#constrained-surfaces-container-queries)): `fullscreen` on a `UModal`, a `UDrawer` instead of a dropdown, which URL a list opens, or which of two collections to mount (Staff's rows vs its table, D79: one tree in the DOM instead of two hidden by CSS). Everything CSS can express uses Tailwind's `sm:`/`lg:` variants or container queries instead.

Source: `app/composables/useLayoutContext.ts`

```ts
const { isCompact, isExpanded } = useLayoutContext()
// <UModal :fullscreen="isCompact">
```

| Returns | Description |
|---|---|
| `isCompact: Ref<boolean>` | Narrower than Tailwind's `sm` (`width < 40rem`, 640px at the default font size). |
| `isExpanded: Ref<boolean>` | Tailwind's `lg` and wider (`width >= 64rem`). |

The queries are Tailwind's own breakpoints in `rem`, so JavaScript and CSS switch at the same width even with a larger browser font. Width only: never the user agent, touch or hover.

---|---|
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

Labels are never cut (D128): a row that doesn't fit scrolls sideways (no scrollbar shown), and the chosen status is brought to the middle of the row ([`useCenteredTab`](#usecenteredtab)); only the row scrolls, never the page.

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

## Times of day: `formatClock`, `timeRange`, `isOvernight`, `minuteToTime`, `timeToMinute`

Weekly windows (availability rules, branch hours) are minutes after midnight in the branch's local time. These helpers show them and bind them to `UInputTime` (D91). Source: `app/utils/clock.ts` (auto-imported; unit-tested code imports it from `~/utils/clock`).

| Helper | Does |
|---|---|
| `formatClock(450)` | `"7:30 AM"`; `0` and `1440` are `"12:00 AM"` |
| `timeRange(start, end)` | `"7:00 AM – 11:00 AM"`, `"All day"` for 0–1440 |
| `isOvernight(start, end)` | An end before the start runs into the next day (an end of 12:00 AM doesn't) |
| `minuteToTime(minute?)` / `timeToMinute(time)` | Minutes ↔ `UInputTime`'s `Time` value (`undefined` when empty) |

```vue
<UInputTime
  :model-value="minuteToTime(window.start)"
  :hour-cycle="12"
  aria-label="Opens"
  @update:model-value="value => window.start = timeToMinute(value)"
/>
```

---

## `<StatCard>`

One number on a page (ui.md §8, D126): Nuxt UI's `subtle` card (`bg-elevated/50` with a light ring), a muted label, the value large, an optional change and icon. It renders `dt`/`dd`, so place it in a `<dl>`.

Source: `app/components/StatCard.vue`

```vue
<dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
  <StatCard label="Paid sales" :value="formatMinor(paid)" :change="{ text: '+12%', up: true }" change-label="vs yesterday" />
  <StatCard label="Refunds" :value="negativeMinor(refunds)">
    <template #value><span class="text-base font-normal text-muted">(2)</span></template>
  </StatCard>
</dl>
```

| Prop / slot | Description |
|---|---|
| `label`, `value` | The muted label and the formatted value |
| `icon` | Optional, beside the label |
| `change`, `changeLabel` | `{ text, up }`: green when up, red when down; "vs yesterday" in muted text |
| `#value` | Added after the value (a count in brackets) |
| default slot | Below, for a note |

---

## `<RecordSelect>`

A dropdown of the cafe's records (ui.md §14, D126): `USelectMenu` with a search box and virtual scroll. Search matches anywhere in the label; `pinned` values stay first and are never filtered out; no match says "No {noun} match “…”" (a row of its own when pinned rows remain). Attributes (`aria-label`, `placeholder`, `loading`, `disabled`, `multiple`, …) go to the select. Its trigger is a button (`aria-haspopup="listbox"`): in e2e, `getByRole('button', { name, exact: true })`, and wait for the `listbox` to close after picking before typing elsewhere (it hands focus back to its button as it closes).

Source: `app/components/RecordSelect.vue`. Used by `CategorySelect`, `AvailabilityRuleSelect`, and the branch and category filters.

```vue
<RecordSelect v-model="filters.branchId" :items="branchItems" noun="branches" :pinned="[ANY]" aria-label="Branch" />
```

| Prop | Description |
|---|---|
| `v-model` | A value, or values with `multiple` |
| `items` | `{ label, value, disabled? }[]` |
| `noun` | Plural: "Search branches…", "No branches match" |
| `pinned` | Values always shown above the matches ("All", "None") |

---

## `<AppDrawer>`

`UDrawer` without dragging (ui.md §8, D126): no handle, `handle-only`, so the sheet never moves under a finger; its X is on unless `:close="false"`. Every other prop, event and slot is `UDrawer`'s, also through `<component :is>` (`resolveComponent('AppDrawer')`). `UDrawer` itself is a lint error outside this file.

Source: `app/components/AppDrawer.vue`

```vue
<AppDrawer v-model:open="open" title="Filters">
  <UButton label="Filters" />
  <template #body>…</template>
</AppDrawer>
```

---

## `<ToolbarTabs>`

Tabs in a `UDashboardToolbar` (ui.md §15, D126): the tabs drop their own line and sit on the toolbar's, the active underline right above it.

Source: `app/components/ToolbarTabs.vue`

```vue
<UDashboardToolbar>
  <ToolbarTabs v-model="tab" :items="tabs" aria-label="Branch sections" />
</UDashboardToolbar>
```

---

## `useUrlTab`

A page's tab kept in the URL (ui.md §15, D126). The first tab is the default and leaves the URL clean. Switching replaces the URL with `history.replaceState` (keeping Vue Router's `state.current` in step), not a route change: Back still leaves the page, and the unsaved-changes guard, which asks on every navigation, doesn't ask when a tab with a draft is only hidden. A page that redirects to the tab's page passes the query on (the Branch list).

Source: `app/composables/useUrlTab.ts`

```ts
const tab = useUrlTab(['settings', 'tables'] as const)            // ?tab=tables
const section = useUrlTab(ITEM_FORM_SECTIONS.map(s => s.value), 'section')
```

---

## `<PhoneInput>`

A phone number (D127): the country (flag and dial code, a `USelect` in the input's leading slot) and the number as one field. People type or paste anything; the form's schema decides validity with `parsePhone(text, country)` from `#shared/contracts/phone` (the server checks the same rules on the E.164 it receives). A full number typed or pasted (`+852 9123 4567`, `00855…`, `855…`) switches the country and keeps the local part; leaving the field drops a trunk 0 and groups the digits (`012345678` → `12 345 678`). The select sits inside the input so the `UFormField`'s id, name and label stay the number's; it has its own id.

Source: `app/components/PhoneInput.vue`; the rules in `shared/contracts/phone.ts` (`PHONE_COUNTRIES`, `parsePhone`, `formatPhone`, `phoneSchema`).

```vue
<UFormField label="Phone" name="phone">
  <PhoneInput v-model="state.phone" v-model:country="state.phoneCountry" />
</UFormField>
```

| Piece | Description |
|---|---|
| `v-model` | The number as typed (`12 345 678`) |
| `v-model:country` | `'KH' \| 'HK' \| 'AR'` |
| `parsePhone(text, country?)` | `{ ok: true, e164, country, national, local }` or `{ ok: false, reason, message }` ("Enter a valid Cambodian phone number", "Only Cambodia, Hong Kong or Argentina numbers for now"); without `country` only a full `+…` number reads |
| `phoneSchema` | A request field: a full number in a supported country → E.164; blank or `null` → `null` |
| `formatPhone(e164)` | `+855 12 345 678` for display |

A form keeps `phone` and `phoneCountry` in its draft, validates them together (`v.forward(v.partialCheck(…), ['phone'])`, the Branch form), and sends `parsePhone(…).e164`.

---

## `useCenteredTab`

Keeps a scrolling tab row's active tab in the middle (D128). Every `UTabs` scrolls sideways when its labels don't fit (`app.config.ts`: the list `overflow-x-auto scrollbar-none`, triggers `shrink-0`, labels never truncated). This composable scrolls only the row (never the page) so the active tab is centered: smoothly when it changes (a tap, the arrow keys, the URL; at once with reduced motion), at once on mounting and whenever the row or a tab changes size (counts arriving). A row that fits doesn't move. `<StatusTabs>` and `<ToolbarTabs>` call it; a page with its own `UTabs` calls it with a template ref around them.

Source: `app/composables/useCenteredTab.ts`. E2E: `list-page.test.ts` → "status tabs that don't fit".

```ts
const tabsRow = useTemplateRef('tabsRow') // on the UTabs or an element around it
useCenteredTab(tabsRow, () => tab.value)
```

---

## `<ListPagination>`

The pager of every paginated list (D128): "Page [3] of 10 · Rows per page [20]" on the left; first, previous, the page numbers ("1 2 3 … 8 9 10"), next and last on the right. Typing a page goes there on Enter (or leaving the box), kept between 1 and the last page. Rows per page is 10, 20, 50 or 100 (`PAGE_SIZES`); a new size goes back to page 1 and is kept in the URL (`usePaginatedQuery`). On phones: previous, "Page [3] of 10" and next on one line, rows per page under it. Nothing shows while the whole list fits on the smallest page.

Source: `app/components/ListPagination.vue`. Used by Staff, Menu items, Sales by item and Order history. E2E: `list-page.test.ts` → "the pager".

```vue
<ListPagination v-model:page="page" v-model:page-size="pageSize" :total="data?.total ?? 0" />
```

| Prop / model | Description |
|---|---|
| `v-model:page` | 1-based, from `usePaginatedQuery` |
| `v-model:page-size` | From `usePaginatedQuery` |
| `total` | The list's `total` from the API |

---

## `<QuantityStepper>`

A quantity: − the number + in a pill (D128), Nuxt UI buttons and input. The number stays within `min`–`max`; − is disabled at `min`, + at `max`. The field has `inputmode="none"`, so a tap on a phone or tablet doesn't open the keyboard (− and + are the way there); with a keyboard a number can be typed (applied on Enter or leaving the field, kept within the limits; anything else goes back) and ↑ / ↓ step it. The same markup for every visitor, so it's safe on server-rendered pages.

Source: `app/components/QuantityStepper.vue`. Used by the customer menu (the card's stepper from 0, which removes; the order's lines and the item detail from 1) and Review order. Customer orders stop at 20 per line (`LINE_MAX_QUANTITY`, D98). E2E: `shop-menu.test.ts` → "a line's card".

```vue
<QuantityStepper v-model="quantity" :max="LINE_MAX_QUANTITY" :label="item.name" size="sm" />
```

| Prop | Description |
|---|---|
| `v-model` | The quantity |
| `label` | What is counted, for the names: "Increase quantity of Iced Latte", "Quantity of Iced Latte" |
| `min` / `max` | Default 1 and 99 |
| `disabled`, `size` | `'sm'` or `'md'` (default) |
